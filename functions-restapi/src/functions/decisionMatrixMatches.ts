import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { STAFF_READ_ROLES, requireRole } from "../lib/auth";
import { getPool, sql } from "../lib/db";

type ProcedureMatchRow = {
  procedure_id: string;
  revision: number;
  condition: string;
  condition_key: string;
  criteria: string;
  severity: string;
  severity_meaning: string | null;
  immediate_actions_json: string | null;
  tags_json: string | null;
  document_type: "SOP" | "REF";
  document_code: string;
  source_url: string | null;
  trust_state: string;
};

function jsonArray(value: string | null): string[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

app.http("decisionMatrixMatches", {
  route: "decision-matrix/matches",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, STAFF_READ_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const conditionKey = request.query.get("condition_key")?.trim();
    const q = request.query.get("q")?.trim();
    if (!conditionKey && !q) return { status: 400, jsonBody: { error: "condition_key or q is required" } };
    try {
      const pool = await getPool();
      const dbRequest = pool.request();
      if (conditionKey) dbRequest.input("condition_key", sql.NVarChar, conditionKey);
      if (q) dbRequest.input("q", sql.NVarChar, `%${q}%`);
      const result = await dbRequest.query<ProcedureMatchRow>(`
        SELECT TOP 20 procedure_id, revision, condition, condition_key, criteria,
               severity, severity_meaning, immediate_actions_json, tags_json,
               document_type, document_code, source_url, trust_state
        FROM DecisionMatrixProcedures
        WHERE approval_state = 'Approved' AND retired_at IS NULL
          AND (${conditionKey ? "condition_key = @condition_key" : "1 = 0"}
            OR ${q ? "condition LIKE @q OR criteria LIKE @q OR tags_json LIKE @q OR affected_workflow LIKE @q" : "1 = 0"})
        ORDER BY CASE WHEN ${conditionKey ? "condition_key = @condition_key" : "1 = 0"} THEN 0 ELSE 1 END, condition
      `);
      const rows = result.recordset as ProcedureMatchRow[];
      return {
        status: 200,
        jsonBody: {
          candidates: rows.map((row) => ({
            procedure_id: row.procedure_id,
            revision: row.revision,
            condition: row.condition,
            condition_key: row.condition_key,
            criteria: row.criteria,
            severity: row.severity,
            severity_meaning: row.severity_meaning,
            immediate_actions: jsonArray(row.immediate_actions_json),
            tags: jsonArray(row.tags_json),
            document_type: row.document_type,
            document_code: row.document_code,
            source_url: row.source_url,
            trust_state: row.trust_state,
            match_reason: conditionKey === row.condition_key ? "Exact condition key" : "Controlled metadata or keyword match",
          })),
          context: { source: request.query.get("source") ?? null, source_id: request.query.get("source_id") ?? null },
        },
      };
    } catch (error) {
      context.error("GET /decision-matrix/matches failed", error);
      return { status: 500, jsonBody: { error: "Procedure matching is temporarily unavailable." } };
    }
  },
});
