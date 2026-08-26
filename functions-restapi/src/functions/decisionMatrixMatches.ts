import { randomUUID } from "node:crypto";
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { ADMIN_ROLES, DECISION_MATRIX_READ_ROLES, requireRole } from "../lib/auth";
import { getPool, sql } from "../lib/db";

const SOURCES = new Set(["SuggestedAlert", "ServiceRisk"]);
type MatchRuleInput = { source_type?: unknown; source_qualifier?: unknown; procedure_id?: unknown; priority?: unknown; explanation?: unknown; is_active?: unknown };

function boundedText(value: unknown, maximum: number): string | null { return typeof value === "string" && value.trim() && value.trim().length <= maximum ? value.trim() : null; }
function parseRule(value: unknown, partial = false): { input?: { source_type?: string; source_qualifier?: string; procedure_id?: string; priority?: number; explanation?: string; is_active?: boolean }; error?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "Request body must be a JSON object." };
  const body = value as MatchRuleInput;
  const sourceType = body.source_type === undefined && partial ? undefined : boundedText(body.source_type, 30);
  const qualifier = body.source_qualifier === undefined && partial ? undefined : boundedText(body.source_qualifier, 200);
  const procedureId = body.procedure_id === undefined && partial ? undefined : boundedText(body.procedure_id, 100);
  const priority = body.priority === undefined && partial ? undefined : Number(body.priority);
  const explanation = body.explanation === undefined && partial ? undefined : boundedText(body.explanation, 1000);
  const isActive = body.is_active === undefined && partial ? undefined : body.is_active;
  if (sourceType !== undefined && (!sourceType || !SOURCES.has(sourceType))) return { error: "source_type must be SuggestedAlert or ServiceRisk." };
  if ((sourceType === null) || (qualifier === null) || (procedureId === null) || (explanation === null) || (priority !== undefined && (!Number.isInteger(priority) || priority < 1)) || (isActive !== undefined && typeof isActive !== "boolean")) return { error: "A Match Rule needs bounded source, qualifier, Procedure, positive priority, explanation, and optional boolean is_active." };
  if (partial && ![sourceType, qualifier, procedureId, priority, explanation, isActive].some((value) => value !== undefined)) return { error: "Provide at least one Match Rule field to update." };
  return { input: { source_type: sourceType, source_qualifier: qualifier, procedure_id: procedureId, priority, explanation, is_active: isActive as boolean | undefined } };
}

function stableAdmin(request: HttpRequest) {
  const auth = requireRole(request, ADMIN_ROLES);
  if (!auth.authorized) return auth;
  if (!auth.principal.userId) return { authorized: false as const, status: 401, message: "A stable Admin identity is required to manage Match Rules." };
  return auth;
}

export async function listDecisionMatrixMatchRules(request: HttpRequest, context: InvocationContext) {
  const auth = stableAdmin(request); if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  try {
    const pool = await getPool();
    const result = await pool.request().query("SELECT match_rule_id,source_type,source_qualifier,procedure_id,priority,explanation,is_active,created_at,created_by,updated_at,updated_by FROM ProcedureMatchRules ORDER BY source_type,source_qualifier,priority");
    return { status: 200, jsonBody: { match_rules: result.recordset } };
  } catch (error) { context.error("GET Decision Matrix Match Rules failed", error); return { status: 500, jsonBody: { error: "Decision Matrix Match Rules are temporarily unavailable." } }; }
}

export async function createDecisionMatrixMatchRule(request: HttpRequest, context: InvocationContext) {
  const auth = stableAdmin(request); if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  let body: unknown; try { body = await request.json(); } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON." } }; }
  const parsed = parseRule(body); if (parsed.error || !parsed.input) return { status: 400, jsonBody: { error: parsed.error } };
  const input = parsed.input; const id = randomUUID();
  try {
    const pool = await getPool(); const insert = pool.request();
    insert.input("id", sql.UniqueIdentifier, id).input("source_type", sql.NVarChar, input.source_type).input("source_qualifier", sql.NVarChar, input.source_qualifier).input("procedure_id", sql.NVarChar, input.procedure_id).input("priority", sql.Int, input.priority).input("explanation", sql.NVarChar, input.explanation).input("is_active", sql.Bit, input.is_active === false ? 0 : 1).input("actor", sql.NVarChar, auth.principal.userId);
    await insert.query("INSERT INTO ProcedureMatchRules(match_rule_id,source_type,source_qualifier,procedure_id,priority,explanation,is_active,created_by,updated_by) VALUES(@id,@source_type,@source_qualifier,@procedure_id,@priority,@explanation,@is_active,@actor,@actor)");
    return { status: 201, jsonBody: { match_rule_id: id, ...input, is_active: input.is_active !== false } };
  } catch (error) { context.error("POST Decision Matrix Match Rule failed", error); return { status: 409, jsonBody: { error: "Match Rule conflicts with an existing source-qualified priority or Procedure." } }; }
}

