import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { CallerPrincipal } from "../auth";
import { parseConnectionString, sql } from "../db";
import { loadRoles, resolveEffectiveAccess, SEEDED_ROLES } from "./index";

// Migration 129's tables against a real SQL Server. The unit tests cover the
// catalog, the seeds and the pre-migration path; this file covers what only the
// database can show:
//
//   the nine seeded roles landing exactly as seeds.ts describes them;
//   a grant deciding access, and a revoked, expired or suspended one not;
//   a re-run leaving an Access Administrator's edits alone;
//   an app role in the token still working beside an OnBoard grant.
//
// Tables come from the real migration, in a database of its own (see
// assessmentLifecycle.db.contract.test.ts).
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;
const DATABASE = "mvta_access_roles_contract";
const MIGRATION = "129-app-owned-roles";

const OID = "11111111-1111-4111-8111-111111111111";
const OTHER_OID = "22222222-2222-4222-8222-222222222222";

function batches(text: string): string[] {
  return text.split(/^\s*GO\s*$/im).map((b) => b.trim()).filter(Boolean);
}

async function ownDatabase(cs: string): Promise<sql.ConnectionPool> {
  const admin = await new sql.ConnectionPool(parseConnectionString(cs)).connect();
  try {
    await admin.request().batch(
      `IF DB_ID('${DATABASE}') IS NOT NULL BEGIN ALTER DATABASE [${DATABASE}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${DATABASE}]; END; CREATE DATABASE [${DATABASE}];`,
    );
  } finally {
    await admin.close();
  }
  return new sql.ConnectionPool({ ...parseConnectionString(cs), database: DATABASE }).connect();
}

async function applyMigration(pool: sql.ConnectionPool) {
  const text = readFileSync(join(process.cwd(), "sql", `migration-${MIGRATION}.sql`), "utf8");
  for (const batch of batches(text)) await pool.request().batch(batch);
}

const principal = (roles: string[], userId = OID): CallerPrincipal => ({
  userId,
  userDetails: "someone@example.com",
  roles,
  claims: { tid: ["tenant-1"] },
});

/** `expiresAt` is a SQL expression, e.g. DATEADD(day, -1, SYSUTCDATETIME()). */
async function grant(pool: sql.ConnectionPool, oid: string, roleKey: string, expiresAt = "NULL") {
  await pool.request().batch(`
    IF NOT EXISTS (SELECT 1 FROM AccessPeople WHERE entra_object_id = '${oid}')
      INSERT AccessPeople (entra_object_id, entra_tenant_id, display_name, created_by)
      VALUES ('${oid}', 'tenant-1', 'Someone', 'contract test');
    INSERT AccessRoleGrants (person_id, role_key, granted_by, expires_at)
    SELECT person_id, '${roleKey}', 'contract test', ${expiresAt}
    FROM AccessPeople WHERE entra_object_id = '${oid}';
  `);
}

