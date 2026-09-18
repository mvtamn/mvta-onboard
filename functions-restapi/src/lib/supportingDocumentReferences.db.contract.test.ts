import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test, { after, before } from "node:test";
import { HttpRequest, type InvocationContext } from "@azure/functions";
import { parseConnectionString, sql } from "./db";
import { createDecisionMatrixProcedureDraft, getDecisionMatrixProcedureDraft, saveDecisionMatrixProcedureDraft } from "../functions/decisionMatrixDrafts";
import { createInMemoryLibraryItems } from "./sharepointLibrary";
import { useAccessExecutorForTests } from "./access";
import { fakeAccessDb } from "./access/testSupport";

// Supporting Document References against a real SQL Server (the CI contract
// job's container), through the Draft handlers the console uses. Its own
// file: getPool() caches one global pool, which each contract file closes.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;
// What the handlers log, so a 500 fails with the database's own error rather
// than only "could not be saved".
const logged: string[] = [];
const context = { error: (...args: unknown[]) => { logged.push(args.map((arg) => arg instanceof Error ? `${arg.message}${(arg as { number?: number }).number ? ` (SQL ${(arg as { number?: number }).number})` : ""}` : String(arg)).join(" ")); } } as unknown as InvocationContext;
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PROCEDURES_URL = "https://example.test/api/manage/decision-matrix/procedures";

const library = createInMemoryLibraryItems({ site_id: "site-references", drive_id: "drive-references" }, {
  "item-sop": { name: "SOP-REF.docx", kind: "file", mime_type: DOCX, etag: '"{A},1"', web_url: "https://mvtamn.sharepoint.com/sites/Ops/SOP-REF.docx" },
  "item-form": { name: "Form-REF.pdf", kind: "file", mime_type: "application/pdf", etag: '"{B},1"', web_url: "https://mvtamn.sharepoint.com/sites/Ops/Form-REF.pdf" },
  "item-reference": { name: "Reference-REF.pdf", kind: "file", mime_type: "application/pdf", etag: '"{C},1"', web_url: "https://mvtamn.sharepoint.com/sites/Ops/Reference-REF.pdf" },
});

// The caller's authority is no longer in the token: since the cutover it comes
// from Role Grants. What this file proves is the SQL underneath the handlers,
// so the caller holds System Administrator through the access seam rather than
// through rows this test would otherwise have to insert.
before(() => useAccessExecutorForTests(fakeAccessDb([{ objectId: "*", roleKey: "system-administrator" }])));
after(() => useAccessExecutorForTests(null));

function requestFor(method: string, url: string, body?: unknown, params: Record<string, string> = {}): HttpRequest {
  const principal = Buffer.from(JSON.stringify({ userId: "document-reference-contract-admin" })).toString("base64");
  return new HttpRequest({ method, url, params, headers: { "content-type": "application/json", "x-ms-client-principal": principal }, body: body === undefined ? undefined : { string: JSON.stringify(body) } });
}

async function applyMigration(pool: sql.ConnectionPool, file: string) {
  const migration = readFileSync(join(process.cwd(), "sql", file), "utf8");
  for (const batch of migration.split(/^\s*GO\s*$/m)) {
    if (batch.trim()) await pool.request().batch(batch);
  }
}

type Row = { item_id: string; sort_order: number; document_type: string; is_primary: boolean; document_code: string; site_id: string; health_status: string; checked_at: string | null };

