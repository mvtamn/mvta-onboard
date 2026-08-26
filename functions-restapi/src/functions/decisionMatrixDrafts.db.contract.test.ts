import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { HttpRequest, type InvocationContext } from "@azure/functions";
import { parseConnectionString, sql } from "../lib/db";
import { cloneDecisionMatrixProcedureDraft, createDecisionMatrixProcedureDraft, getDecisionMatrixProcedureDraft, saveDecisionMatrixProcedureDraft } from "./decisionMatrixDrafts";

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

async function applyDraftMigration(pool: sql.ConnectionPool) {
  const migration = readFileSync(join(process.cwd(), "sql/migration-076-procedure-drafts-and-document-references.sql"), "utf8");
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
    const tables = await contractPool.request().query<{ exists: number }>("SELECT CASE WHEN OBJECT_ID('dbo.Procedures', 'U') IS NULL THEN 0 ELSE 1 END AS exists");
    if (!tables.recordset[0]?.exists) await applyDraftMigration(contractPool);

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

    const cloned = await cloneDecisionMatrixProcedureDraft(
      requestFor("POST", `https://example.test/api/admin/decision-matrix/procedures/${procedureId}/revisions`, { source_revision: 1 }, { procedureId }),
      context,
    );
    assert.equal(cloned.status, 201);
    const cloneRows = await contractPool.request()
      .input("procedure_id", sql.NVarChar, procedureId)
      .query<{ revision: number; criteria: number; actions: number; references: number }>("SELECT r.revision,(SELECT COUNT(*) FROM ProcedureCriteria c WHERE c.procedure_id=r.procedure_id AND c.revision=r.revision) AS criteria,(SELECT COUNT(*) FROM ProcedureImmediateActions a WHERE a.procedure_id=r.procedure_id AND a.revision=r.revision) AS actions,(SELECT COUNT(*) FROM ProcedureDocumentReferences d WHERE d.procedure_id=r.procedure_id AND d.revision=r.revision) AS references FROM ProcedureRevisions r WHERE r.procedure_id=@procedure_id AND r.revision=2");
    assert.deepEqual(cloneRows.recordset[0], { revision: 2, criteria: 2, actions: 2, references: 1 });
  } finally {
    await contractPool.request().input("procedure_id", sql.NVarChar, procedureId).query("DELETE FROM Procedures WHERE procedure_id=@procedure_id").catch(() => undefined);
    await contractPool.close();
    await (sql as unknown as { close(): Promise<void> }).close();
  }
});
