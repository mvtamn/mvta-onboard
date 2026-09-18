import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { CallerPrincipal } from "../auth";
import { parseConnectionString, sql } from "../db";
import { resolveEffectiveAccess } from "./index";
import {
  accessFindings,
  cancelRequest,
  decideRequest,
  grantRole,
  importAssignments,
  listPeople,
  listRequests,
  recordSignIn,
  revokeGrant,
  type Actor,
} from "./grants";

// Granting and revoking against a real SQL Server (ADR-0032, increment 5).
// What only the database can show:
//
//   an ordinary grant deciding access at once, and the same grant twice not;
//   a Privileged Access Change waiting for a second Access Administrator, who
//     cannot be the person who asked, and whose approval goes stale;
//   OnBoard refusing to leave itself with nobody able to manage access;
//   the one-time Entra import being safe to run twice;
//   health findings answering what an administrator should look at now.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;
const DATABASE = "mvta_access_grants_contract";
const MIGRATIONS = ["129-app-owned-roles", "130-access-role-history", "131-onboard-grant-requests"];

const ALICE = "aaaaaaaa-1111-4111-8111-111111111111";
const BEN = "bbbbbbbb-2222-4222-8222-222222222222";
const CHRIS = "cccccccc-3333-4333-8333-333333333333";

const admin = (name: string, objectId: string): Actor => ({ objectId, name, steppedUp: true });
const withoutStepUp = (actor: Actor): Actor => ({ ...actor, steppedUp: false });

function batches(text: string): string[] {
  return text.split(/^\s*GO\s*$/im).map((b) => b.trim()).filter(Boolean);
}

async function ownDatabase(cs: string): Promise<sql.ConnectionPool> {
  const setup = await new sql.ConnectionPool(parseConnectionString(cs)).connect();
  try {
    await setup.request().batch(
      `IF DB_ID('${DATABASE}') IS NOT NULL BEGIN ALTER DATABASE [${DATABASE}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${DATABASE}]; END; CREATE DATABASE [${DATABASE}];`,
    );
  } finally {
    await setup.close();
  }
  const pool = await new sql.ConnectionPool({ ...parseConnectionString(cs), database: DATABASE }).connect();
  for (const migration of MIGRATIONS) {
    const text = readFileSync(join(process.cwd(), "sql", `migration-${migration}.sql`), "utf8");
    for (const batch of batches(text)) await pool.request().batch(batch);
  }
  return pool;
}

const principal = (objectId: string): CallerPrincipal => ({
  userId: objectId,
  userDetails: `${objectId}@example.com`,
  roles: [],
  claims: { tid: ["tenant-1"] },
});

const personId = async (pool: sql.ConnectionPool, objectId: string) =>
  (await listPeople(pool)).find((p) => p.objectId === objectId)!.personId;

