import assert from "node:assert/strict";
import test from "node:test";
import { HttpRequest, type InvocationContext } from "@azure/functions";
import { createDecisionMatrixMatchRule, listDecisionMatrixRecommendations } from "./decisionMatrixMatches";

const context = { error: () => undefined } as unknown as InvocationContext;

function request(roles: string[], url: string, body?: unknown, userId = "admin-1") {
  return new HttpRequest({ method: body ? "POST" : "GET", url, headers: { "content-type": "application/json", "x-ms-client-principal": Buffer.from(JSON.stringify({ userId, claims: roles.map((val) => ({ typ: "roles", val })) })).toString("base64") }, body: body ? { string: JSON.stringify(body) } : undefined });
}

test("only an Admin can author Decision Matrix match rules", async () => {
  const response = await createDecisionMatrixMatchRule(request(["OCC.Publisher"], "https://example.test/api/admin/decision-matrix/match-rules", { source_type: "SuggestedAlert" }), context);
  assert.equal(response.status, 403);
});

test("recommendations require an explicit supported operational source and qualifier", async () => {
  const response = await listDecisionMatrixRecommendations(request(["OCC.Viewer"], "https://example.test/api/decision-matrix/recommendations?source_type=Unknown&source_qualifier=x"), context);
  assert.equal(response.status, 400);
});