export async function updateDecisionMatrixMatchRule(request: HttpRequest, context: InvocationContext) {
  const auth = stableAdmin(request); if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  const id = request.params.matchRuleId; if (!id) return { status: 400, jsonBody: { error: "matchRuleId is required." } };
  let body: unknown; try { body = await request.json(); } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON." } }; }
  const parsed = parseRule(body, true); if (parsed.error || !parsed.input) return { status: 400, jsonBody: { error: parsed.error } };
  try {
    const pool = await getPool(); const update = pool.request(); const input = parsed.input;
    update.input("id", sql.UniqueIdentifier, id).input("source_type", sql.NVarChar, input.source_type ?? null).input("source_qualifier", sql.NVarChar, input.source_qualifier ?? null).input("procedure_id", sql.NVarChar, input.procedure_id ?? null).input("priority", sql.Int, input.priority ?? null).input("explanation", sql.NVarChar, input.explanation ?? null).input("is_active", sql.Bit, input.is_active === undefined ? null : input.is_active ? 1 : 0).input("actor", sql.NVarChar, auth.principal.userId);
    const result = await update.query("UPDATE ProcedureMatchRules SET source_type=COALESCE(@source_type,source_type),source_qualifier=COALESCE(@source_qualifier,source_qualifier),procedure_id=COALESCE(@procedure_id,procedure_id),priority=COALESCE(@priority,priority),explanation=COALESCE(@explanation,explanation),is_active=COALESCE(@is_active,is_active),updated_at=SYSUTCDATETIME(),updated_by=@actor OUTPUT INSERTED.match_rule_id,INSERTED.source_type,INSERTED.source_qualifier,INSERTED.procedure_id,INSERTED.priority,INSERTED.explanation,INSERTED.is_active WHERE match_rule_id=@id");
    if (!result.recordset[0]) return { status: 404, jsonBody: { error: "Match Rule not found." } };
    return { status: 200, jsonBody: result.recordset[0] };
  } catch (error) { context.error("PUT Decision Matrix Match Rule failed", error); return { status: 409, jsonBody: { error: "Match Rule conflicts with an existing source-qualified priority or Procedure." } }; }
}

export async function listDecisionMatrixRecommendations(request: HttpRequest, context: InvocationContext) {
  const auth = requireRole(request, DECISION_MATRIX_READ_ROLES); if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  const sourceType = request.query.get("source_type")?.trim(); const qualifier = request.query.get("source_qualifier")?.trim();
  if (!sourceType || !SOURCES.has(sourceType) || !qualifier || qualifier.length > 200) return { status: 400, jsonBody: { error: "A supported source_type and source_qualifier are required." } };
  try {
    const pool = await getPool(); const select = pool.request(); select.input("source_type", sql.NVarChar, sourceType).input("source_qualifier", sql.NVarChar, qualifier);
    const result = await select.query(`SELECT m.match_rule_id,m.source_type,m.source_qualifier,m.priority,m.explanation,p.procedure_id,p.condition_key,p.condition,r.revision,r.severity,r.severity_meaning,r.owner_team,r.effective_at,r.next_review_at FROM ProcedureMatchRules m JOIN Procedures p ON p.procedure_id=m.procedure_id JOIN ProcedureRevisions r ON r.procedure_id=p.procedure_id WHERE m.source_type=@source_type AND m.source_qualifier=@source_qualifier AND m.is_active=1 AND r.lifecycle_state='Approved' ORDER BY m.priority,p.condition`);
    return { status: 200, jsonBody: { source_type: sourceType, source_qualifier: qualifier, recommendations: result.recordset } };
  } catch (error) { context.error("GET Decision Matrix recommendations failed", error); return { status: 500, jsonBody: { error: "Decision Matrix recommendations are temporarily unavailable." } }; }
}

app.http("decisionMatrixMatchRules", { route: "admin/decision-matrix/match-rules", methods: ["GET"], authLevel: "anonymous", handler: listDecisionMatrixMatchRules });
app.http("decisionMatrixMatchRulesCreate", { route: "admin/decision-matrix/match-rules", methods: ["POST"], authLevel: "anonymous", handler: createDecisionMatrixMatchRule });
app.http("decisionMatrixMatchRulesUpdate", { route: "admin/decision-matrix/match-rules/{matchRuleId}", methods: ["PUT"], authLevel: "anonymous", handler: updateDecisionMatrixMatchRule });
app.http("decisionMatrixRecommendations", { route: "decision-matrix/recommendations", methods: ["GET"], authLevel: "anonymous", handler: listDecisionMatrixRecommendations });
