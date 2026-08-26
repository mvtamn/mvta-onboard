import assert from "node:assert/strict";
import test from "node:test";
import { HttpRequest, type InvocationContext } from "@azure/functions";
import { checkDecisionMatrixProcedureReferences, governDecisionMatrixProcedureRevision } from "./decisionMatrixProcedureGovernance";

const context = { error: () => undefined } as unknown as InvocationContext;

function requestFor(roles: string[], body: unknown, userId?: string) {
  return new HttpRequest({
    method: "POST",
    url: "https://example.test/api/admin/decision-matrix/procedures/procedure-1/revisions/1/lifecycle",
    params: { procedureId: "procedure-1", revision: "1" },
    headers: { "content-type": "application/json", "x-ms-client-principal": Buffer.from(JSON.stringify({ userId, claims: roles.map((val) => ({ typ: "roles", val })) })).toString("base64") },
    body: { string: JSON.stringify(body) },
  });
}

test("only an Admin can govern a Procedure Revision or check its document references", async () => {
  const lifecycle = await governDecisionMatrixProcedureRevision(requestFor(["OCC.Publisher"], { action: "approve", reason: "Not authorized." }), context);
  const check = await checkDecisionMatrixProcedureReferences(requestFor(["OCC.Publisher"], {}), context);
  assert.equal(lifecycle.status, 403);
  assert.equal(check.status, 403);
});

test("every lifecycle decision records an explicit reason and withdrawal confirmation", async () => {
  const noReason = await governDecisionMatrixProcedureRevision(requestFor(["OCC.Admin"], { action: "submit_for_review" }), context);
  const noConfirmation = await governDecisionMatrixProcedureRevision(requestFor(["OCC.Admin"], { action: "withdraw", reason: "Dangerous guidance." }), context);
  assert.deepEqual(noReason.jsonBody, { error: "A governance reason is required." });
  assert.deepEqual(noConfirmation.jsonBody, { error: "Emergency withdrawal requires prominent confirmation." });
});

test("a governance action requires an immutable Admin identity for its audit evidence", async () => {
  const response = await governDecisionMatrixProcedureRevision(requestFor(["OCC.Admin"], { action: "submit_for_review", reason: "Ready." }), context);
  assert.deepEqual(response.jsonBody, { error: "A stable Admin identity is required for Procedure governance." });
});
