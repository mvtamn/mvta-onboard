import { app, type HttpRequest, type InvocationContext, type Timer } from "@azure/functions";
import { ADMIN_ROLES, requireRole } from "../lib/auth";
import { getPool, sql } from "../lib/db";
import {
  DAILY_CHECK_ACTOR,
  documentHealthReader,
  refreshRevisionHealth,
  revisionsDueForHealthCheck,
  type DocumentMetadataReader,
} from "../lib/decisionMatrixDocumentHealth";
import { recordProcedureAuditEvent as recordAudit } from "../lib/procedureAudit";

type LifecycleAction = "submit_for_review" | "return_to_draft" | "approve" | "retire" | "withdraw";

function actorFor(request: HttpRequest) {
  const principal = requireRole(request, ADMIN_ROLES);
  return principal.authorized ? principal.principal.userId ?? null : null;
}

async function revisionIsComplete(executor: { request: () => sql.Request }, procedureId: string, revision: number, requireValidPrimary: boolean) {
  const gate = await executor.request().input("procedure_id", sql.NVarChar, procedureId).input("revision", sql.Int, revision).query<{ complete: number }>(`
    SELECT CASE WHEN EXISTS(SELECT 1 FROM ProcedureRevisions r WHERE procedure_id=@procedure_id AND revision=@revision AND severity IS NOT NULL AND severity_meaning IS NOT NULL AND owner_team IS NOT NULL AND effective_at IS NOT NULL AND next_review_at IS NOT NULL)
      AND EXISTS(SELECT 1 FROM ProcedureCriteria WHERE procedure_id=@procedure_id AND revision=@revision)
      AND EXISTS(SELECT 1 FROM ProcedureImmediateActions WHERE procedure_id=@procedure_id AND revision=@revision)
      AND EXISTS(SELECT 1 FROM ProcedureDocumentReferences WHERE procedure_id=@procedure_id AND revision=@revision AND is_primary=1 AND document_type IN ('SOP','Reference') ${requireValidPrimary ? "AND health_status='Valid'" : ""})
      AND NOT EXISTS(SELECT 1 FROM ProcedureDocumentReferences d JOIN ProcedureRevisions r ON r.procedure_id=d.procedure_id AND r.revision=d.revision WHERE d.procedure_id=@procedure_id AND d.revision=@revision AND (d.checked_at IS NULL OR d.checked_at<r.updated_at))
    THEN 1 ELSE 0 END complete`);
  return gate.recordset[0]?.complete === 1;
}

export async function governDecisionMatrixProcedureRevision(request: HttpRequest, context: InvocationContext, reader: DocumentMetadataReader | null = documentHealthReader()) {
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
    // Submitting and approving both refresh document health first, and
    // approval then gates on that fresh result. A Valid recorded this morning
    // cannot say the SOP was not edited since, and approval is when a revision
    // starts telling controllers what to do. There is no fallback to an earlier
    // observation: refusing approval during an outage costs a wait, and
    // approval is never the urgent path - withdrawal is, and it checks nothing.
    const documentCheck = action === "submit_for_review" || action === "approve"
      ? await refreshRevisionHealth(procedureId, revision, actor, reader)
      : null;
    if (documentCheck?.outcome === "not_configured") {
      return {
        status: 409,
        jsonBody: {
          error: action === "approve"
            ? "Approval needs a fresh document check, and document checks are not configured here, so nothing was checked."
            : "Submission needs a fresh document check, and document checks are not configured here, so nothing was checked.",
          details: { document_check: documentCheck },
        },
      };
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
        return { status: 409, jsonBody: { error: action === "approve" ? "Publication requires complete guidance and a currently Valid primary SOP or Reference." : "Review requires complete guidance and a primary SOP or Reference.", details: { document_check: documentCheck } } };
      }
      if (action === "retire") {
        const replacement = Number(body.replacement_revision);
        const replacementProcedureId = typeof body.replacement_procedure_id === "string" && body.replacement_procedure_id.trim() ? body.replacement_procedure_id.trim() : procedureId;
        const replacementOk = Number.isInteger(replacement) && !(replacementProcedureId === procedureId && replacement === revision) && (await transaction.request().input("procedure_id", sql.NVarChar, replacementProcedureId).input("replacement", sql.Int, replacement).query<{ replacement_exists: number }>("SELECT CASE WHEN EXISTS(SELECT 1 FROM ProcedureRevisions WHERE procedure_id=@procedure_id AND revision=@replacement AND lifecycle_state='Approved') THEN 1 ELSE 0 END AS replacement_exists")).recordset[0]?.replacement_exists === 1;
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

export async function checkDecisionMatrixProcedureReferences(request: HttpRequest, context: InvocationContext, reader: DocumentMetadataReader | null = documentHealthReader()) {
  const auth = requireRole(request, ADMIN_ROLES);
  if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  const procedureId = request.params.procedureId; const revision = Number(request.params.revision);
  if (!procedureId || !Number.isInteger(revision)) return { status: 400, jsonBody: { error: "procedureId and integer revision are required." } };
  const actor = actorFor(request);
  if (!actor) return { status: 401, jsonBody: { error: "A stable Admin identity is required for Procedure governance." } };
  // "Not configured" answers 200: the question was well formed and the answer
  // is known. A 5xx would read in the console as an outage.
  try { return { status: 200, jsonBody: await refreshRevisionHealth(procedureId, revision, actor, reader) }; }
  catch (error) { context.error("Decision Matrix document check failed", error); return { status: 500, jsonBody: { error: "Document references could not be checked." } }; }
}

app.http("decisionMatrixProcedureLifecycle", { route: "manage/decision-matrix/procedures/{procedureId}/revisions/{revision}/lifecycle", methods: ["POST"], authLevel: "anonymous", handler: governDecisionMatrixProcedureRevision });
app.http("decisionMatrixProcedureDocumentCheck", { route: "manage/decision-matrix/procedures/{procedureId}/revisions/{revision}/document-references/check", methods: ["POST"], authLevel: "anonymous", handler: checkDecisionMatrixProcedureReferences });
app.timer("decisionMatrixDocumentHealth", { schedule: "0 0 5 * * *", handler: async (_timer: Timer, context: InvocationContext) => {
  const reader = documentHealthReader();
  if (!reader) {
    // Skipping writes nothing, per ADR 0025. The old warning called this path
    // "delegated", which it never was.
    context.warn("Decision Matrix document health was not checked: DECISION_MATRIX_HEALTH_CLIENT_ID and DECISION_MATRIX_HEALTH_CLIENT_SECRET are not configured.");
    return;
  }
  for (const due of await revisionsDueForHealthCheck()) {
    try { await refreshRevisionHealth(due.procedure_id, due.revision, DAILY_CHECK_ACTOR, reader); }
    catch (error) { context.error("Decision Matrix daily document check failed", error); }
  }
} });
