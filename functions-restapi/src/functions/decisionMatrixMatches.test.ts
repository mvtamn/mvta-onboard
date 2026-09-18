import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { HttpRequest, type InvocationContext } from "@azure/functions";
import { createDecisionMatrixMatchRule, listDecisionMatrixRecommendations } from "./decisionMatrixMatches";
import { useAccessExecutorForTests } from "../lib/access";
import { fakeAccessDb } from "../lib/access/testSupport";

// Since the cutover an app role in a token grants nobody anything, so a case
// states what its caller holds as a Role Grant, the way production reads it.
function holding(...roleKeys: string[]) {
  useAccessExecutorForTests(fakeAccessDb(roleKeys.map((roleKey) => ({ objectId: "*", roleKey }))));
}

afterEach(() => useAccessExecutorForTests(null));

const context = { error: () => undefined } as unknown as InvocationContext;

function request(url: string, body?: unknown, userId = "admin-1") {
  return new HttpRequest({ method: body ? "POST" : "GET", url, headers: { "content-type": "application/json", "x-ms-client-principal": Buffer.from(JSON.stringify({ userId })).toString("base64") }, body: body ? { string: JSON.stringify(body) } : undefined });
}

test("only an Admin can author Decision Matrix match rules", async () => {
  holding("publisher");
  const response = await createDecisionMatrixMatchRule(request("https://example.test/api/manage/decision-matrix/match-rules", { source_type: "SuggestedAlert" }), context);
  assert.equal(response.status, 403);
  // Names the role the caller really holds, so the refusal cannot pass by the
  // caller holding nothing at all.
  assert.match((response.jsonBody as { error: string }).error, /Your roles are: Publisher\./);
});

test("recommendations require an explicit supported operational source and qualifier", async () => {
  holding("viewer");
  const response = await listDecisionMatrixRecommendations(request("https://example.test/api/decision-matrix/recommendations?source_type=Unknown&source_qualifier=x"), context);
  assert.equal(response.status, 400);
});
