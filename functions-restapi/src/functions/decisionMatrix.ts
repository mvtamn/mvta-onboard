import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { STAFF_READ_ROLES, requireRole } from "../lib/auth";
import { getPool, sql } from "../lib/db";

type ProcedureRow = {
  procedure_id: string;
  revision: number;
  condition_key: string;
  condition: string;
  criteria: string;
  severity: string;
  severity_meaning: string | null;
  immediate_actions_json: string;
  escalation_triggers_json: string;
  notifications_json: string;
  communication_guidance: string | null;
  required_documentation: string | null;
  tags_json: string;
  service_mode: string | null;
  affected_workflow: string | null;
  urgency: string | null;
  document_type: string;
  document_code: string;
  source_url: string | null;
  source_revision: string | null;
  owner: string | null;
  approver: string | null;
  approval_state: string;
  trust_state: string;
  effective_at: Date | null;
  next_review_at: Date | null;
  retired_at: Date | null;
  source_status: string;
  last_synced_at: Date | null;
  updated_at: Date;
};

function jsonArray(value: string | null): string[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function effectiveTrustState(row: ProcedureRow): string {
  if (row.approval_state === "Retired" || row.retired_at) return "Retired";
  if (row.source_status === "unavailable") return "Unavailable";
  if (row.source_status === "partial") return "Partial";
  if (row.approval_state !== "Approved") return "Preview";
  if (row.next_review_at && row.next_review_at.getTime() < Date.now()) return "Stale";
  return row.trust_state || "Approved";
}

function toProcedure(row: ProcedureRow) {
  return {
    procedure_id: row.procedure_id,
    revision: row.revision,
    condition_key: row.condition_key,
    condition: row.condition,
    criteria: row.criteria,
    severity: row.severity,
    severity_meaning: row.severity_meaning,
    immediate_actions: jsonArray(row.immediate_actions_json),
    escalation_triggers: jsonArray(row.escalation_triggers_json),
    notifications: jsonArray(row.notifications_json),
    communication_guidance: row.communication_guidance,
    required_documentation: row.required_documentation,
    tags: jsonArray(row.tags_json),
    service_mode: row.service_mode,
    affected_workflow: row.affected_workflow,
    urgency: row.urgency,
    document_type: row.document_type,
    document_code: row.document_code,
    source_url: row.source_url,
    source_revision: row.source_revision,
    owner: row.owner,
    approver: row.approver,
    approval_state: row.approval_state,
    trust_state: effectiveTrustState(row),
    effective_at: row.effective_at,
    next_review_at: row.next_review_at,
    retired_at: row.retired_at,
    source_status: row.source_status,
    last_synced_at: row.last_synced_at,
    updated_at: row.updated_at,
  };
}

app.http("decisionMatrix", {
  route: "decision-matrix",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, STAFF_READ_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };

    try {
      const pool = await getPool();
      const ready = await pool.request().query<{ ready: number }>(`
        SELECT CASE WHEN OBJECT_ID('dbo.DecisionMatrixProcedures', 'U') IS NULL THEN 0 ELSE 1 END AS ready
      `);
      if (ready.recordset[0]?.ready !== 1) {
        return { status: 200, jsonBody: { procedures: [], diagnostics: { table_ready: false, source: "unavailable" } } };
      }

      const includeHistory = request.query.get("include_history") === "true" &&
        auth.principal.roles.includes("OCC.Admin");
      const q = request.query.get("q")?.trim();
      const dbRequest = pool.request();
      if (q) dbRequest.input("q", sql.NVarChar, `%${q}%`);
      const result = await dbRequest.query<ProcedureRow>(`
        SELECT procedure_id, revision, condition_key, condition, criteria, severity,
               severity_meaning, immediate_actions_json, escalation_triggers_json,
               notifications_json, communication_guidance, required_documentation,
               tags_json, service_mode, affected_workflow, urgency, document_type,
               document_code, source_url, source_revision, owner, approver,
               approval_state, trust_state, effective_at, next_review_at, retired_at,
               source_status, last_synced_at, updated_at
        FROM DecisionMatrixProcedures
        WHERE (${includeHistory ? "1 = 1" : "approval_state = 'Approved' AND retired_at IS NULL"})
          ${q ? "AND (condition LIKE @q OR criteria LIKE @q OR document_code LIKE @q OR tags_json LIKE @q OR affected_workflow LIKE @q)" : ""}
        ORDER BY condition, revision DESC
      `);
      return {
        status: 200,
        jsonBody: {
          procedures: result.recordset.map(toProcedure),
          diagnostics: { table_ready: true, source: "governed", include_history: includeHistory },
        },
      };
    } catch (error) {
      context.error("GET /decision-matrix failed", error);
      return { status: 500, jsonBody: { error: "Decision Matrix content is temporarily unavailable." } };
    }
  },
});
