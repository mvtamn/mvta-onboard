import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { HttpRequest, type InvocationContext } from "@azure/functions";
import { parseConnectionString, sql } from "../lib/db";
import { cloneDecisionMatrixProcedureDraft, createDecisionMatrixProcedureDraft, getDecisionMatrixProcedureDraft, saveDecisionMatrixProcedureDraft } from "./decisionMatrixDrafts";
import { governDecisionMatrixProcedureRevision } from "./decisionMatrixProcedureGovernance";

const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;
const context = { error: () => undefined } as unknown as InvocationContext;

function requestFor(method: string, url: string, body?: unknown, params: Record<string, string> = {}): HttpRequest {
  const principal = Buffer.from(JSON.stringify({
    userId: "decision-matrix-contract-admin",
    userDetails: "decision-matrix-contract-admin@mvta.com",
    claims: [{ typ: "roles", val: "OCC.Admin" }],
  })).toString("base64");
  return new HttpRequest({
    method,
    url,
    params,
    headers: { "content-type": "application/json", "x-ms-client-principal": principal },
    body: body === undefined ? undefined : { string: JSON.stringify(body) },
  });
}

async function applyMigration(pool: sql.ConnectionPool, file: string) {
    const migration = readFileSync(join(process.cwd(), "sql", file), "utf8");
    for (const batch of migration.split(/^\s*GO\s*$/m)) {
      if (batch.trim()) await pool.request().batch(batch);
    }
}

