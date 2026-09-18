import assert from "node:assert/strict";
import test from "node:test";
import { HttpRequest } from "@azure/functions";
import { clearAccessCache } from "./index";
import { describeAction, requireAccess, requireAccessOrIngestion, requireAnyAccess, requireAnyOnBoardAccess } from "./require";

// No SQL connection is configured in the unit suite, so the resolver falls back
// to the seeded roles keyed by the app roles in the token - the same path every
// environment runs until migration 129 is applied.
function requestFor(roles: string[], method = "GET"): HttpRequest {
  const principal = Buffer.from(
    JSON.stringify({
      userId: "oid-1",
      userDetails: "someone@example.com",
      claims: [{ typ: "tid", val: "tenant-1" }, ...roles.map((val) => ({ typ: "roles", val }))],
    }),
  ).toString("base64");
  return new HttpRequest({
    method,
    url: "https://example.test/api/anything",
    headers: { "x-ms-client-principal": principal },
  });
}

test("requireAccess", async (t) => {
  t.beforeEach(() => clearAccessCache());

  await t.test("admits the caller who holds the action", async () => {
    const result = await requireAccess(requestFor(["OCC.TripStartVerify"]), "dispatch-log.verify");
    assert.equal(result.authorized, true);
    assert.equal(result.authorized && result.principal.userId, "oid-1");
  });

  await t.test("refuses the caller who does not, in words they can act on", async () => {
    const result = await requireAccess(requestFor(["OCC.Viewer"]), "detours.delete");
    assert.deepEqual(result, {
      authorized: false,
      status: 403,
      message: "Requires Delete detours on Detours & Closures. Your roles are: Viewer.",
    });
  });

  await t.test("says so when the caller holds nothing at all", async () => {
    const result = await requireAccess(requestFor([]), "dashboard.view");
    assert.equal(result.authorized, false);
    assert.match(result.authorized === false ? result.message : "", /no OnBoard role yet/);
  });

  await t.test("401 without a principal, which a 403 must not be confused with", async () => {
    const result = await requireAccess(
      new HttpRequest({ method: "GET", url: "https://example.test/api/anything" }),
      "dashboard.view",
    );
    assert.deepEqual(result, { authorized: false, status: 401, message: "Not authenticated." });
  });

  await t.test("a workload identity is refused every human action", async () => {
    const result = await requireAccess(requestFor(["System.Ingestion"]), "rider-alerts.publish");
    assert.deepEqual(result, {
      authorized: false,
      status: 403,
      message: "System.Ingestion holds no human OnBoard access.",
    });
  });

  await t.test("the administrator's wildcard stops at Access & Identity", async () => {
    assert.equal((await requireAccess(requestFor(["OCC.Admin"]), "detours.intake")).authorized, true);
    assert.equal((await requireAccess(requestFor(["OCC.Admin"]), "access-identity.manage")).authorized, false);
  });

  await t.test("requireAnyAccess admits either reader and names both when it refuses", async () => {
    assert.equal(
      (await requireAnyAccess(requestFor(["OCC.AccessAdmin"]), ["governance-audit.view", "access-identity.view"]))
        .authorized,
      true,
    );
    const refused = await requireAnyAccess(requestFor(["OCC.Detour"]), ["governance-audit.view", "access-identity.view"]);
    assert.equal(refused.authorized, false);
    assert.match(refused.authorized === false ? refused.message : "", /Governance & Audit.*Access & Identity/s);
  });

  await t.test("shared reference data asks only for some OnBoard access", async () => {
    assert.equal((await requireAnyOnBoardAccess(requestFor(["OCC.Detour"]))).authorized, true);
    assert.equal((await requireAnyOnBoardAccess(requestFor([]))).authorized, false);
    // A workload identity is not a person browsing the console.
    assert.equal((await requireAnyOnBoardAccess(requestFor(["System.Ingestion"]))).authorized, false);
  });

  await t.test("the shared ingestion route admits the workload identity and publishers only", async () => {
    const action = "rider-alerts.publish";
    assert.equal((await requireAccessOrIngestion(requestFor(["System.Ingestion"]), action)).authorized, true);
    assert.equal((await requireAccessOrIngestion(requestFor(["OCC.Publisher"]), action)).authorized, true);
    assert.equal((await requireAccessOrIngestion(requestFor(["OCC.Viewer"]), action)).authorized, false);
  });

  await t.test("describeAction reads as the Roles page does", () => {
    assert.equal(describeAction("performance-assessment.decide"), "Finalize, reopen, issue and decide exceptions on Performance Assessment");
    assert.equal(describeAction("dashboard.view"), "View on Dashboard");
  });
});
