import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { HttpRequest, type InvocationContext } from "@azure/functions";
import { listDecisionMatrixLegacyCandidates } from "./decisionMatrixLegacyMigration";
import { useAccessExecutorForTests } from "../lib/access";
import { fakeAccessDb } from "../lib/access/testSupport";

// Since the cutover an app role in a token grants nobody anything, so a case
// states what its caller holds as a Role Grant, the way production reads it.
function holding(...roleKeys: string[]) {
  useAccessExecutorForTests(fakeAccessDb(roleKeys.map((roleKey) => ({ objectId: "*", roleKey }))));
}

afterEach(() => useAccessExecutorForTests(null));

const context = { error: () => undefined } as unknown as InvocationContext;

test("only an Admin can browse legacy Decision Matrix migration candidates", async () => {
  holding("viewer");
  const principal = Buffer.from(JSON.stringify({ userId: "viewer-1" })).toString("base64");
  const response = await listDecisionMatrixLegacyCandidates(new HttpRequest({ method: "GET", url: "https://example.test/api/manage/decision-matrix/legacy-candidates", headers: { "x-ms-client-principal": principal } }), context);
  assert.equal(response.status, 403);
  // Names the role the caller really holds, so the refusal cannot pass by the
  // caller holding nothing at all.
  assert.match((response.jsonBody as { error: string }).error, /Your roles are: Viewer\./);
});