test("granting OnBoard access against real SQL", { skip: !connectionString && "DECISION_MATRIX_TEST_SQL_CONNECTION_STRING not set" }, async (t) => {
  const pool = await ownDatabase(connectionString!);
  try {
    for (const oid of [ALICE, BEN, CHRIS]) {
      await recordSignIn(pool, { objectId: oid, tenantId: "tenant-1", name: oid.slice(0, 5), email: `${oid.slice(0, 5)}@example.com` });
    }
    const alice = admin("Alice", ALICE);
    const ben = admin("Ben", BEN);

    await t.test("signing in is how somebody comes to be listed, and it is not access", async () => {
      const people = await listPeople(pool);
      assert.equal(people.length, 3);
      assert.ok(people.every((p) => p.roles.length === 0 && p.lastSeenAt));
      // Twice is the same person, not two.
      await recordSignIn(pool, { objectId: ALICE, tenantId: "tenant-1", name: "Alice Again", email: null });
      assert.equal((await listPeople(pool)).length, 3);
    });

    await t.test("an ordinary grant decides access at once, and twice is once", async () => {
      const outcome = await grantRole(pool, { personId: await personId(pool, CHRIS), roleKey: "publisher", reason: "Runs alerts." }, alice);
      assert.equal(outcome.disposition, "applied");
      const access = await resolveEffectiveAccess(principal(CHRIS), { executor: pool, useCache: false });
      assert.ok(access.actions.includes("rider-alerts.publish"));
      assert.equal(access.roles[0].source, "onboard");

      const again = await grantRole(pool, { personId: await personId(pool, CHRIS), roleKey: "publisher", reason: "Again." }, alice);
      assert.equal(again.disposition, "already_held");
    });

    await t.test("a grant needs a reason, and an expiry cannot be in the past", async () => {
      const chris = await personId(pool, CHRIS);
      await assert.rejects(() => grantRole(pool, { personId: chris, roleKey: "viewer", reason: "  " }, alice), /why this access/);
      await assert.rejects(
        () => grantRole(pool, { personId: chris, roleKey: "viewer", reason: "Reads.", expiresAt: "2020-01-01T00:00:00Z" }, alice),
        /in the future/,
      );
    });

    await t.test("a privileged role waits for a second Access Administrator", async () => {
      const outcome = await grantRole(pool, { personId: await personId(pool, BEN), roleKey: "access-administrator", reason: "Runs access." }, alice);
      assert.equal(outcome.disposition, "pending_approval");
      // Nothing is granted while it waits.
      assert.deepEqual((await resolveEffectiveAccess(principal(BEN), { executor: pool, useCache: false })).actions, []);

      const pending = (await listRequests(pool)).filter((r) => r.status === "pending");
      assert.equal(pending.length, 1);
      assert.equal(pending[0].roleName, "Access Administrator");

      // The person who asked cannot be the second person.
      await assert.rejects(
        () => decideRequest(pool, { requestId: pending[0].requestId, approve: true }, alice),
        /second Access Administrator/,
      );
      // And a decision without a recent step-up is refused.
      await assert.rejects(
        () => decideRequest(pool, { requestId: pending[0].requestId, approve: true }, withoutStepUp(ben)),
        /sign-in confirmation/,
      );

      const decided = await decideRequest(pool, { requestId: pending[0].requestId, approve: true, reason: "Agreed." }, ben);
      assert.equal(decided.status, "approved");
      const access = await resolveEffectiveAccess(principal(BEN), { executor: pool, useCache: false });
      assert.ok(access.actions.includes("access-identity.manage"));
      assert.equal((await listRequests(pool)).find((r) => r.requestId === pending[0].requestId)?.decidedByName, "Ben");
    });

    await t.test("asking twice for the same thing is one request, and it can be cancelled", async () => {
      const chris = await personId(pool, CHRIS);
      const first = await grantRole(pool, { personId: chris, roleKey: "system-administrator", reason: "Covers ops." }, alice);
      const second = await grantRole(pool, { personId: chris, roleKey: "system-administrator", reason: "Covers ops." }, alice);
      assert.equal(first.disposition, "pending_approval");
      assert.deepEqual(first, second);
      if (first.disposition !== "pending_approval") throw new Error("unreachable");
      assert.equal((await cancelRequest(pool, { requestId: first.requestId, reason: "Not needed." }, alice)).status, "cancelled");
      await assert.rejects(() => decideRequest(pool, { requestId: first.requestId, approve: true }, ben), /already cancelled/);
    });

    await t.test("an approval goes stale after its window", async () => {
      const chris = await personId(pool, CHRIS);
      const outcome = await grantRole(pool, { personId: chris, roleKey: "system-administrator", reason: "Covers ops." }, alice);
      if (outcome.disposition !== "pending_approval") throw new Error("expected a pending request");
      await pool.request().batch(`UPDATE AccessGrantRequests SET approval_expires_at = DATEADD(hour, -1, SYSUTCDATETIME()) WHERE request_id = '${outcome.requestId}'`);
      assert.equal((await listRequests(pool)).find((r) => r.requestId === outcome.requestId)?.status, "expired");
      await assert.rejects(() => decideRequest(pool, { requestId: outcome.requestId, approve: true }, ben), /approval window/);
    });

    await t.test("OnBoard refuses to leave itself with nobody able to manage access", async () => {
      const bensGrant = (await listPeople(pool)).find((p) => p.objectId === BEN)!.roles[0];
      await assert.rejects(
        () => revokeGrant(pool, { grantId: bensGrant.grantId, reason: "Leaving." }, alice),
        /nobody able to manage OnBoard access/,
      );
      // With a second administrator in place it is allowed - and, being
      // privileged, it waits for a decision rather than applying.
      const outcome = await grantRole(pool, { personId: await personId(pool, ALICE), roleKey: "access-administrator", reason: "Second admin." }, ben);
      if (outcome.disposition !== "pending_approval") throw new Error("expected a pending request");
      await decideRequest(pool, { requestId: outcome.requestId, approve: true }, alice);
      const removal = await revokeGrant(pool, { grantId: bensGrant.grantId, reason: "Leaving." }, alice);
      assert.equal(removal.disposition, "pending_approval");
    });

    await t.test("an ordinary removal applies at once", async () => {
      const chris = (await listPeople(pool)).find((p) => p.objectId === CHRIS)!;
      const publisher = chris.roles.find((r) => r.roleKey === "publisher")!;
      assert.equal((await revokeGrant(pool, { grantId: publisher.grantId, reason: "Moved teams." }, alice)).disposition, "applied");
      assert.deepEqual((await resolveEffectiveAccess(principal(CHRIS), { executor: pool, useCache: false })).actions, []);
      await assert.rejects(() => revokeGrant(pool, { grantId: publisher.grantId, reason: "Again." }, alice), /already been removed/);
    });

    await t.test("the Entra import is safe to run twice and invents no roles", async () => {
      const assignments = [
        { objectId: CHRIS, tenantId: "tenant-1", name: "Chris", email: "chris@example.com", roleKey: "viewer", via: "OCC Viewers group" },
        { objectId: "dddddddd-4444-4444-8444-444444444444", tenantId: "tenant-1", name: "Dana", email: "dana@example.com", roleKey: "compliance-analyst", via: "app role" },
        { objectId: CHRIS, tenantId: "tenant-1", name: "Chris", email: null, roleKey: "not-a-role", via: "app role" },
      ];
      const first = await importAssignments(pool, assignments, alice);
      assert.deepEqual([first.granted, first.skipped, first.unknownRoles], [2, 1, ["not-a-role"]]);
      const second = await importAssignments(pool, assignments, alice);
      assert.equal(second.granted, 0);
      const dana = (await listPeople(pool)).find((p) => p.email === "dana@example.com")!;
      assert.equal(dana.importedFrom, "entra");
      assert.equal(dana.roles[0].grantedBy, "imported from Entra (app role)");
      assert.ok((await resolveEffectiveAccess(principal(CHRIS), { executor: pool, useCache: false })).actions.includes("dashboard.view"));
    });

    await t.test("health reports what an administrator should look at now", async () => {
      const codes = (await accessFindings(pool)).map((f) => f.code);
      // Alice and Ben can both manage access, so that finding is absent.
      assert.ok(!codes.includes("few_access_administrators"));
      assert.ok(codes.includes("roles_nobody_holds"));
      await pool.request().batch(`UPDATE AccessRoleGrants SET revoked_at = SYSUTCDATETIME() WHERE role_key = 'access-administrator'`);
      const after = (await accessFindings(pool)).find((f) => f.code === "few_access_administrators");
      assert.equal(after?.headline, "Nobody in OnBoard can manage access");
      const orphans = (await accessFindings(pool)).find((f) => f.code === "signed_in_without_access");
      assert.ok(orphans?.headline.includes("signed in and hold no role"));
    });
  } finally {
    await pool.close();
    const cleanup = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
    try {
      await cleanup.request().batch(`IF DB_ID('${DATABASE}') IS NOT NULL BEGIN ALTER DATABASE [${DATABASE}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${DATABASE}]; END;`);
    } finally {
      await cleanup.close();
    }
  }
});
