import { randomUUID } from "node:crypto";
import { app, type HttpRequest, type InvocationContext, type Timer } from "@azure/functions";
import { ClientSecretCredential, OnBehalfOfCredential } from "@azure/identity";
import { ADMIN_ROLES, requireRole } from "../lib/auth";
import { getPool, sql } from "../lib/db";
import { createGraphDocumentChecker, type DocumentReferenceChecker } from "../lib/decisionMatrixDocumentHealth";

type LifecycleAction = "submit_for_review" | "return_to_draft" | "approve" | "retire" | "withdraw";
type ReferenceRow = { reference_id: string; site_id: string; drive_id: string; item_id: string; expected_version: string; expected_file_name: string; expected_mime_type: string };

function actorFor(request: HttpRequest) {
  const principal = requireRole(request, ADMIN_ROLES);
  return principal.authorized ? principal.principal.userId ?? null : null;
}

function requiredSetting(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for delegated SharePoint document checks.`);
  return value;
}

function productionChecker(): DocumentReferenceChecker {
  return createGraphDocumentChecker(async (assertion) => {
    const credential = new OnBehalfOfCredential({
      tenantId: requiredSetting("AZURE_TENANT_ID"),
      clientId: requiredSetting("ONBOARD_API_CLIENT_ID"),
      clientSecret: requiredSetting("ONBOARD_API_CLIENT_SECRET"),
      userAssertionToken: assertion,
    });
    const token = await credential.getToken("https://graph.microsoft.com/.default");
    if (!token?.token) throw new Error("Microsoft Graph delegated token acquisition returned no token.");
    return token.token;
  });
}

function dailyChecker(): DocumentReferenceChecker {
  const tenantId = requiredSetting("AZURE_TENANT_ID");
  const clientId = requiredSetting("DECISION_MATRIX_HEALTH_CLIENT_ID");
  const clientSecret = requiredSetting("DECISION_MATRIX_HEALTH_CLIENT_SECRET");
  const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
  return createGraphDocumentChecker(async () => {
    const token = await credential.getToken("https://graph.microsoft.com/.default");
    if (!token?.token) throw new Error("Microsoft Graph background token acquisition returned no token.");
    return token.token;
  });
}

async function recordAudit(executor: { request: () => sql.Request }, procedureId: string, revision: number, eventType: string, actor: string, reason: string | null, details: Record<string, unknown> = {}) {
  const request = executor.request();
  request.input("id", sql.UniqueIdentifier, randomUUID());
  request.input("procedure_id", sql.NVarChar, procedureId);
  request.input("revision", sql.Int, revision);
  request.input("event_type", sql.NVarChar, eventType);
  request.input("actor", sql.NVarChar, actor);
  request.input("reason", sql.NVarChar, reason);
  request.input("details", sql.NVarChar, JSON.stringify(details));
  await request.query("INSERT INTO ProcedureAuditEvents(event_id,procedure_id,revision,event_type,actor,reason,details_json) VALUES(@id,@procedure_id,@revision,@event_type,@actor,@reason,@details)");
}

async function checkReferences(procedureId: string, revision: number, actor: string, userAssertion: string | undefined, checker: DocumentReferenceChecker) {
  const pool = await getPool();
  const references = await pool.request().input("procedure_id", sql.NVarChar, procedureId).input("revision", sql.Int, revision)
    .query<ReferenceRow>("SELECT reference_id,site_id,drive_id,item_id,expected_version,expected_file_name,expected_mime_type FROM ProcedureDocumentReferences WHERE procedure_id=@procedure_id AND revision=@revision ORDER BY sort_order");
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const outcomes = [];
    for (const reference of references.recordset) {
      const outcome = await checker(reference, userAssertion);
      const update = transaction.request();
      update.input("reference_id", sql.UniqueIdentifier, reference.reference_id);
      update.input("health_status", sql.NVarChar, outcome.health_status);
      update.input("observed_version", sql.NVarChar, outcome.observed_version);
      update.input("observed_file_name", sql.NVarChar, outcome.observed_file_name);
      update.input("observed_mime_type", sql.NVarChar, outcome.observed_mime_type);
      update.input("reason", sql.NVarChar, outcome.reason);
      await update.query("UPDATE ProcedureDocumentReferences SET health_status=@health_status,checked_at=SYSUTCDATETIME(),observed_version=@observed_version,observed_file_name=@observed_file_name,observed_mime_type=@observed_mime_type,health_reason=@reason WHERE reference_id=@reference_id");
      await recordAudit(transaction, procedureId, revision, "document_checked", actor, outcome.reason, { reference_id: reference.reference_id, health_status: outcome.health_status });
      outcomes.push({ reference_id: reference.reference_id, health_status: outcome.health_status, reason: outcome.reason });
    }
    await transaction.commit();
    return outcomes;
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  }
}

async function revisionIsComplete(executor: { request: () => sql.Request }, procedureId: string, revision: number, requireValidPrimary: boolean) {
  const gate = await executor.request().input("procedure_id", sql.NVarChar, procedureId).input("revision", sql.Int, revision).query<{ complete: number }>(`
    SELECT CASE WHEN EXISTS(SELECT 1 FROM ProcedureRevisions WHERE procedure_id=@procedure_id AND revision=@revision AND severity IS NOT NULL AND severity_meaning IS NOT NULL AND owner_team IS NOT NULL AND effective_at IS NOT NULL AND next_review_at IS NOT NULL)
      AND EXISTS(SELECT 1 FROM ProcedureCriteria WHERE procedure_id=@procedure_id AND revision=@revision)
      AND EXISTS(SELECT 1 FROM ProcedureImmediateActions WHERE procedure_id=@procedure_id AND revision=@revision)
      AND EXISTS(SELECT 1 FROM ProcedureDocumentReferences WHERE procedure_id=@procedure_id AND revision=@revision AND is_primary=1 AND document_type IN ('SOP','Reference') ${requireValidPrimary ? "AND health_status='Valid'" : ""})
    THEN 1 ELSE 0 END complete`);
  return gate.recordset[0]?.complete === 1;
}

export async function governDecisionMatrixProcedureRevision(request: HttpRequest, context: InvocationContext, checker: DocumentReferenceChecker = productionChecker()) {
  const auth = requireRole(request, ADMIN_ROLES);
  if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  const procedureId = request.params.procedureId;
  const revision = Number(request.params.revision);
  if (!procedureId || !Number.isInteger(revision)) return { status: 400, jsonBody: { error: "procedureId and integer revision are required." } };
  let body: { action?: unknown; reason?: unknown; replacement_procedure_id?: unknown; replacement_revision?: unknown; confirm_withdrawal?: unknown };
  try { body = await request.json() as typeof body; } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON." } }; }
  const action = body.action as LifecycleAction;
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null;
  if (!["submit_for_review", "return_to_draft", "approve", "retire", "withdraw"].includes(action)) return { status: 400, jsonBody: { error: "A supported lifecycle action is required." } };
  if (!reason) return { status: 400, jsonBody: { error: "A governance reason is required." } };
  if (action === "withdraw" && body.confirm_withdrawal !== true) return { status: 400, jsonBody: { error: "Emergency withdrawal requires prominent confirmation." } };
  const actor = actorFor(request);
  if (!actor) return { status: 401, jsonBody: { error: "A stable Admin identity is required for Procedure governance." } };
  try {
    if (action === "submit_for_review" || action === "approve") {
      await checkReferences(procedureId, revision, actor, request.headers.get("x-ms-token-aad-access-token") ?? undefined, checker);
    }
    const pool = await getPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      const current = await transaction.request().input("procedure_id", sql.NVarChar, procedureId).input("revision", sql.Int, revision).query<{ lifecycle_state: string }>("SELECT lifecycle_state FROM ProcedureRevisions WITH (UPDLOCK,HOLDLOCK) WHERE procedure_id=@procedure_id AND revision=@revision");
      const state = current.recordset[0]?.lifecycle_state;
      const allowed: Record<LifecycleAction, string> = { submit_for_review: "Draft", return_to_draft: "Under review", approve: "Under review", retire: "Approved", withdraw: "Approved" };
      if (!state) { await transaction.rollback(); return { status: 404, jsonBody: { error: "Procedure Revision not found." } }; }
      if (state !== allowed[action]) { await transaction.rollback(); return { status: 409, jsonBody: { error: `Cannot ${action.replaceAll("_", " ")} a ${state} Procedure Revision.` } }; }
      if ((action === "submit_for_review" || action === "approve") && !await revisionIsComplete(transaction, procedureId, revision, action === "approve")) {
        await transaction.rollback();
        return { status: 409, jsonBody: { error: action === "approve" ? "Publication requires complete guidance and a currently Valid primary SOP or Reference." : "Review requires complete guidance and a primary SOP or Reference." } };
      }
      if (action === "retire") {
        const replacement = Number(body.replacement_revision);
        const replacementProcedureId = typeof body.replacement_procedure_id === "string" && body.replacement_procedure_id.trim() ? body.replacement_procedure_id.trim() : procedureId;
        const replacementOk = Number.isInteger(replacement) && !(replacementProcedureId === procedureId && replacement === revision) && (await transaction.request().input("procedure_id", sql.NVarChar, replacementProcedureId).input("replacement", sql.Int, replacement).query<{ exists: number }>("SELECT CASE WHEN EXISTS(SELECT 1 FROM ProcedureRevisions WHERE procedure_id=@procedure_id AND revision=@replacement AND lifecycle_state='Approved') THEN 1 ELSE 0 END exists")).recordset[0]?.exists === 1;
        if (!replacementOk) { await transaction.rollback(); return { status: 409, jsonBody: { error: "Ordinary retirement requires a different approved replacement revision." } }; }
      }
      if (action === "approve") {
        const supersede = transaction.request();
        supersede.input("procedure_id", sql.NVarChar, procedureId); supersede.input("revision", sql.Int, revision); supersede.input("actor", sql.NVarChar, actor);
        const superseded = await supersede.query<{ revision: number }>("UPDATE ProcedureRevisions SET lifecycle_state='Superseded',updated_at=SYSUTCDATETIME(),updated_by=@actor OUTPUT INSERTED.revision WHERE procedure_id=@procedure_id AND lifecycle_state='Approved' AND revision<>@revision");
        for (const prior of superseded.recordset) await recordAudit(transaction, procedureId, prior.revision, "superseded", actor, "Superseded by an approved replacement revision.", { replacement_revision: revision });
      }
      const targetState = action === "submit_for_review" ? "Under review" : action === "return_to_draft" ? "Draft" : action === "approve" ? "Approved" : "Retired";
      const update = transaction.request(); update.input("procedure_id", sql.NVarChar, procedureId); update.input("revision", sql.Int, revision); update.input("actor", sql.NVarChar, actor);
      await update.query(`UPDATE ProcedureRevisions SET lifecycle_state='${targetState}',updated_at=SYSUTCDATETIME(),updated_by=@actor WHERE procedure_id=@procedure_id AND revision=@revision`);
      await recordAudit(transaction, procedureId, revision, action === "withdraw" ? "emergency_withdrawal" : action, actor, reason, action === "retire" ? { replacement_procedure_id: typeof body.replacement_procedure_id === "string" ? body.replacement_procedure_id : procedureId, replacement_revision: Number(body.replacement_revision) } : {});
      await transaction.commit();
      return { status: 200, jsonBody: { procedure_id: procedureId, revision, lifecycle_state: targetState } };
    } catch (error) { await transaction.rollback().catch(() => undefined); throw error; }
  } catch (error) { context.error("Decision Matrix Procedure governance failed", error); return { status: 500, jsonBody: { error: "Procedure governance is temporarily unavailable." } }; }
}

export async function checkDecisionMatrixProcedureReferences(request: HttpRequest, context: InvocationContext, checker: DocumentReferenceChecker = productionChecker()) {
  const auth = requireRole(request, ADMIN_ROLES);
  if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  const procedureId = request.params.procedureId; const revision = Number(request.params.revision);
  if (!procedureId || !Number.isInteger(revision)) return { status: 400, jsonBody: { error: "procedureId and integer revision are required." } };
  const actor = actorFor(request);
  if (!actor) return { status: 401, jsonBody: { error: "A stable Admin identity is required for Procedure governance." } };
  try { return { status: 200, jsonBody: { document_references: await checkReferences(procedureId, revision, actor, request.headers.get("x-ms-token-aad-access-token") ?? undefined, checker) } }; }
  catch (error) { context.error("Decision Matrix document check failed", error); return { status: 500, jsonBody: { error: "Document references could not be checked." } }; }
}

app.http("decisionMatrixProcedureLifecycle", { route: "admin/decision-matrix/procedures/{procedureId}/revisions/{revision}/lifecycle", methods: ["POST"], authLevel: "anonymous", handler: governDecisionMatrixProcedureRevision });
app.http("decisionMatrixProcedureDocumentCheck", { route: "admin/decision-matrix/procedures/{procedureId}/revisions/{revision}/document-references/check", methods: ["POST"], authLevel: "anonymous", handler: checkDecisionMatrixProcedureReferences });
app.timer("decisionMatrixDocumentHealth", { schedule: "0 0 5 * * *", handler: async (_timer: Timer, context: InvocationContext) => {
  let checker: DocumentReferenceChecker;
  try { checker = dailyChecker(); }
  catch (error) { context.warn(error instanceof Error ? error.message : "Decision Matrix document health identity is not configured."); return; }
  const pool = await getPool();
  const revisions = await pool.request().query<{ procedure_id: string; revision: number }>("SELECT DISTINCT procedure_id,revision FROM ProcedureDocumentReferences WHERE checked_at IS NULL OR checked_at<DATEADD(DAY,-1,SYSUTCDATETIME())");
  for (const revision of revisions.recordset) {
    try { await checkReferences(revision.procedure_id, revision.revision, "Decision Matrix daily health check", "background-health-check", checker); }
    catch (error) { context.error("Decision Matrix daily document check failed", error); }
  }
} });
