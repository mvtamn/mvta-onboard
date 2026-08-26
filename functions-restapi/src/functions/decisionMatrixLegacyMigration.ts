import { app, HttpRequest, type InvocationContext } from "@azure/functions";
import { ADMIN_ROLES, requireRole } from "../lib/auth";
import { getPool, sql } from "../lib/db";
import { createDecisionMatrixProcedureDraft } from "./decisionMatrixDrafts";

type LegacyCandidate = { procedure_id: string; revision: number; condition_key: string; condition: string; criteria: string; severity: string; severity_meaning: string | null; immediate_actions_json: string; document_type: string; document_code: string; source_url: string | null; source_revision: string | null; owner: string | null; effective_at: Date | null; next_review_at: Date | null };
const reviewedFieldNames = ["condition", "criteria", "immediate_actions", "severity", "owner", "dates", "primary_document"];

export async function listDecisionMatrixLegacyCandidates(request: HttpRequest, context: InvocationContext) {
  const auth = requireRole(request, ADMIN_ROLES);
  if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  try {
    const pool = await getPool();
    const result = await pool.request().query<LegacyCandidate & { mapping_outcome: string | null; governed_procedure_id: string | null; governed_revision: number | null }>(`
      SELECT l.procedure_id,l.revision,l.condition_key,l.condition,l.criteria,l.severity,l.severity_meaning,l.immediate_actions_json,l.document_type,l.document_code,l.source_url,l.source_revision,l.owner,l.effective_at,l.next_review_at,m.mapping_outcome,m.governed_procedure_id,m.governed_revision
      FROM DecisionMatrixProcedures l LEFT JOIN DecisionMatrixLegacyMigrations m ON m.legacy_procedure_id=l.procedure_id AND m.legacy_revision=l.revision
      ORDER BY l.condition,l.revision DESC`);
    return { status: 200, jsonBody: { candidates: result.recordset.map((candidate) => ({ ...candidate, migration: candidate.mapping_outcome ? { outcome: candidate.mapping_outcome, procedure_id: candidate.governed_procedure_id, revision: candidate.governed_revision } : null })) } };
  } catch (error) { context.error("Decision Matrix legacy candidate list failed", error); return { status: 500, jsonBody: { error: "Legacy Decision Matrix candidates are temporarily unavailable." } }; }
}

export async function migrateDecisionMatrixLegacyCandidate(request: HttpRequest, context: InvocationContext) {
  const auth = requireRole(request, ADMIN_ROLES);
  if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  const actor = auth.principal.userId;
  const procedureId = request.params.procedureId; const revision = Number(request.params.revision);
  if (!actor) return { status: 401, jsonBody: { error: "A stable Admin identity is required to map a legacy candidate." } };
  if (!procedureId || !Number.isInteger(revision)) return { status: 400, jsonBody: { error: "procedureId and integer revision are required." } };
  let body: { draft?: unknown; reviewed_fields?: unknown };
  try { body = await request.json() as typeof body; } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON." } }; }
  const reviewedFields = Array.isArray(body.reviewed_fields) && body.reviewed_fields.every((field): field is string => typeof field === "string") ? body.reviewed_fields : null;
  if (!body.draft || typeof body.draft !== "object" || !reviewedFields || !reviewedFieldNames.every((field) => reviewedFields.includes(field))) return { status: 400, jsonBody: { error: "An explicitly reviewed Draft and every migrated field are required." } };
  const pool = await getPool();
  const source = await pool.request().input("procedure_id", sql.NVarChar, procedureId).input("revision", sql.Int, revision).query<LegacyCandidate>("SELECT procedure_id,revision,condition_key,condition,criteria,severity,severity_meaning,immediate_actions_json,document_type,document_code,source_url,source_revision,owner,effective_at,next_review_at FROM DecisionMatrixProcedures WHERE procedure_id=@procedure_id AND revision=@revision");
  const candidate = source.recordset[0];
  if (!candidate) return { status: 404, jsonBody: { error: "Legacy Decision Matrix candidate not found." } };
  const reserve = await pool.request().input("legacy_procedure_id", sql.NVarChar, procedureId).input("legacy_revision", sql.Int, revision).input("snapshot", sql.NVarChar, JSON.stringify(candidate)).input("reviewed", sql.NVarChar, JSON.stringify(body.reviewed_fields)).input("actor", sql.NVarChar, actor).query("INSERT INTO DecisionMatrixLegacyMigrations(legacy_procedure_id,legacy_revision,source_snapshot_json,reviewed_fields_json,mapping_outcome,mapped_by) VALUES(@legacy_procedure_id,@legacy_revision,@snapshot,@reviewed,'converting',@actor)");
  if (reserve.rowsAffected[0] !== 1) return { status: 409, jsonBody: { error: "This legacy candidate is already being mapped or has been mapped." } };
  const draftRequest = new HttpRequest({ method: "POST", url: request.url, headers: { "content-type": "application/json", "x-ms-client-principal": request.headers.get("x-ms-client-principal") ?? "" }, body: { string: JSON.stringify(body.draft) } });
  const created = await createDecisionMatrixProcedureDraft(draftRequest, context);
  if (created.status !== 201) { await pool.request().input("procedure_id", sql.NVarChar, procedureId).input("revision", sql.Int, revision).query("DELETE FROM DecisionMatrixLegacyMigrations WHERE legacy_procedure_id=@procedure_id AND legacy_revision=@revision"); return created; }
  const result = created.jsonBody as { procedure_id: string; revision: number };
  await pool.request().input("legacy_procedure_id", sql.NVarChar, procedureId).input("legacy_revision", sql.Int, revision).input("governed_procedure_id", sql.NVarChar, result.procedure_id).input("governed_revision", sql.Int, result.revision).query("UPDATE DecisionMatrixLegacyMigrations SET governed_procedure_id=@governed_procedure_id,governed_revision=@governed_revision,mapping_outcome='mapped',mapped_at=SYSUTCDATETIME() WHERE legacy_procedure_id=@legacy_procedure_id AND legacy_revision=@legacy_revision");
  return { status: 201, jsonBody: { legacy_procedure_id: procedureId, legacy_revision: revision, procedure_id: result.procedure_id, revision: result.revision, lifecycle_state: "Draft" } };
}

app.http("decisionMatrixLegacyCandidates", { route: "admin/decision-matrix/legacy-candidates", methods: ["GET"], authLevel: "anonymous", handler: listDecisionMatrixLegacyCandidates });
app.http("decisionMatrixLegacyCandidateMigration", { route: "admin/decision-matrix/legacy-candidates/{procedureId}/{revision}/draft", methods: ["POST"], authLevel: "anonymous", handler: migrateDecisionMatrixLegacyCandidate });
