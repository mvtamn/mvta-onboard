import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test, { after, before } from "node:test";
import { HttpRequest, type InvocationContext } from "@azure/functions";
import { parseConnectionString, sql } from "./db";
import { createDecisionMatrixProcedureDraft } from "../functions/decisionMatrixDrafts";
import { createInMemoryLibraryItems } from "./sharepointLibrary";
import { checkDecisionMatrixProcedureReferences, governDecisionMatrixProcedureRevision } from "../functions/decisionMatrixProcedureGovernance";
import { createInMemoryMetadataReader, documentCheckStatus, revisionsDueForHealthCheck, type MetadataRead } from "./decisionMatrixDocumentHealth";
import { useAccessExecutorForTests } from "./access";
import { fakeAccessDb } from "./access/testSupport";

// Document Reference Health against a real SQL Server (the CI contract job's
// container), through the handlers Admins and the timer actually use. Its own
// file, not a second test beside the Draft contract: getPool() caches one
// global pool, which that test closes when it finishes.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;
const context = { error: () => undefined } as unknown as InvocationContext;
const ADMIN = "decision-matrix-health-contract-admin";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MATCHING: MetadataRead = { kind: "found", document: { version: "3.0", file_name: "SOP-HEALTH.docx", mime_type: DOCX } };
const LIBRARY = createInMemoryLibraryItems({ site_id: "site-health", drive_id: "drive-health" }, {
  "item-health": { name: "SOP-HEALTH.docx", kind: "file", mime_type: DOCX, etag: "3.0", web_url: "https://mvtamn.sharepoint.com/sites/TransitOperationsHub2/Shared%20Documents/SOP-HEALTH.docx" },
});

// The caller's authority is no longer in the token: since the cutover it comes
// from Role Grants. What this file proves is the SQL underneath the handlers,
// so the caller holds System Administrator through the access seam rather than
// through rows this test would otherwise have to insert.
before(() => useAccessExecutorForTests(fakeAccessDb([{ objectId: "*", roleKey: "system-administrator" }])));
after(() => useAccessExecutorForTests(null));

function requestFor(url: string, body: unknown, params: Record<string, string> = {}): HttpRequest {
  const principal = Buffer.from(JSON.stringify({ userId: ADMIN })).toString("base64");
  return new HttpRequest({
    method: "POST",
    url,
    params,
    headers: { "content-type": "application/json", "x-ms-client-principal": principal },
    body: { string: JSON.stringify(body) },
  });
}

async function applyMigration(pool: sql.ConnectionPool, file: string) {
  const migration = readFileSync(join(process.cwd(), "sql", file), "utf8");
  for (const batch of migration.split(/^\s*GO\s*$/m)) {
    if (batch.trim()) await pool.request().batch(batch);
  }
}

async function ensureTables(pool: sql.ConnectionPool) {
  const tables = await pool.request().query<{ procedures: number; audit: number; tags: number }>("SELECT CASE WHEN OBJECT_ID('dbo.Procedures', 'U') IS NULL THEN 0 ELSE 1 END procedures,CASE WHEN OBJECT_ID('dbo.ProcedureAuditEvents', 'U') IS NULL THEN 0 ELSE 1 END audit,CASE WHEN COL_LENGTH('dbo.ProcedureRevisions','tags_json') IS NULL THEN 0 ELSE 1 END tags");
  if (!tables.recordset[0]?.procedures) await applyMigration(pool, "migration-076-procedure-drafts-and-document-references.sql");
  if (!tables.recordset[0]?.audit) await applyMigration(pool, "migration-078-procedure-governance-audit.sql");
  if (!tables.recordset[0]?.tags) await applyMigration(pool, "migration-080-decision-matrix-search-and-match-rules.sql");
  // Migration 126 is declared re-runnable, which is a promise; keep it by running it twice.
  await applyMigration(pool, "migration-126-document-reference-health-outcome.sql");
  await applyMigration(pool, "migration-126-document-reference-health-outcome.sql");
}

const lifecycleUrl = (procedureId: string) => `https://example.test/api/manage/decision-matrix/procedures/${procedureId}/revisions/1/lifecycle`;
const checkUrl = (procedureId: string) => `https://example.test/api/manage/decision-matrix/procedures/${procedureId}/revisions/1/document-references/check`;
const params = (procedureId: string) => ({ procedureId, revision: "1" });