test("a Draft save keeps a kept reference's document and health, and refuses what it cannot record", { skip: !connectionString }, async () => {
  if (!connectionString) return;
  process.env.SQL_CONNECTION_STRING = connectionString;
  const pool = new sql.ConnectionPool(parseConnectionString(connectionString));
  const procedureId = `dm-references-${randomUUID()}`;
  const otherProcedureId = `dm-references-other-${randomUUID()}`;
  const revisionUrl = (id: string) => `${PROCEDURES_URL}/${id}/revisions/1`;
  const params = (id: string) => ({ procedureId: id, revision: "1" });
  const draft = (id: string, references: unknown[]) => ({
    procedure_id: id,
    condition_key: `dm-references-${randomUUID()}`,
    condition: "Supporting Document Reference contract",
    severity: "Restrict service",
    severity_meaning: "Continue under limits.",
    owner_team: "Operations Control Center",
    effective_at: "2026-08-25T00:00:00.000Z",
    next_review_at: "2027-02-25T00:00:00.000Z",
    criteria: [{ kind: "applies", text: "It applies." }],
    immediate_actions: [{ kind: "required", instruction: "Do the thing." }],
    document_references: references,
  });
  const rows = async (id: string) => (await pool.request().input("procedure_id", sql.NVarChar, id)
    .query<Row>("SELECT item_id,sort_order,document_type,is_primary,document_code,site_id,health_status,CONVERT(varchar(30),checked_at,126) AS checked_at FROM ProcedureDocumentReferences WHERE procedure_id=@procedure_id AND revision=1 ORDER BY sort_order")).recordset;
  const read = async (id: string) => (await getDecisionMatrixProcedureDraft(requestFor("GET", revisionUrl(id), undefined, params(id)), context)).jsonBody as unknown as { concurrency_token: string; document_references: Array<{ id: string; item_id: string }> };
  const idOf = (body: { document_references: Array<{ id: string; item_id: string }> }, item: string) => body.document_references.find((reference) => reference.item_id === item)!.id;
  const save = (id: string, token: string, references: unknown[]) => saveDecisionMatrixProcedureDraft(requestFor("PUT", revisionUrl(id), { ...draft(id, references), concurrency_token: token }, params(id)), context, library);

  await pool.connect();
  try {
    const tables = await pool.request().query<{ procedures: number; audit: number; tags: number }>("SELECT CASE WHEN OBJECT_ID('dbo.Procedures', 'U') IS NULL THEN 0 ELSE 1 END procedures,CASE WHEN OBJECT_ID('dbo.ProcedureAuditEvents', 'U') IS NULL THEN 0 ELSE 1 END audit,CASE WHEN COL_LENGTH('dbo.ProcedureRevisions','tags_json') IS NULL THEN 0 ELSE 1 END tags");
    if (!tables.recordset[0]?.procedures) await applyMigration(pool, "migration-076-procedure-drafts-and-document-references.sql");
    if (!tables.recordset[0]?.audit) await applyMigration(pool, "migration-078-procedure-governance-audit.sql");
    if (!tables.recordset[0]?.tags) await applyMigration(pool, "migration-080-decision-matrix-search-and-match-rules.sql");

    // Created with two chosen documents; the site comes from the library.
    const created = await createDecisionMatrixProcedureDraft(requestFor("POST", PROCEDURES_URL, draft(procedureId, [
      { document_type: "SOP", is_primary: true, document_code: "SOP-REF", item_id: "item-sop", seen_version: '"{A},1"' },
      { document_type: "Form", document_code: "FORM-REF", item_id: "item-form", seen_version: '"{B},1"' },
    ])), context, library);
    assert.equal(created.status, 201, logged.join(" | "));
    assert.deepEqual((await rows(procedureId)).map((row) => [row.item_id, row.site_id, row.health_status]), [["item-sop", "site-references", "Needs review"], ["item-form", "site-references", "Needs review"]]);

    // Stand in for the health module having checked both documents.
    await pool.request().input("procedure_id", sql.NVarChar, procedureId).query("UPDATE ProcedureDocumentReferences SET health_status='Valid',checked_at='2026-09-17T05:00:00',observed_version=expected_version WHERE procedure_id=@procedure_id");

    // Choose a new primary Reference first, keep the Form with a new code, and
    // demote the SOP - a new document, a reorder and a primary move in one save.
    let body = await read(procedureId);
    assert.match(body.concurrency_token, /^0x[0-9A-F]{16}$/i, "a Draft read returns the token a save accepts");
    const sopId = idOf(body, "item-sop");
    const formId = idOf(body, "item-form");
    const first = await save(procedureId, body.concurrency_token, [
      { document_type: "Reference", is_primary: true, document_code: "REF-REF", item_id: "item-reference", seen_version: '"{C},1"' },
      { id: formId, document_type: "Form", document_code: "FORM-REF-2" },
      { id: sopId, document_type: "SOP", is_primary: false, document_code: "SOP-REF" },
    ]);
    assert.equal(first.status, 200, `${JSON.stringify(first.jsonBody)} ${logged.join(" | ")}`);
    assert.deepEqual((await rows(procedureId)).map(({ item_id, sort_order, is_primary, document_code, health_status, checked_at }) => [item_id, sort_order, is_primary, document_code, health_status, checked_at]), [
      ["item-reference", 1, true, "REF-REF", "Needs review", null],
      ["item-form", 2, false, "FORM-REF-2", "Valid", "2026-09-17T05:00:00"],
      ["item-sop", 3, false, "SOP-REF", "Valid", "2026-09-17T05:00:00"],
    ], "kept references keep their health; only the new one needs review");

    // Remove the Form and move the primary back between two kept references.
    body = await read(procedureId);
    const second = await save(procedureId, body.concurrency_token, [
      { id: sopId, document_type: "SOP", is_primary: true, document_code: "SOP-REF" },
      { id: idOf(body, "item-reference"), document_type: "Reference", is_primary: false, document_code: "REF-REF" },
    ]);
    assert.equal(second.status, 200, `${JSON.stringify(second.jsonBody)} ${logged.join(" | ")}`);
    assert.deepEqual((await rows(procedureId)).map(({ item_id, is_primary, health_status }) => [item_id, is_primary, health_status]), [["item-sop", true, "Valid"], ["item-reference", false, "Needs review"]]);

    // Refusals change nothing, and a refusal inside the transaction rolls the
    // revision back too - the same concurrency token still saves afterwards.
    body = await read(procedureId);
    const before = await rows(procedureId);
    const oversized = await save(procedureId, body.concurrency_token, [{ id: sopId, document_type: "SOP", is_primary: true, document_code: "S".repeat(101) }]);
    assert.deepEqual(oversized, { status: 400, jsonBody: { error: "Supporting Document Reference 1: document_code must be a non-empty value of 100 characters or fewer." } });

    const other = await createDecisionMatrixProcedureDraft(requestFor("POST", PROCEDURES_URL, draft(otherProcedureId, [
      { document_type: "SOP", is_primary: true, document_code: "SOP-OTHER", item_id: "item-sop", seen_version: '"{A},1"' },
    ])), context, library);
    assert.equal(other.status, 201);
    const foreign = await save(procedureId, body.concurrency_token, [{ id: idOf(await read(otherProcedureId), "item-sop"), document_type: "SOP", is_primary: true, document_code: "SOP-REF" }]);
    assert.equal(foreign.status, 400);
    assert.match((foreign.jsonBody as { error: string }).error, /is not on this Draft/);

    const twice = await save(procedureId, body.concurrency_token, [
      { id: sopId, document_type: "SOP", is_primary: true, document_code: "SOP-REF" },
      { document_type: "Form", document_code: "FORM-AGAIN", item_id: "item-sop", seen_version: '"{A},1"' },
    ]);
    assert.deepEqual(twice, { status: 400, jsonBody: { error: "Supporting Document Reference 2 references SOP-REF.docx, which this Draft already references." } });
    assert.deepEqual(await rows(procedureId), before);
    assert.equal((await save(procedureId, body.concurrency_token, [{ id: sopId, document_type: "SOP", is_primary: true, document_code: "SOP-REF" }])).status, 200, "the refused saves left the revision as it was");

    // Only a real duplicate Procedure is reported as one.
    const duplicate = await createDecisionMatrixProcedureDraft(requestFor("POST", PROCEDURES_URL, draft(procedureId, [])), context, library);
    assert.deepEqual(duplicate, { status: 409, jsonBody: { error: "Procedure identity or condition key already exists." } });
  } finally {
    for (const id of [procedureId, otherProcedureId]) {
      await pool.request().input("procedure_id", sql.NVarChar, id).query("DELETE FROM Procedures WHERE procedure_id=@procedure_id").catch(() => undefined);
    }
    await pool.close();
    await (sql as unknown as { close(): Promise<void> }).close();
  }
});
