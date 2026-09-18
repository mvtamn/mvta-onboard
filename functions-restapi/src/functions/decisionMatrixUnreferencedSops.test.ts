import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { HttpRequest, type InvocationContext } from "@azure/functions";
import { listUnreferencedSops, walkSopFolder } from "./decisionMatrixUnreferencedSops";
import { useAccessExecutorForTests } from "../lib/access";
import { fakeAccessDb } from "../lib/access/testSupport";

// Since the cutover an app role in a token grants nobody anything, so a case
// states what its caller holds as a Role Grant, the way production reads it.
function holding(...roleKeys: string[]) {
  useAccessExecutorForTests(fakeAccessDb(roleKeys.map((roleKey) => ({ objectId: "*", roleKey }))));
}

afterEach(() => useAccessExecutorForTests(null));

const context = { error: () => undefined, log: () => undefined, warn: () => undefined } as unknown as InvocationContext;

test("the Unreferenced SOP report is for Admins", async () => {
  holding("publisher");
  const principal = Buffer.from(JSON.stringify({ userId: "publisher-oid" })).toString("base64");
  const request = new HttpRequest({ method: "GET", url: "https://example.test/api/manage/decision-matrix/library/unreferenced", headers: { "x-ms-client-principal": principal } });
  const response = await listUnreferencedSops(request, context);
  assert.equal(response.status, 403);
  // Names the role the caller really holds, so the refusal cannot pass by the
  // caller holding nothing at all.
  assert.match((response.jsonBody as { error: string }).error, /Your roles are: Publisher\./);
});

// A walk that cannot run says why and touches nothing: no database connection
// is configured in this test, so reaching for one would fail rather than skip.
test("a walk with no library, credential or SOP folder is skipped with the reason", async () => {
  assert.equal(await walkSopFolder(context, { reason: "No credential is configured for browsing SharePoint." }), "skipped: No credential is configured for browsing SharePoint.");
  const unconfigured = await walkSopFolder(context, {
    config: { site_id: "s", drive_id: "d" },
    listFolder: async () => { throw new Error("SharePoint was asked"); },
    setting: { configured: false, reason: "No SOP folder is configured." },
  });
  assert.equal(unconfigured, "skipped: No SOP folder is configured.");
});