test("Decision Matrix Draft API persists ordered content, rejects stale saves, and clones a new revision in SQL Server", { skip: !connectionString }, async () => {
  if (!connectionString) return;
  process.env.SQL_CONNECTION_STRING = connectionString;
  const contractPool = new sql.ConnectionPool(parseConnectionString(connectionString));
  const procedureId = `dm-contract-${randomUUID()}`;
  const conditionKey = `dm-contract-${randomUUID()}`;
  const replacementProcedureId = `dm-replacement-${randomUUID()}`;
  const draft = {
    procedure_id: procedureId,
    condition_key: conditionKey,
    condition: "Decision Matrix database contract condition",
    severity: "Stop service",
    severity_meaning: "Pause service while the response is assessed.",
    owner_team: "Operations Control Center",
    owner_contact: "occ@mvta.com",
    effective_at: "2026-08-25T00:00:00.000Z",
    next_review_at: "2027-02-25T00:00:00.000Z",
    criteria: [
      { kind: "applies", text: "First persisted criterion." },
      { kind: "excludes", text: "Second persisted criterion." },
    ],
    immediate_actions: [
      { kind: "required", instruction: "First persisted action." },
      { kind: "informational", instruction: "Second persisted action." },
    ],
    document_references: [{
      document_type: "SOP",
      is_primary: true,
      document_code: "SOP-OCC-CONTRACT",
      site_id: "site-contract",
      drive_id: "drive-contract",
      item_id: "item-contract",
      expected_version: "3.0",
      expected_file_name: "SOP-OCC-CONTRACT.docx",
      expected_mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      web_url: "https://mvtamn.sharepoint.com/sites/Operations/Shared%20Documents/SOP-OCC-CONTRACT.docx",
    }],
  };

  await contractPool.connect();
  try {
    const tables = await contractPool.request().query<{ procedures: number; audit: number; tags: number }>("SELECT CASE WHEN OBJECT_ID('dbo.Procedures', 'U') IS NULL THEN 0 ELSE 1 END procedures,CASE WHEN OBJECT_ID('dbo.ProcedureAuditEvents', 'U') IS NULL THEN 0 ELSE 1 END audit,CASE WHEN COL_LENGTH('dbo.ProcedureRevisions','tags_json') IS NULL THEN 0 ELSE 1 END tags");
    if (!tables.recordset[0]?.procedures) await applyMigration(contractPool, "migration-076-procedure-drafts-and-document-references.sql");
    if (!tables.recordset[0]?.audit) await applyMigration(contractPool, "migration-078-procedure-governance-audit.sql");
    if (!tables.recordset[0]?.tags) await applyMigration(contractPool, "migration-080-decision-matrix-search-and-match-rules.sql");

    const created = await createDecisionMatrixProcedureDraft(
      requestFor("POST", "https://example.test/api/admin/decision-matrix/procedures", draft),
      context,
    );
    assert.equal(created.status, 201);
    const createdBody = created.jsonBody as { concurrency_token: string };
    assert.match(createdBody.concurrency_token, /^0x[0-9A-F]+$/i);

    const persisted = await contractPool.request()
      .input("procedure_id", sql.NVarChar, procedureId)
      .query<{ criteria: string; actions: string; health_status: string }>("SELECT (SELECT criterion_kind + ':' + criterion_text AS [text()] FROM ProcedureCriteria WHERE procedure_id=@procedure_id AND revision=1 ORDER BY sort_order FOR XML PATH('')) AS criteria,(SELECT action_kind + ':' + instruction AS [text()] FROM ProcedureImmediateActions WHERE procedure_id=@procedure_id AND revision=1 ORDER BY sort_order FOR XML PATH('')) AS actions,(SELECT TOP 1 health_status FROM ProcedureDocumentReferences WHERE procedure_id=@procedure_id AND revision=1) AS health_status");
    assert.equal(persisted.recordset[0]?.criteria, "applies:First persisted criterion.excludes:Second persisted criterion.");
    assert.equal(persisted.recordset[0]?.actions, "required:First persisted action.informational:Second persisted action.");
    assert.equal(persisted.recordset[0]?.health_status, "Needs review");

    const read = await getDecisionMatrixProcedureDraft(
      requestFor("GET", `https://example.test/api/admin/decision-matrix/procedures/${procedureId}/revisions/1`, undefined, { procedureId, revision: "1" }),
      context,
    );
    assert.equal(read.status, 200);
    const readBody = read.jsonBody as { criteria: Array<{ text: string }>; immediate_actions: Array<{ instruction: string }>; document_references: Array<{ health_status: string }> };
    assert.deepEqual(readBody.criteria.map((criterion) => criterion.text), ["First persisted criterion.", "Second persisted criterion."]);
    assert.deepEqual(readBody.immediate_actions.map((action) => action.instruction), ["First persisted action.", "Second persisted action."]);
    assert.equal(readBody.document_references[0]?.health_status, "Needs review");

    const saved = await saveDecisionMatrixProcedureDraft(
      requestFor("PUT", `https://example.test/api/admin/decision-matrix/procedures/${procedureId}/revisions/1`, { ...draft, concurrency_token: createdBody.concurrency_token }, { procedureId, revision: "1" }),
      context,
    );
    assert.equal(saved.status, 200);
    const savedBody = saved.jsonBody as { concurrency_token: string };
    assert.notEqual(savedBody.concurrency_token, createdBody.concurrency_token);

    const stale = await saveDecisionMatrixProcedureDraft(
      requestFor("PUT", `https://example.test/api/admin/decision-matrix/procedures/${procedureId}/revisions/1`, { ...draft, concurrency_token: createdBody.concurrency_token }, { procedureId, revision: "1" }),
      context,
    );
    assert.equal(stale.status, 409);

    const validDocument = async () => ({ health_status: "Valid" as const, observed_version: "3.0", observed_file_name: "SOP-OCC-CONTRACT.docx", observed_mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", reason: null });
    const review = await governDecisionMatrixProcedureRevision(
      requestFor("POST", `https://example.test/api/admin/decision-matrix/procedures/${procedureId}/revisions/1/lifecycle`, { action: "submit_for_review", reason: "Ready for governance review." }, { procedureId, revision: "1" }),
      context,
      validDocument,
    );
    assert.deepEqual(review.jsonBody, { procedure_id: procedureId, revision: 1, lifecycle_state: "Under review" });
    const approved = await governDecisionMatrixProcedureRevision(
      requestFor("POST", `https://example.test/api/admin/decision-matrix/procedures/${procedureId}/revisions/1/lifecycle`, { action: "approve", reason: "Approved for immediate operational use." }, { procedureId, revision: "1" }),
      context,
      validDocument,
    );
    assert.deepEqual(approved.jsonBody, { procedure_id: procedureId, revision: 1, lifecycle_state: "Approved" });

    const cloned = await cloneDecisionMatrixProcedureDraft(
      requestFor("POST", `https://example.test/api/admin/decision-matrix/procedures/${procedureId}/revisions`, { source_revision: 1 }, { procedureId }),
      context,
    );
    assert.equal(cloned.status, 201);
    const secondReview = await governDecisionMatrixProcedureRevision(
      requestFor("POST", `https://example.test/api/admin/decision-matrix/procedures/${procedureId}/revisions/2/lifecycle`, { action: "submit_for_review", reason: "Updated revision is ready for review." }, { procedureId, revision: "2" }),
      context,
      validDocument,
    );
    assert.equal(secondReview.status, 200);
    const secondApproval = await governDecisionMatrixProcedureRevision(
      requestFor("POST", `https://example.test/api/admin/decision-matrix/procedures/${procedureId}/revisions/2/lifecycle`, { action: "approve", reason: "Replacement approved." }, { procedureId, revision: "2" }),
      context,
      validDocument,
    );
    assert.equal(secondApproval.status, 200);
    const cloneRows = await contractPool.request()
      .input("procedure_id", sql.NVarChar, procedureId)
      .query<{ revision: number; criteria: number; references: number; actions: number }>("SELECT r.revision,(SELECT COUNT(*) FROM ProcedureCriteria c WHERE c.procedure_id=r.procedure_id AND c.revision=r.revision) AS criteria,(SELECT COUNT(*) FROM ProcedureImmediateActions a WHERE a.procedure_id=r.procedure_id AND a.revision=r.revision) AS actions,(SELECT COUNT(*) FROM ProcedureDocumentReferences d WHERE d.procedure_id=r.procedure_id AND d.revision=r.revision) AS [references] FROM ProcedureRevisions r WHERE r.procedure_id=@procedure_id AND r.revision=2");
    assert.deepEqual(cloneRows.recordset[0], { revision: 2, criteria: 2, actions: 2, references: 1 });
    const governance = await contractPool.request().input("procedure_id", sql.NVarChar, procedureId)
      .query<{ revision: number; lifecycle_state: string; audit_events: number }>("SELECT r.revision,r.lifecycle_state,(SELECT COUNT(*) FROM ProcedureAuditEvents e WHERE e.procedure_id=r.procedure_id AND e.revision=r.revision) audit_events FROM ProcedureRevisions r WHERE r.procedure_id=@procedure_id ORDER BY r.revision");
    assert.deepEqual(governance.recordset, [
      { revision: 1, lifecycle_state: "Superseded", audit_events: 7 },
      { revision: 2, lifecycle_state: "Approved", audit_events: 5 },
    ]);

    const replacement = await createDecisionMatrixProcedureDraft(
      requestFor("POST", "https://example.test/api/admin/decision-matrix/procedures", {
        ...draft,
        procedure_id: replacementProcedureId,
        condition_key: `replacement-${randomUUID()}`,
        condition: "Approved replacement Procedure",
        criteria: draft.criteria.map(({ kind, text }) => ({ kind, text })),
        immediate_actions: draft.immediate_actions.map(({ kind, instruction }) => ({ kind, instruction })),
        document_references: draft.document_references.map(({ document_type, is_primary, document_code, site_id, drive_id, item_id, expected_version, expected_file_name, expected_mime_type, web_url }) => ({ document_type, is_primary, document_code, site_id, drive_id, item_id, expected_version, expected_file_name, expected_mime_type, web_url })),
      }),
      context,
    );
    assert.equal(replacement.status, 201);
    assert.equal((await governDecisionMatrixProcedureRevision(requestFor("POST", `https://example.test/api/admin/decision-matrix/procedures/${replacementProcedureId}/revisions/1/lifecycle`, { action: "submit_for_review", reason: "Replacement is ready." }, { procedureId: replacementProcedureId, revision: "1" }), context, validDocument)).status, 200);
    assert.equal((await governDecisionMatrixProcedureRevision(requestFor("POST", `https://example.test/api/admin/decision-matrix/procedures/${replacementProcedureId}/revisions/1/lifecycle`, { action: "approve", reason: "Replacement is approved." }, { procedureId: replacementProcedureId, revision: "1" }), context, validDocument)).status, 200);
    const retired = await governDecisionMatrixProcedureRevision(
      requestFor("POST", `https://example.test/api/admin/decision-matrix/procedures/${procedureId}/revisions/2/lifecycle`, { action: "retire", reason: "Replacement is in effect.", replacement_procedure_id: replacementProcedureId, replacement_revision: 1 }, { procedureId, revision: "2" }),
      context,
      validDocument,
    );
    assert.deepEqual(retired.jsonBody, { procedure_id: procedureId, revision: 2, lifecycle_state: "Retired" });
    const withdrawn = await governDecisionMatrixProcedureRevision(
      requestFor("POST", `https://example.test/api/admin/decision-matrix/procedures/${replacementProcedureId}/revisions/1/lifecycle`, { action: "withdraw", reason: "Guidance is unsafe.", confirm_withdrawal: true }, { procedureId: replacementProcedureId, revision: "1" }),
      context,
      validDocument,
    );
    assert.deepEqual(withdrawn.jsonBody, { procedure_id: replacementProcedureId, revision: 1, lifecycle_state: "Retired" });
    assert.equal((await cloneDecisionMatrixProcedureDraft(requestFor("POST", `https://example.test/api/admin/decision-matrix/procedures/${replacementProcedureId}/revisions`, { source_revision: 1 }, { procedureId: replacementProcedureId }), context)).status, 201);
  } finally {
    await contractPool.request().input("procedure_id", sql.NVarChar, procedureId).query("DELETE FROM Procedures WHERE procedure_id=@procedure_id").catch(() => undefined);
    await contractPool.request().input("procedure_id", sql.NVarChar, replacementProcedureId).query("DELETE FROM Procedures WHERE procedure_id=@procedure_id").catch(() => undefined);
    await contractPool.close();
    await (sql as unknown as { close(): Promise<void> }).close();
  }
});
