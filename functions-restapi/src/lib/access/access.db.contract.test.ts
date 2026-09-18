import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { CallerPrincipal } from "../auth";
import { parseConnectionString, sql } from "../db";
import { loadRoles, resolveEffectiveAccess, SEEDED_ROLES } from "./index";
import { archiveRole, createRole, restoreRole, roleHistory, updateRole } from "./roles";

// Migration 129's tables against a real SQL Server. The unit tests cover the
// catalog, the seeds and the pre-migration path; this file covers what only the
// database can show:
//
//   the nine seeded roles landing exactly as seeds.ts describes them;
//   a grant deciding access, and a revoked, expired or suspended one not;
//   a re-run leaving an Access Administrator's edits alone;
//   an app role in the token adding nothing to what was granted.
//
// Tables come from the real migration, in a database of its own (see
// assessmentLifecycle.db.contract.test.ts).
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;
const DATABASE = "mvta_access_roles_contract";
const MIGRATIONS = ["129-app-owned-roles", "130-access-role-history"];

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
  for (const migration of MIGRATIONS) {
    const text = readFileSync(join(process.cwd(), "sql", `migration-${migration}.sql`), "utf8");
    for (const batch of batches(text)) await pool.request().batch(batch);
  }
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

    await t.test("an app role in the token adds nothing to what was granted", async () => {
      // The cutover (increment 6): OCC.Detour used to resolve to Detour Editor
      // alongside the grant. A token now says who the caller is, and no more.
      const access = await resolve(["OCC.Detour"]);
      assert.deepEqual(access.roles.map((r) => [r.key, r.source]), [["compliance-manager", "onboard"]]);
      assert.ok(!access.actions.includes("detours.edit"));
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

    await t.test("an Access Administrator edits a role, and the summary follows the grid", async () => {
      const editor = { objectId: "editor-1", name: "An Administrator" };
      const created = await createRole(pool, { name: "Weekend Dispatcher", purpose: "Covers weekends.", actions: ["dashboard.view", "rider-alerts.view"] }, editor);
      assert.equal(created.key, "weekend-dispatcher");
      assert.deepEqual(created.summary, ["Dashboard: view only", "Rider Alerts: view only"]);
      assert.equal(created.members, 0);

      const widened = await updateRole(pool, "weekend-dispatcher", { actions: ["dashboard.view", "rider-alerts.view", "rider-alerts.publish"] }, editor);
      assert.deepEqual(widened.summary, ["Dashboard: view only", "Rider Alerts: view; Compose, edit, retract and approve alerts"]);

      // The role now decides access for anyone holding it, within a cache window.
      await grant(pool, OID, "weekend-dispatcher");
      const access = await resolveEffectiveAccess(principal([]), { executor: pool, useCache: false });
      assert.ok(access.actions.includes("rider-alerts.publish"));
    });

    await t.test("its history says who changed what", async () => {
      const entries = await roleHistory(pool, "weekend-dispatcher");
      assert.deepEqual(entries.map(e => e.change), ["updated", "created"]);
      assert.equal(entries[0].actorName, "An Administrator");
      assert.deepEqual(entries[0].before?.actions, ["dashboard.view", "rider-alerts.view"]);
      assert.ok(entries[0].after?.actions.includes("rider-alerts.publish"));
    });

    await t.test("a locked role cannot be edited or archived, and a held role cannot be archived", async () => {
      const editor = { objectId: "editor-1", name: "An Administrator" };
      await assert.rejects(() => updateRole(pool, "system-administrator", { purpose: "Everything." }, editor), /locked role/);
      await assert.rejects(() => archiveRole(pool, "access-administrator", editor), /locked role/);
      await assert.rejects(() => archiveRole(pool, "weekend-dispatcher", editor), /still held by 1 person/);
    });

    await t.test("no edit may widen a role into Access & Identity", async () => {
      const editor = { objectId: "editor-1", name: "An Administrator" };
      await assert.rejects(
        () => updateRole(pool, "weekend-dispatcher", { actions: ["dashboard.view", "access-identity.manage"] }, editor),
        /Privileged Access Change/,
      );
      await assert.rejects(
        () => createRole(pool, { name: "Shadow Admin", actions: ["access-identity.view"] }, editor),
        /Privileged Access Change/,
      );
    });

    await t.test("two roles cannot share a name", async () => {
      const editor = { objectId: "editor-1", name: "An Administrator" };
      await assert.rejects(() => createRole(pool, { name: "weekend dispatcher" }, editor), /already exists/);
    });

    await t.test("an archived role stops granting, and can be restored", async () => {
      const editor = { objectId: "editor-1", name: "An Administrator" };
      await pool.request().batch(`UPDATE AccessRoleGrants SET revoked_at = SYSUTCDATETIME() WHERE role_key = 'weekend-dispatcher'`);
      const archived = await archiveRole(pool, "weekend-dispatcher", editor);
      assert.equal(archived.archived, true);
      await grant(pool, OID, "weekend-dispatcher");
      assert.deepEqual((await resolveEffectiveAccess(principal([]), { executor: pool, useCache: false })).actions, []);
      const restored = await restoreRole(pool, "weekend-dispatcher", editor);
      assert.equal(restored.archived, false);
      assert.ok((await resolveEffectiveAccess(principal([]), { executor: pool, useCache: false })).actions.includes("rider-alerts.publish"));
    });

    await t.test("the first Access Administrator block grants one when it is filled in", async () => {
      const text = readFileSync(join(process.cwd(), "sql", `migration-${MIGRATIONS[0]}.sql`), "utf8")
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