test("document health is observed by the application, recorded by one writer, and gates approval on what it found", { skip: !connectionString }, async () => {
  if (!connectionString) return;
  process.env.SQL_CONNECTION_STRING = connectionString;
  const pool = new sql.ConnectionPool(parseConnectionString(connectionString));
  const procedureIds: string[] = [];

  async function createUnderReview(label: string): Promise<string> {
    const procedureId = `dm-health-${label}-${randomUUID()}`;
    procedureIds.push(procedureId);
    const created = await createDecisionMatrixProcedureDraft(requestFor("https://example.test/api/manage/decision-matrix/procedures", {
      procedure_id: procedureId,
      condition_key: `dm-health-${label}-${randomUUID()}`,
      condition: `Document health contract ${label}`,
      severity: "Restrict service",
      severity_meaning: "Continue under limits.",
      owner_team: "Operations Control Center",
      effective_at: "2026-08-25T00:00:00.000Z",
      next_review_at: "2027-02-25T00:00:00.000Z",
      criteria: [{ kind: "applies", text: "It applies." }],
      immediate_actions: [{ kind: "required", instruction: "Do the thing." }],
      document_references: [{
        document_type: "SOP", is_primary: true, document_code: "SOP-HEALTH",
        item_id: "item-health", seen_version: "3.0",
      }],
    }), context, LIBRARY);
    assert.equal(created.status, 201);
    const submitted = await governDecisionMatrixProcedureRevision(
      requestFor(lifecycleUrl(procedureId), { action: "submit_for_review", reason: "Ready." }, params(procedureId)),
      context,
      createInMemoryMetadataReader({ "item-health": MATCHING }),
    );
    assert.equal(submitted.status, 200);
    return procedureId;
  }

  await pool.connect();
  try {
    await ensureTables(pool);
    // The contract database is shared, so the notice's counts are compared as
    // changes from here rather than as absolute numbers.
    const before = await documentCheckStatus({});

    // A check records who caused it, that the application looked, and what it saw.
    const recorded = await createUnderReview("recorded");
    const audit = await pool.request().input("procedure_id", sql.NVarChar, recorded)
      .query<{ actor: string; details_json: string }>("SELECT actor,details_json FROM ProcedureAuditEvents WHERE procedure_id=@procedure_id AND event_type='document_checked'");
    assert.equal(audit.recordset.length, 1);
    assert.equal(audit.recordset[0].actor, ADMIN, "the actor is the Admin who caused the check");
    const details = JSON.parse(audit.recordset[0].details_json) as Record<string, unknown>;
    assert.deepEqual({ ...details, reference_id: "(any)" }, {
      reference_id: "(any)",
      health_status: "Valid",
      outcome: "ok",
      observed_by: "application",
      observed_version: "3.0",
      observed_file_name: "SOP-HEALTH.docx",
      observed_mime_type: DOCX,
    });

    // The SOP changed after submission. Approval re-reads it, records Needs
    // review, refuses, and returns what it found; that observation stands
    // although the approval did not.
    const edited = await createUnderReview("edited");
    const editRefused = await governDecisionMatrixProcedureRevision(
      requestFor(lifecycleUrl(edited), { action: "approve", reason: "Publish." }, params(edited)),
      context,
      createInMemoryMetadataReader({ "item-health": { kind: "found", document: { version: "4.0", file_name: "SOP-HEALTH.docx", mime_type: DOCX } } }),
    );
    assert.equal(editRefused.status, 409);
    const editCheck = (editRefused.jsonBody as { details: { document_check: { outcome: string; document_references: Array<{ health_status: string; outcome: string; reason: string; expected_file_name: string }> } } }).details.document_check;
    assert.equal(editCheck.outcome, "checked");
    assert.equal(editCheck.document_references[0].health_status, "Needs review");
    assert.equal(editCheck.document_references[0].expected_file_name, "SOP-HEALTH.docx");
    assert.match(editCheck.document_references[0].reason, /no longer matches/);
    const editedRow = await pool.request().input("procedure_id", sql.NVarChar, edited)
      .query<{ health_status: string; observed_version: string; lifecycle_state: string }>("SELECT d.health_status,d.observed_version,r.lifecycle_state FROM ProcedureDocumentReferences d JOIN ProcedureRevisions r ON r.procedure_id=d.procedure_id AND r.revision=d.revision WHERE d.procedure_id=@procedure_id");
    assert.deepEqual(editedRow.recordset[0], { health_status: "Needs review", observed_version: "4.0", lifecycle_state: "Under review" });

    // SharePoint refuses the documents application. That refusal is an
    // observation: recorded Unavailable, with a reason that names the site
    // grant and not the document, and approval is refused.
    const refused = await createUnderReview("refused");
    const grantRefused = await governDecisionMatrixProcedureRevision(
      requestFor(lifecycleUrl(refused), { action: "approve", reason: "Publish." }, params(refused)),
      context,
      createInMemoryMetadataReader({ "item-health": { kind: "grant_missing" } }),
    );
    assert.equal(grantRefused.status, 409);
    const refusedRow = await pool.request().input("procedure_id", sql.NVarChar, refused)
      .query<{ health_status: string; health_reason: string }>("SELECT health_status,health_reason FROM ProcedureDocumentReferences WHERE procedure_id=@procedure_id");
    assert.equal(refusedRow.recordset[0].health_status, "Unavailable");
    assert.match(refusedRow.recordset[0].health_reason, /grant the Decision Matrix documents application read access/);
    assert.doesNotMatch(refusedRow.recordset[0].health_reason, /Entra/);

    // The four ways a read can fail have different owners, and must not share a message.
    const reasons = new Set<string>();
    const failures: MetadataRead[] = [{ kind: "credential_rejected" }, { kind: "grant_missing" }, { kind: "not_found" }, { kind: "failed", detail: "Microsoft Graph returned 503." }];
    for (const read of failures) {
      const checked = await checkDecisionMatrixProcedureReferences(requestFor(checkUrl(refused), {}, params(refused)), context, createInMemoryMetadataReader({ "item-health": read }));
      assert.equal(checked.status, 200);
      const reference = (checked.jsonBody as { document_references: Array<{ health_status: string; reason: string }> }).document_references[0];
      assert.equal(reference.health_status, "Unavailable");
      reasons.add(reference.reason);
    }
    assert.equal(reasons.size, 4, `expected four distinct reasons, got ${JSON.stringify([...reasons])}`);

    // A fresh matching read approves.
    const approved = await governDecisionMatrixProcedureRevision(
      requestFor(lifecycleUrl(recorded), { action: "approve", reason: "Publish." }, params(recorded)),
      context,
      createInMemoryMetadataReader({ "item-health": MATCHING }),
    );
    assert.equal(approved.status, 200);

    // The daily check covers what controllers read and what awaits approval,
    // once due. Age every check past a day, then retire one: it drops out.
    for (const procedureId of procedureIds) {
      await pool.request().input("procedure_id", sql.NVarChar, procedureId)
        .query("UPDATE ProcedureDocumentReferences SET checked_at=DATEADD(DAY,-2,SYSUTCDATETIME()) WHERE procedure_id=@procedure_id");
    }
    await pool.request().input("procedure_id", sql.NVarChar, edited)
      .query("UPDATE ProcedureRevisions SET lifecycle_state='Retired' WHERE procedure_id=@procedure_id");
    const due = (await revisionsDueForHealthCheck()).map((revision) => revision.procedure_id).filter((id) => procedureIds.includes(id)).sort();
    assert.deepEqual(due, [recorded, refused].sort(), "Approved and Under review revisions are due; a Retired one is not");

    // Migration 126: each check records why health is what it is.
    const outcomes = await pool.request().input("recorded", sql.NVarChar, recorded).input("refused", sql.NVarChar, refused)
      .query<{ procedure_id: string; health_outcome: string }>("SELECT procedure_id,health_outcome FROM ProcedureDocumentReferences WHERE procedure_id IN (@recorded,@refused)");
    const outcomeFor = (procedureId: string) => outcomes.recordset.find((row) => row.procedure_id === procedureId)?.health_outcome;
    assert.equal(outcomeFor(recorded), "ok", "a read document records ok");
    assert.equal(outcomeFor(refused), "failed", "the last check of this one was an outage");
    await assert.rejects(
      pool.request().input("procedure_id", sql.NVarChar, recorded).query("UPDATE ProcedureDocumentReferences SET health_outcome='not_configured' WHERE procedure_id=@procedure_id"),
      /CK_ProcedureDocumentReferences_HealthOutcome|conflicted/i,
      "not_configured is never recorded, so the column refuses it",
    );

    // The governance notice reads what the checks left behind. SharePoint now
    // refuses the one Under review revision's document: one more refusal.
    const refusedAgain = await checkDecisionMatrixProcedureReferences(requestFor(checkUrl(refused), {}, params(refused)), context, createInMemoryMetadataReader({ "item-health": { kind: "grant_missing" } }));
    assert.equal(refusedAgain.status, 200);
    const after = await documentCheckStatus({});
    assert.equal((after.refused_reference_count ?? 0) - (before.refused_reference_count ?? 0), 1, "a refused check is counted");
    assert.equal(after.overdue, true, "a current revision last checked two days ago is overdue");
    assert.ok(after.oldest_check_at !== null && Date.parse(after.oldest_check_at) < Date.now() - 24 * 60 * 60 * 1000, "the oldest check is the aged one");
    assert.ok(after.current_revision_count >= 2, "the Approved and Under review contract revisions are current");

    // Configured is a settings check: the documents application, and only it.
    assert.equal(after.configured, false, "nothing configured in this environment");
    assert.equal((await documentCheckStatus({ AZURE_TENANT_ID: "t", ONBOARD_API_CLIENT_ID: "sign-in", ONBOARD_API_CLIENT_SECRET: "s" })).configured, false, "the sign-in application does not count");
    assert.equal((await documentCheckStatus({ AZURE_TENANT_ID: "t", DECISION_MATRIX_HEALTH_CLIENT_ID: "documents", DECISION_MATRIX_HEALTH_CLIENT_SECRET: "s" })).configured, true);
  } finally {
    for (const procedureId of procedureIds) {
      await pool.request().input("procedure_id", sql.NVarChar, procedureId).query("DELETE FROM Procedures WHERE procedure_id=@procedure_id").catch(() => undefined);
    }
    await pool.close();
    await (sql as unknown as { close(): Promise<void> }).close();
  }
});
