import assert from "node:assert/strict";
import test from "node:test";
import { HttpRequest, type InvocationContext } from "@azure/functions";
import { checkDecisionMatrixProcedureReferences, governDecisionMatrixProcedureRevision } from "./decisionMatrixProcedureGovernance";

const context = { error: () => undefined } as unknown as InvocationContext;

function requestFor(roles: string[], body: unknown, userId?: string) {
  return new HttpRequest({
    method: "POST",
    url: "https://example.test/api/manage/decision-matrix/procedures/procedure-1/revisions/1/lifecycle",
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

// No document-check identity configured. None of these touch the database:
// the refusal happens before anything would be read or written.
test("approval without a document-check identity is refused, and says why rather than failing the gate", async () => {
  const response = await governDecisionMatrixProcedureRevision(requestFor(["OCC.Admin"], { action: "approve", reason: "Ready to publish." }, "admin-oid"), context, null);
  assert.equal(response.status, 409);
  const body = response.jsonBody as { error: string; details: { document_check: { outcome: string; reason: string; document_references: unknown[] } } };
  assert.match(body.error, /document checks are not configured/);
  assert.equal(body.details.document_check.outcome, "not_configured");
  assert.deepEqual(body.details.document_check.document_references, []);
});

test("submission without a document-check identity is refused the same way", async () => {
  const response = await governDecisionMatrixProcedureRevision(requestFor(["OCC.Admin"], { action: "submit_for_review", reason: "Ready for review." }, "admin-oid"), context, null);
  assert.equal(response.status, 409);
  assert.match((response.jsonBody as { error: string }).error, /Submission needs a fresh document check/);
});

// Check documents is a question with a known answer, not an outage.
test("checking documents without a document-check identity answers that checks are not configured", async () => {
  const response = await checkDecisionMatrixProcedureReferences(requestFor(["OCC.Admin"], {}, "admin-oid"), context, null);
  assert.equal(response.status, 200);
  const body = response.jsonBody as { outcome: string; reason: string; document_references: unknown[] };
  assert.equal(body.outcome, "not_configured");
  assert.match(body.reason, /DECISION_MATRIX_HEALTH_CLIENT_ID/);
  assert.deepEqual(body.document_references, []);
});

// The console no longer sends one, and the API must not use one if it arrives.
test("a caller's own token is never used to check documents", async () => {
  const request = requestFor(["OCC.Admin"], {}, "admin-oid");
  request.headers.set("x-ms-token-aad-access-token", "a-users-graph-token");
  const response = await checkDecisionMatrixProcedureReferences(request, context, null);
  assert.equal((response.jsonBody as { outcome: string }).outcome, "not_configured", "a user token must not stand in for the documents application");
});
