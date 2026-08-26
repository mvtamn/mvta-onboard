import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { ADMIN_ROLES, requireRole } from "../lib/auth";
import { getPool } from "../lib/db";

function requireAdmin(request: HttpRequest) {
  const auth = requireRole(request, ADMIN_ROLES);
  return auth.authorized ? null : { status: auth.status, jsonBody: { error: auth.message } };
}

export async function listDecisionMatrixGovernanceQueue(request: HttpRequest, context: InvocationContext) {
  const denied = requireAdmin(request); if (denied) return denied;
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT p.procedure_id,p.condition_key,p.condition,r.revision,r.lifecycle_state,r.next_review_at,
        CASE WHEN r.next_review_at < SYSUTCDATETIME() THEN 1 ELSE 0 END AS review_overdue,
        (SELECT COUNT(*) FROM ProcedureDocumentReferences d WHERE d.procedure_id=r.procedure_id AND d.revision=r.revision AND d.health_status<>'Valid') AS unhealthy_reference_count,
        (SELECT COUNT(*) FROM ProcedureDocumentReferences d WHERE d.procedure_id=r.procedure_id AND d.revision=r.revision AND (d.checked_at IS NULL OR d.checked_at<r.updated_at)) AS unchecked_reference_count
      FROM Procedures p JOIN ProcedureRevisions r ON r.procedure_id=p.procedure_id
      WHERE r.lifecycle_state IN ('Draft','Under review','Approved')
      ORDER BY CASE WHEN r.lifecycle_state='Under review' THEN 0 WHEN r.next_review_at<SYSUTCDATETIME() THEN 1 ELSE 2 END,p.condition,r.revision DESC`);
    return { status: 200, jsonBody: { procedures: result.recordset } };
  } catch (error) { context.error("GET Decision Matrix governance queue failed", error); return { status: 500, jsonBody: { error: "Decision Matrix governance queue is temporarily unavailable." } }; }
}

export async function listDecisionMatrixAudit(request: HttpRequest, context: InvocationContext) {
  const denied = requireAdmin(request); if (denied) return denied;
  try {
    const pool = await getPool();
    const result = await pool.request().query(`SELECT TOP 250 event_id,procedure_id,revision,event_type,actor,reason,details_json,occurred_at FROM ProcedureAuditEvents ORDER BY occurred_at DESC`);
    return { status: 200, jsonBody: { audit_events: result.recordset } };
  } catch (error) { context.error("GET Decision Matrix audit failed", error); return { status: 500, jsonBody: { error: "Decision Matrix audit history is temporarily unavailable." } }; }
}

app.http("decisionMatrixGovernanceQueue", { route: "admin/decision-matrix/governance-queue", methods: ["GET"], authLevel: "anonymous", handler: listDecisionMatrixGovernanceQueue });
app.http("decisionMatrixAudit", { route: "admin/decision-matrix/audit", methods: ["GET"], authLevel: "anonymous", handler: listDecisionMatrixAudit });