test("app-owned roles against real SQL", { skip: !connectionString && "DECISION_MATRIX_TEST_SQL_CONNECTION_STRING not set" }, async (t) => {
  const pool = await ownDatabase(connectionString!);
  try {
    await applyMigration(pool);
    const resolve = (roles: string[], userId = OID) =>
      resolveEffectiveAccess(principal(roles, userId), { executor: pool, useCache: false });

    await t.test("the seeded roles land exactly as the code describes them", async () => {
      const roles = await loadRoles(pool);
      assert.deepEqual(roles.map((r) => r.key).sort(), SEEDED_ROLES.map((r) => r.key).sort());
      for (const seed of SEEDED_ROLES) {
        const row = roles.find((r) => r.key === seed.key)!;
        assert.equal(row.name, seed.name, seed.key);
        assert.equal(row.purpose, seed.purpose, seed.key);
        assert.equal(row.locked, !!seed.locked, seed.key);
        assert.equal(row.allActions, !!seed.allActions, seed.key);
        assert.deepEqual(row.actions, [...seed.actions].sort(), seed.key);
      }
    });

    await t.test("a grant decides access, and the summary describes it", async () => {
      await grant(pool, OID, "compliance-manager");
      const access = await resolve([]);
      assert.equal(access.rolesInOnBoard, true);
      assert.deepEqual(access.roles.map((r) => [r.key, r.source]), [["compliance-manager", "onboard"]]);
      assert.ok(access.actions.includes("performance-assessment.decide"));
      assert.ok(access.actions.includes("compliance-review.review"));
      assert.ok(access.summary.some((line) => line.startsWith("Performance Assessment: view;")));
    });

    await t.test("an app role in the token still works beside an OnBoard grant", async () => {
      const access = await resolve(["OCC.Detour"]);
      assert.deepEqual(
        access.roles.map((r) => [r.key, r.source]).sort(),
        [["compliance-manager", "onboard"], ["detour-editor", "entra"]],
      );
      assert.ok(access.actions.includes("detours.edit"));
    });

    await t.test("a revoked grant stops deciding access at once", async () => {
      await pool.request().batch(`UPDATE AccessRoleGrants SET revoked_at = SYSUTCDATETIME(), revoked_by = 'contract test'`);
      assert.deepEqual((await resolve([])).actions, []);
    });

    await t.test("an expired grant is not access", async () => {
      await grant(pool, OTHER_OID, "publisher", "DATEADD(day, -1, SYSUTCDATETIME())");
      assert.deepEqual((await resolve([], OTHER_OID)).actions, []);
      await pool.request().batch(`UPDATE AccessRoleGrants SET expires_at = DATEADD(day, 1, SYSUTCDATETIME()) WHERE expires_at IS NOT NULL`);
      assert.ok((await resolve([], OTHER_OID)).actions.includes("rider-alerts.publish"));
    });

    await t.test("a suspended person holds nothing", async () => {
      await pool.request().batch(`UPDATE AccessPeople SET status = 'suspended' WHERE entra_object_id = '${OTHER_OID}'`);
      assert.deepEqual((await resolve([], OTHER_OID)).actions, []);
    });

    await t.test("the same role cannot be granted to a person twice while it is live", async () => {
      await assert.rejects(() => grant(pool, OTHER_OID, "publisher"));
    });

    await t.test("re-running the migration leaves an edited role alone", async () => {
      await pool.request().batch(`
        DELETE FROM AccessRoleActions WHERE role_key = 'viewer' AND action_key = 'detours.view';
        UPDATE AccessRoles SET purpose = 'Reads only what Ops needs.', updated_at = SYSUTCDATETIME(), updated_by = 'an admin' WHERE role_key = 'viewer';
        UPDATE AccessRoles SET archived_at = SYSUTCDATETIME() WHERE role_key = 'detour-editor';
      `);
      await applyMigration(pool);
      const roles = await loadRoles(pool);
      const viewer = roles.find((r) => r.key === "viewer")!;
      assert.equal(viewer.purpose, "Reads only what Ops needs.");
      assert.ok(!viewer.actions.includes("detours.view"));
      // An archived role is not restored, and stops resolving.
      assert.ok(!roles.some((r) => r.key === "detour-editor"));
    });

    await t.test("the first Access Administrator block grants one when it is filled in", async () => {
      const text = readFileSync(join(process.cwd(), "sql", `migration-${MIGRATION}.sql`), "utf8")
        // Only the DECLARE: the comparison below it must keep the placeholder.
        .replace("= 'PASTE-ENTRA-OBJECT-ID';", `= '${OTHER_OID}';`);
      for (const batch of batches(text)) await pool.request().batch(batch);
      await pool.request().batch(`UPDATE AccessPeople SET status = 'active' WHERE entra_object_id = '${OTHER_OID}'`);
      const access = await resolve([], OTHER_OID);
      assert.ok(access.actions.includes("access-identity.manage"));
      assert.ok(access.actions.includes("access-identity.approve"));
      // Running it again grants nothing twice.
      for (const batch of batches(text)) await pool.request().batch(batch);
      const again = await resolve([], OTHER_OID);
      assert.equal(again.roles.filter((r) => r.key === "access-administrator").length, 1);
    });
  } finally {
    await pool.close();
    const admin = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
    try {
      await admin.request().batch(`IF DB_ID('${DATABASE}') IS NOT NULL BEGIN ALTER DATABASE [${DATABASE}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${DATABASE}]; END;`);
    } finally {
      await admin.close();
    }
  }
});
