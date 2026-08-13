import { app, type HttpRequest, type InvocationContext, type Timer } from "@azure/functions";
import { ADMIN_ROLES, requireRole } from "../lib/auth";
import { getPool, sql } from "../lib/db";

interface SourceProcedure {
  procedure_id: string;
  revision: number;
  condition_key: string;
  condition: string;
  criteria: string;
  severity: string;
  severity_meaning?: string | null;
  immediate_actions?: string[];
  escalation_triggers?: string[];
  notifications?: string[];
  tags?: string[];
  service_mode?: string | null;
  affected_workflow?: string | null;
  urgency?: string | null;
  document_type: "SOP" | "REF";
  document_code: string;
  source_url?: string | null;
  source_revision?: string | null;
  owner?: string | null;
  approver?: string | null;
  effective_at?: string | null;
  next_review_at?: string | null;
}

export async function syncDecisionMatrix(context: InvocationContext): Promise<{ status: string; count: number; reason?: string }> {
  const sourceUrl = process.env.DECISION_MATRIX_SHAREPOINT_URL;
  const token = process.env.DECISION_MATRIX_SHAREPOINT_TOKEN;
  if (!sourceUrl || !token) {
    const reason = "SharePoint source is not configured; approved content was left unchanged.";
    context.warn(reason);
    return { status: "unavailable", count: 0, reason };
  }

  const response = await fetch(sourceUrl, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  if (!response.ok) throw new Error(`SharePoint source returned ${response.status}`);
  const payload = await response.json() as { procedures?: SourceProcedure[] };
  const procedures = Array.isArray(payload.procedures) ? payload.procedures : [];
  const pool = await getPool();
  for (const procedure of procedures) {
    const request = pool.request();
    request.input("procedure_id", sql.NVarChar, procedure.procedure_id);
    request.input("revision", sql.Int, procedure.revision);
    request.input("condition_key", sql.NVarChar, procedure.condition_key);
    request.input("condition", sql.NVarChar, procedure.condition);
    request.input("criteria", sql.NVarChar, procedure.criteria);
    request.input("severity", sql.NVarChar, procedure.severity);
    request.input("severity_meaning", sql.NVarChar, procedure.severity_meaning ?? null);
    request.input("actions", sql.NVarChar, JSON.stringify(procedure.immediate_actions ?? []));
    request.input("escalation", sql.NVarChar, JSON.stringify(procedure.escalation_triggers ?? []));
    request.input("notifications", sql.NVarChar, JSON.stringify(procedure.notifications ?? []));
    request.input("tags", sql.NVarChar, JSON.stringify(procedure.tags ?? []));
    request.input("service_mode", sql.NVarChar, procedure.service_mode ?? null);
    request.input("workflow", sql.NVarChar, procedure.affected_workflow ?? null);
    request.input("urgency", sql.NVarChar, procedure.urgency ?? null);
    request.input("document_type", sql.NVarChar, procedure.document_type);
    request.input("document_code", sql.NVarChar, procedure.document_code);
    request.input("source_url", sql.NVarChar, procedure.source_url ?? null);
    request.input("source_revision", sql.NVarChar, procedure.source_revision ?? null);
    request.input("owner", sql.NVarChar, procedure.owner ?? null);
    request.input("approver", sql.NVarChar, procedure.approver ?? null);
    request.input("effective_at", sql.DateTime2, procedure.effective_at ? new Date(procedure.effective_at) : null);
    request.input("next_review_at", sql.DateTime2, procedure.next_review_at ? new Date(procedure.next_review_at) : null);
    await request.query(`
      MERGE DecisionMatrixProcedures WITH (HOLDLOCK) AS target
      USING (SELECT @procedure_id procedure_id, @revision revision) src
      ON target.procedure_id = src.procedure_id AND target.revision = src.revision
      WHEN MATCHED AND target.approval_state <> 'Approved' THEN UPDATE SET
        condition_key=@condition_key, condition=@condition, criteria=@criteria,
        severity=@severity, severity_meaning=@severity_meaning,
        immediate_actions_json=@actions, escalation_triggers_json=@escalation,
        notifications_json=@notifications, tags_json=@tags, service_mode=@service_mode,
        affected_workflow=@workflow, urgency=@urgency, document_type=@document_type,
        document_code=@document_code, source_url=@source_url, source_revision=@source_revision,
        owner=@owner, approver=@approver, effective_at=@effective_at,
        next_review_at=@next_review_at, approval_state='Preview', trust_state='Preview',
        source_status='available', last_synced_at=SYSUTCDATETIME(), updated_at=SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (
        procedure_id, revision, condition_key, condition, criteria, severity,
        severity_meaning, immediate_actions_json, escalation_triggers_json,
        notifications_json, tags_json, service_mode, affected_workflow, urgency,
        document_type, document_code, source_url, source_revision, owner, approver,
        approval_state, trust_state, effective_at, next_review_at, source_status, last_synced_at
      ) VALUES (
        @procedure_id, @revision, @condition_key, @condition, @criteria, @severity,
        @severity_meaning, @actions, @escalation, @notifications, @tags, @service_mode,
        @workflow, @urgency, @document_type, @document_code, @source_url, @source_revision,
        @owner, @approver, 'Preview', 'Preview', @effective_at, @next_review_at,
        'available', SYSUTCDATETIME()
      );
    `);
  }
  return { status: "preview", count: procedures.length };
}

app.http("decisionMatrixSync", {
  route: "admin/decision-matrix/sync",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, ADMIN_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    try {
      return { status: 200, jsonBody: await syncDecisionMatrix(context) };
    } catch (error) {
      context.error("Decision Matrix SharePoint sync failed", error);
      return { status: 502, jsonBody: { error: "SharePoint synchronization failed; approved content was left unchanged." } };
    }
  },
});

app.timer("decisionMatrixSyncTimer", {
  schedule: "0 0 */6 * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    try { await syncDecisionMatrix(context); } catch (error) { context.error("Scheduled Decision Matrix sync failed", error); }
  },
});
