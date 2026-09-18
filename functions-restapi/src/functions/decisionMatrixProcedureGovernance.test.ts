import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { HttpRequest, type InvocationContext } from "@azure/functions";
import { checkDecisionMatrixProcedureReferences, governDecisionMatrixProcedureRevision } from "./decisionMatrixProcedureGovernance";
import { useAccessExecutorForTests } from "../lib/access";
import { fakeAccessDb } from "../lib/access/testSupport";

// Since the cutover an app role in a token grants nobody anything, so a case
// states what its caller holds as a Role Grant, the way production reads it.
function holding(...roleKeys: string[]) {
  useAccessExecutorForTests(fakeAccessDb(roleKeys.map((roleKey) => ({ objectId: "*", roleKey }))));
}

afterEach(() => useAccessExecutorForTests(null));

const context = { error: () => undefined } as unknown as InvocationContext;

function requestFor(body: unknown, userId?: string) {
  return new HttpRequest({
    method: "POST",
    url: "https://example.test/api/manage/decision-matrix/procedures/procedure-1/revisions/1/lifecycle",
    params: { procedureId: "procedure-1", revision: "1" },
    headers: { "content-type": "application/json", "x-ms-client-principal": Buffer.from(JSON.stringify({ userId })).toString("base64") },
    body: { string: JSON.stringify(body) },
  });
}

test("only an Admin can govern a Procedure Revision or check its document references", async () => {
  holding("publisher");
  const lifecycle = await governDecisionMatrixProcedureRevision(requestFor({ action: "approve", reason: "Not authorized." }, "publisher-oid"), context);
  const check = await checkDecisionMatrixProcedureReferences(requestFor({}, "publisher-oid"), context);
  assert.equal(lifecycle.status, 403);
  assert.equal(check.status, 403);
  // Names the role the caller really holds, so the refusal cannot pass by the
  // caller holding nothing at all.
  assert.match((lifecycle.jsonBody as { error: string }).error, /Your roles are: Publisher\./);
});

test("every lifecycle decision records an explicit reason and withdrawal confirmation", async () => {
  holding("system-administrator");
  const noReason = await governDecisionMatrixProcedureRevision(requestFor({ action: "submit_for_review" }, "admin-oid"), context);
  const noConfirmation = await governDecisionMatrixProcedureRevision(requestFor({ action: "withdraw", reason: "Dangerous guidance." }, "admin-oid"), context);
  assert.deepEqual(noReason.jsonBody, { error: "A governance reason is required." });
  assert.deepEqual(noConfirmation.jsonBody, { error: "Emergency withdrawal requires prominent confirmation." });
});

// A caller Easy Auth cannot name is still refused, and since the cutover the
// refusal happens one step earlier: Role Grants hang off the object id, so a
// caller without one can hold nothing. (The handler's own 401 for a missing
// actor is unreachable for that reason - see the report on this change.)
test("a governance action requires an immutable Admin identity for its audit evidence", async () => {
  holding("system-administrator");
  const response = await governDecisionMatrixProcedureRevision(requestFor({ action: "submit_for_review", reason: "Ready." }), context);
  assert.equal(response.status, 403);
  assert.deepEqual(response.jsonBody, {
    error: "Requires Author drafts, governance and the library on Decision Matrix. You hold no OnBoard role yet - ask an Access Administrator.",
  });
});

// No document-check identity configured. None of these touch the database:
// the refusal happens before anything would be read or written.
test("approval without a document-check identity is refused, and says why rather than failing the gate", async () => {
  holding("system-administrator");
  const response = await governDecisionMatrixProcedureRevision(requestFor({ action: "approve", reason: "Ready to publish." }, "admin-oid"), context, null);
  assert.equal(response.status, 409);
  const body = response.jsonBody as { error: string; details: { document_check: { outcome: string; reason: string; document_references: unknown[] } } };
  assert.match(body.error, /document checks are not configured/);
  assert.equal(body.details.document_check.outcome, "not_configured");
  assert.deepEqual(body.details.document_check.document_references, []);
});

test("submission without a document-check identity is refused the same way", async () => {
  holding("system-administrator");
  const response = await governDecisionMatrixProcedureRevision(requestFor({ action: "submit_for_review", reason: "Ready for review." }, "admin-oid"), context, null);
  assert.equal(response.status, 409);
  assert.match((response.jsonBody as { error: string }).error, /Submission needs a fresh document check/);
});

// Check documents is a question with a known answer, not an outage.
test("checking documents without a document-check identity answers that checks are not configured", async () => {
  holding("system-administrator");
  const response = await checkDecisionMatrixProcedureReferences(requestFor({}, "admin-oid"), context, null);
  assert.equal(response.status, 200);
  const body = response.jsonBody as { outcome: string; reason: string; document_references: unknown[] };
  assert.equal(body.outcome, "not_configured");
  assert.match(body.reason, /DECISION_MATRIX_HEALTH_CLIENT_ID/);
  assert.deepEqual(body.document_references, []);
});

// The console no longer sends one, and the API must not use one if it arrives.
test("a caller's own token is never used to check documents", async () => {
  holding("system-administrator");
  const request = requestFor({}, "admin-oid");
  request.headers.set("x-ms-token-aad-access-token", "a-users-graph-token");
  const response = await checkDecisionMatrixProcedureReferences(request, context, null);
  assert.equal((response.jsonBody as { outcome: string }).outcome, "not_configured", "a user token must not stand in for the documents application");
});
