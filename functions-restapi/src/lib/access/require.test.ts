import assert from "node:assert/strict";
import test from "node:test";
import { HttpRequest } from "@azure/functions";
import { clearAccessCache } from "./index";
import { fakeAccessDb, type FakeGrant } from "./testSupport";
import { describeAction, requireAccess, requireAccessOrIngestion, requireAnyAccess, requireAnyOnBoardAccess } from "./require";

// Since the cutover a token says who the caller is and nothing about what they
// may do, so each case states what the person holds as a grant.
function requestFor(appRoles: string[] = [], method = "GET"): HttpRequest {
  const principal = Buffer.from(
    JSON.stringify({
      userId: "oid-1",
      userDetails: "someone@example.com",
      claims: [{ typ: "tid", val: "tenant-1" }, ...appRoles.map((val) => ({ typ: "roles", val }))],
    }),
  ).toString("base64");
  return new HttpRequest({
    method,
    url: "https://example.test/api/anything",
    headers: { "x-ms-client-principal": principal },
  });
}

const holding = (...roleKeys: string[]): { executor: ReturnType<typeof fakeAccessDb> } => ({
  executor: fakeAccessDb(roleKeys.map((roleKey): FakeGrant => ({ objectId: "oid-1", roleKey }))),
});

test("requireAccess", async (t) => {
  t.beforeEach(() => clearAccessCache());

  await t.test("admits the caller who holds the action", async () => {
    const result = await requireAccess(requestFor(), "dispatch-log.verify", holding("trip-start-verifier"));
    assert.equal(result.authorized, true);
    assert.equal(result.authorized && result.principal.userId, "oid-1");
  });

  await t.test("refuses the caller who does not, in words they can act on", async () => {
    const result = await requireAccess(requestFor(), "detours.delete", holding("viewer"));
    assert.deepEqual(result, {
      authorized: false,
      status: 403,
      message: "Requires Delete detours on Detours & Closures. Your roles are: Viewer.",
    });
  });

  await t.test("an app role in the token is not access", async () => {
    // Before the cutover this call was authorized. That is the change.
    const result = await requireAccess(requestFor(["OCC.Admin"]), "detours.delete", holding());
    assert.equal(result.authorized, false);
    assert.match(result.authorized === false ? result.message : "", /no OnBoard role yet/);
  });

  await t.test("401 without a principal, which a 403 must not be confused with", async () => {
    const result = await requireAccess(
      new HttpRequest({ method: "GET", url: "https://example.test/api/anything" }),
      "dashboard.view",
      holding("viewer"),
    );
    assert.deepEqual(result, { authorized: false, status: 401, message: "Not authenticated." });
  });

  await t.test("a workload identity is refused every human action", async () => {
    const result = await requireAccess(requestFor(["System.Ingestion"]), "rider-alerts.publish", holding("publisher"));
    assert.deepEqual(result, {
      authorized: false,
      status: 403,
      message: "System.Ingestion holds no human OnBoard access.",
    });
  });

  await t.test("the administrator's wildcard stops at Access & Identity", async () => {
    const admin = holding("system-administrator");
    assert.equal((await requireAccess(requestFor(), "detours.intake", admin)).authorized, true);
    assert.equal((await requireAccess(requestFor(), "access-identity.manage", admin)).authorized, false);
  });

  await t.test("requireAnyAccess admits either reader and names both when it refuses", async () => {
    assert.equal(
      (await requireAnyAccess(requestFor(), ["governance-audit.view", "access-identity.view"], holding("access-administrator")))
        .authorized,
      true,
    );
    const refused = await requireAnyAccess(
      requestFor(),
      ["governance-audit.view", "access-identity.view"],
      holding("detour-editor"),
    );
    assert.equal(refused.authorized, false);
    assert.match(refused.authorized === false ? refused.message : "", /Governance & Audit.*Access & Identity/s);
  });

  await t.test("shared reference data asks only for some OnBoard access", async () => {
    assert.equal((await requireAnyOnBoardAccess(requestFor(), holding("detour-editor"))).authorized, true);
    assert.equal((await requireAnyOnBoardAccess(requestFor(), holding())).authorized, false);
    // A workload identity is not a person browsing the console.
    assert.equal((await requireAnyOnBoardAccess(requestFor(["System.Ingestion"]), holding("publisher"))).authorized, false);
  });

  await t.test("the shared ingestion route admits the workload identity and publishers only", async () => {
    const action = "rider-alerts.publish";
    assert.equal((await requireAccessOrIngestion(requestFor(["System.Ingestion"]), action, holding())).authorized, true);
    assert.equal((await requireAccessOrIngestion(requestFor(), action, holding("publisher"))).authorized, true);
    assert.equal((await requireAccessOrIngestion(requestFor(), action, holding("viewer"))).authorized, false);
  });

  await t.test("describeAction reads as the Roles page does", () => {
    assert.equal(describeAction("performance-assessment.decide"), "Finalize, reopen, issue and decide exceptions on Performance Assessment");
    assert.equal(describeAction("dashboard.view"), "View on Dashboard");
  });
});
