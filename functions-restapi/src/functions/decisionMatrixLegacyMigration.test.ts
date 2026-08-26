import assert from "node:assert/strict";
import test from "node:test";
import { HttpRequest, type InvocationContext } from "@azure/functions";
import { listDecisionMatrixLegacyCandidates } from "./decisionMatrixLegacyMigration";

const context = { error: () => undefined } as unknown as InvocationContext;

test("only an Admin can browse legacy Decision Matrix migration candidates", async () => {
  const principal = Buffer.from(JSON.stringify({ userId: "viewer-1", claims: [{ typ: "roles", val: "OCC.Viewer" }] })).toString("base64");
  const response = await listDecisionMatrixLegacyCandidates(new HttpRequest({ method: "GET", url: "https://example.test/api/admin/decision-matrix/legacy-candidates", headers: { "x-ms-client-principal": principal } }), context);
  assert.equal(response.status, 403);
});
