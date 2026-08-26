import assert from "node:assert/strict";
import test from "node:test";
import { HttpRequest, type InvocationContext } from "@azure/functions";
import { listDecisionMatrixAudit, listDecisionMatrixGovernanceQueue } from "./decisionMatrixAdminGovernance";

const context = { error: () => undefined } as unknown as InvocationContext;

test("only Admins can inspect the Decision Matrix governance queue and audit", async () => {
  const principal = Buffer.from(JSON.stringify({ claims: [{ typ: "roles", val: "OCC.Publisher" }] })).toString("base64");
  const request = new HttpRequest({ method: "GET", url: "https://example.test/api/admin/decision-matrix/governance-queue", headers: { "x-ms-client-principal": principal } });
  assert.equal((await listDecisionMatrixGovernanceQueue(request, context)).status, 403);
  assert.equal((await listDecisionMatrixAudit(request, context)).status, 403);
});
