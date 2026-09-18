import assert from "node:assert/strict";
import test from "node:test";
import type { CallerPrincipal } from "../auth";
import { fakeAccessDb } from "./testSupport";
import {
  accessSummaryLines,
  actionKey,
  allActionKeysExceptAccess,
  ACCESS_MODULE,
  isKnownAction,
  MODULES,
  resolveEffectiveAccess,
  SEEDED_ROLES,
  seededRole,
  unknownSeededActions,
  VIEW,
} from "./index";

const principal = (roles: string[], userId = "oid-1"): CallerPrincipal => ({
  userId,
  userDetails: "someone@example.com",
  roles,
  claims: { tid: ["tenant-1"], name: ["Someone"] },
});

test("the catalog", async (t) => {
  await t.test("every module key is unique and every action belongs to a module", () => {
    assert.equal(new Set(MODULES.map((m) => m.key)).size, MODULES.length);
    for (const module of MODULES) {
      assert.equal(new Set(module.actions.map((a) => a.key)).size, module.actions.length);
      assert.ok(!module.actions.some((a) => a.key === VIEW), `${module.key} lists view as its own action`);
      assert.ok(isKnownAction(actionKey(module.key, VIEW)));
    }
    assert.equal(isKnownAction("detours.delete"), true);
    assert.equal(isKnownAction("detours.approve"), false);
    assert.equal(isKnownAction("nowhere.view"), false);
  });

  await t.test("System Administrator's wildcard stops at Access & Identity", () => {
    const wildcard = allActionKeysExceptAccess();
    assert.ok(wildcard.includes("performance-assessment.decide"));
    assert.ok(!wildcard.some((key) => key.startsWith(`${ACCESS_MODULE}.`)));
  });

  await t.test("the summary names each module in plain words", () => {
    assert.deepEqual(
      accessSummaryLines(["dispatch-log.view", "dispatch-log.verify", "detours.view"]),
      ["Dispatch Log: view; Record trip-start verifications", "Detours & Closures: view only"],
    );
  });

  await t.test("an action held without view is called out rather than hidden", () => {
    assert.deepEqual(accessSummaryLines(["detours.delete"]), [
      "Detours & Closures: Delete detours (cannot open the page)",
    ]);
  });
});

test("the seeded roles", async (t) => {
  await t.test("grant only actions the catalog defines", () => {
    assert.deepEqual(unknownSeededActions(), []);
  });

  await t.test("Compliance Manager can do everything the Analyst can, and decide", () => {
    const analyst = seededRole("compliance-analyst")!;
    const manager = seededRole("compliance-manager")!;
    for (const action of analyst.actions) assert.ok(manager.actions.includes(action), action);
    assert.ok(manager.actions.includes("performance-assessment.decide"));
    // The drift this replaces: the page admitted a manager its data calls refused.
    assert.ok(manager.actions.includes("compliance-review.view"));
    assert.ok(manager.actions.includes("compliance-review.review"));
  });

  await t.test("Access Administrator can open its own pages", () => {
    const role = seededRole("access-administrator")!;
    assert.ok(role.actions.includes("subscribers.view"));
    assert.ok(role.actions.includes("governance-audit.view"));
    assert.ok(role.locked);
  });

  await t.test("Viewer and Publisher keep the compliance read the API already gave them", () => {
    for (const key of ["viewer", "publisher"]) {
      const role = seededRole(key)!;
      assert.ok(role.actions.includes("compliance-review.view"));
      assert.ok(role.actions.includes("performance-assessment.view"));
      assert.ok(!role.actions.includes("compliance-review.review"));
      assert.ok(!role.actions.includes("performance-assessment.work"));
    }
  });

  await t.test("exactly two roles are locked, and only one holds the wildcard", () => {
    assert.deepEqual(
      SEEDED_ROLES.filter((r) => r.locked).map((r) => r.key),
      ["system-administrator", "access-administrator"],
    );
    assert.deepEqual(
      SEEDED_ROLES.filter((r) => r.allActions).map((r) => r.key),
      ["system-administrator"],
    );
  });
});

test("resolving Effective Access after the cutover", async (t) => {
  const resolve = (grants: { objectId: string; roleKey: string }[], roles: string[] = [], ready = true) =>
    resolveEffectiveAccess(principal(roles), { executor: fakeAccessDb(grants, { ready }), useCache: false });

  await t.test("a grant in OnBoard is what a person holds", async () => {
    const access = await resolve([{ objectId: "oid-1", roleKey: "trip-start-verifier" }]);
    assert.equal(access.rolesInOnBoard, true);
    assert.deepEqual(access.roles.map((r) => [r.key, r.source]), [["trip-start-verifier", "onboard"]]);
    assert.deepEqual(access.actions, ["dispatch-log.verify", "dispatch-log.view"]);
    assert.deepEqual(access.summary, ["Dispatch Log: view; Record trip-start verifications"]);
  });

  await t.test("an app role in the token grants nothing at all", async () => {
    // The whole point of the cutover: OCC.Admin used to be everything.
    const access = await resolve([], ["OCC.Admin", "OCC.Publisher"]);
    assert.deepEqual(access.actions, []);
    assert.deepEqual(access.roles, []);
  });

  await t.test("two grants combine", async () => {
    const access = await resolve([
      { objectId: "oid-1", roleKey: "detour-editor" },
      { objectId: "oid-1", roleKey: "trip-start-verifier" },
    ]);
    assert.deepEqual(access.roles.map((r) => r.key).sort(), ["detour-editor", "trip-start-verifier"]);
    assert.ok(access.actions.includes("detours.edit"));
    assert.ok(access.actions.includes("dispatch-log.verify"));
  });

  await t.test("the wildcard role holds every action except managing access", async () => {
    const access = await resolve([{ objectId: "oid-1", roleKey: "system-administrator" }]);
    assert.ok(access.actions.includes("detours.intake"));
    assert.ok(access.actions.includes("service-configuration.edit"));
    assert.ok(!access.actions.some((a) => a.startsWith("access-identity.")));
  });

  await t.test("a workload identity inherits no human authority", async () => {
    const access = await resolve([{ objectId: "oid-1", roleKey: "system-administrator" }], ["System.Ingestion"]);
    assert.equal(access.ingestion, true);
    assert.deepEqual(access.actions, []);
  });

  await t.test("an environment without the tables grants nobody anything", async () => {
    const access = await resolve([{ objectId: "oid-1", roleKey: "publisher" }], ["OCC.Admin"], false);
    assert.equal(access.rolesInOnBoard, false);
    assert.deepEqual(access.actions, []);
    assert.equal(access.person.objectId, "oid-1");
  });
});
