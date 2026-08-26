import assert from "node:assert/strict";
import test from "node:test";
import { HttpRequest, type InvocationContext } from "@azure/functions";
import * as db from "../lib/db";
import { listDecisionMatrix } from "./decisionMatrix";
import { retiredDecisionMatrixSync } from "./decisionMatrixSync";

function adminRequest(): HttpRequest {
  const principal = Buffer.from(JSON.stringify({
    userId: "admin-1",
    userDetails: "admin@mvta.com",
    claims: [{ typ: "roles", val: "OCC.Admin" }],
  })).toString("base64");
  return new HttpRequest({
    method: "POST",
    url: "https://example.test/api/admin/decision-matrix/sync",
    headers: { "x-ms-client-principal": principal },
  });
}

test("retired SharePoint import returns a diagnostic without reading or changing Decision Matrix content", async () => {
  const audit: unknown[][] = [];
  const context = { warn: (...args: unknown[]) => audit.push(args) } as unknown as InvocationContext;
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = (async () => {
    fetchCalls++;
    throw new Error("SharePoint must not be contacted by a retired import");
  }) as typeof fetch;

  try {
    const response = await retiredDecisionMatrixSync(adminRequest(), context);

    assert.equal(response.status, 410);
    assert.deepEqual(response.jsonBody, {
      error: "SharePoint structured-content import is retired. Decision Matrix content is authored in OnBoard; SharePoint stores supporting documents only.",
      code: "decision_matrix_import_retired",
    });
    assert.equal(fetchCalls, 0);
    assert.deepEqual(audit, [["Retired Decision Matrix SharePoint import attempted", {
      route: "admin/decision-matrix/sync",
      actor: "admin@mvta.com",
    }]]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("a retired import leaves a legacy Matrix record retrievable through the authenticated read API", async () => {
  const legacyRow = {
    procedure_id: "legacy-procedure", revision: 1, condition_key: "legacy-condition", condition: "Legacy condition",
    criteria: "Legacy criteria", severity: "Routine", severity_meaning: null, immediate_actions_json: "[\"Record the issue\"]",
    escalation_triggers_json: "[]", notifications_json: "[]", communication_guidance: null, required_documentation: null,
    tags_json: "[]", service_mode: null, affected_workflow: null, urgency: null, document_type: "REF", document_code: "REF-LEGACY",
    source_url: "https://example.test/legacy", source_revision: "1", owner: "OCC", approver: "Admin", approval_state: "Approved",
    trust_state: "Approved", effective_at: null, next_review_at: null, retired_at: null, source_status: "available",
    last_synced_at: new Date("2026-08-24T00:00:00Z"), updated_at: new Date("2026-08-24T00:00:00Z"),
  };
  const request = {
    input() { return request; },
    async query<T>(statement: string) {
      return (statement.includes("OBJECT_ID")
        ? { recordset: [{ ready: 1 }] }
        : { recordset: [legacyRow] }) as T;
    },
  };
  const originalGetPool = db.getPool;
  Object.defineProperty(db, "getPool", { configurable: true, value: async () => ({ request: () => request }) });
  const context = { warn: () => undefined, error: () => undefined } as unknown as InvocationContext;

  try {
    const before = await listDecisionMatrix(adminRequest(), context);
    await retiredDecisionMatrixSync(adminRequest(), context);
    const after = await listDecisionMatrix(adminRequest(), context);

    assert.equal(before.status, 200);
    assert.deepEqual(after.jsonBody, before.jsonBody);
    const body = after.jsonBody as { procedures: Array<{ procedure_id: string; criteria: string; immediate_actions: string[] }>; diagnostics: unknown };
    assert.equal(body.procedures.length, 1);
    assert.equal(body.procedures[0]?.procedure_id, "legacy-procedure");
    assert.equal(body.procedures[0]?.criteria, "Legacy criteria");
    assert.deepEqual(body.procedures[0]?.immediate_actions, ["Record the issue"]);
    assert.deepEqual(body.diagnostics, { table_ready: true, source: "governed", include_history: false });
  } finally {
    Object.defineProperty(db, "getPool", { configurable: true, value: originalGetPool });
  }
});
