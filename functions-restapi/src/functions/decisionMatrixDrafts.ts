import { randomUUID } from "node:crypto";
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { requireAccess } from "../lib/access/require";
import { getPool, sql } from "../lib/db";
import type { LibraryItemReader } from "../lib/sharepointLibrary";
import { prepareSupportingDocumentReferences, ReferenceRefusal, type PreparedReferences } from "../lib/supportingDocumentReferences";
import { approvedLibraryItems } from "./decisionMatrixLibrary";

const SEVERITIES = new Set(["Stop service", "Restrict service", "Routine / no escalation"]);
const CRITERION_KINDS = new Set(["applies", "excludes"]);
const ACTION_KINDS = new Set(["required", "conditional", "informational"]);

type CriterionInput = { id?: string; kind: string; text: string };
type ActionInput = { id?: string; kind: string; instruction: string };
type DraftInput = {
  procedure_id?: string;
  condition_key?: string;
  condition?: string;
  severity?: string;
  severity_meaning?: string;
  owner_team?: string;
  owner_contact?: string | null;
  effective_at?: string;
  next_review_at?: string;
  tags?: string[];
  criteria?: CriterionInput[];
  immediate_actions?: ActionInput[];
  document_references?: unknown;
  concurrency_token?: string;
};

export function concurrencyToken(value: unknown): string | undefined {
  if (typeof value === "string") {
    if (/^0x[0-9A-F]+$/i.test(value)) return value;
    if (value.length === 8) return `0x${Buffer.from(value, "latin1").toString("hex").toUpperCase()}`;
    return undefined;
  }
  if (Buffer.isBuffer(value)) return `0x${value.toString("hex").toUpperCase()}`;
  return undefined;
}

function text(value: unknown, maximum: number, field: string, required = false): string | null {
  if (value === undefined || value === null || value === "") return required ? null : "";
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum) return null;
  return value.trim();
}

function optionalText(value: unknown, maximum: number, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  return text(value, maximum, field, true);
}

function date(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseDraft(value: unknown, requireIdentity: boolean): { input: Required<Pick<DraftInput, "criteria" | "immediate_actions">> & DraftInput; error?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { input: { criteria: [], immediate_actions: [] }, error: "Request body must be a JSON object." };
  const body = value as DraftInput;
  const criteria = body.criteria ?? [];
  const immediateActions = body.immediate_actions ?? [];
  if (!Array.isArray(criteria) || !Array.isArray(immediateActions)) {
    return { input: { criteria: [], immediate_actions: [] }, error: "criteria and immediate_actions must be arrays." };
  }
  if (requireIdentity && (!text(body.procedure_id, 100, "procedure_id", true) || !text(body.condition_key, 100, "condition_key", true) || !text(body.condition, 200, "condition", true))) {
    return { input: { criteria, immediate_actions: immediateActions }, error: "procedure_id, condition_key, and condition are required." };
  }
  if (body.severity !== undefined && !SEVERITIES.has(body.severity)) return { input: { criteria, immediate_actions: immediateActions }, error: "severity must be Stop service, Restrict service, or Routine / no escalation." };
  if (body.severity_meaning !== undefined && !text(body.severity_meaning, 300, "severity_meaning", true)) return { input: { criteria, immediate_actions: immediateActions }, error: "severity_meaning must be a non-empty value of 300 characters or fewer." };
  if (body.owner_team !== undefined && !text(body.owner_team, 200, "owner_team", true)) return { input: { criteria, immediate_actions: immediateActions }, error: "owner_team must be a non-empty value of 200 characters or fewer." };
  if (body.owner_contact !== undefined && body.owner_contact !== null && body.owner_contact !== "" && !text(body.owner_contact, 320, "owner_contact", true)) return { input: { criteria, immediate_actions: immediateActions }, error: "owner_contact must be 320 characters or fewer." };
  if (body.effective_at !== undefined && !date(body.effective_at)) return { input: { criteria, immediate_actions: immediateActions }, error: "effective_at must be an ISO date." };
  if (body.next_review_at !== undefined && !date(body.next_review_at)) return { input: { criteria, immediate_actions: immediateActions }, error: "next_review_at must be an ISO date." };
  if (body.tags !== undefined && (!Array.isArray(body.tags) || body.tags.some((tag) => !text(tag, 80, "tag", true)))) return { input: { criteria, immediate_actions: immediateActions }, error: "tags must be an array of non-empty values of 80 characters or fewer." };

  const seenCriteria = new Set<string>();
  for (const criterion of criteria) {
    if (!criterion || typeof criterion !== "object" || !CRITERION_KINDS.has(criterion.kind) || !text(criterion.text, 1000, "criterion text", true)) return { input: { criteria, immediate_actions: immediateActions }, error: "Each Criterion needs an applies/excludes kind and text." };
    if (criterion.id && (!/^[0-9a-f-]{36}$/i.test(criterion.id) || seenCriteria.has(criterion.id))) return { input: { criteria, immediate_actions: immediateActions }, error: "Criterion identities must be unique UUIDs." };
    if (criterion.id) seenCriteria.add(criterion.id);
  }
  const seenActions = new Set<string>();
  for (const action of immediateActions) {
    if (!action || typeof action !== "object" || !ACTION_KINDS.has(action.kind) || !text(action.instruction, 2000, "action instruction", true)) return { input: { criteria, immediate_actions: immediateActions }, error: "Each Immediate Action needs a required, conditional, or informational kind and instruction." };
    if (action.id && (!/^[0-9a-f-]{36}$/i.test(action.id) || seenActions.has(action.id))) return { input: { criteria, immediate_actions: immediateActions }, error: "Immediate Action identities must be unique UUIDs." };
    if (action.id) seenActions.add(action.id);
  }
  return { input: { ...body, criteria, immediate_actions: immediateActions } };
}

// Criteria and Immediate Actions are replaced wholesale. Supporting Document
// References are not: they are written by lib/supportingDocumentReferences.ts,
// which keeps a kept reference's document and health.
async function replaceDraftContent(transaction: sql.Transaction, procedureId: string, revision: number, input: Required<Pick<DraftInput, "criteria" | "immediate_actions">>) {
  const remove = transaction.request();
  remove.input("procedure_id", sql.NVarChar, procedureId);
  remove.input("revision", sql.Int, revision);
  await remove.query("DELETE FROM ProcedureCriteria WHERE procedure_id=@procedure_id AND revision=@revision; DELETE FROM ProcedureImmediateActions WHERE procedure_id=@procedure_id AND revision=@revision;");
  for (const [index, criterion] of input.criteria.entries()) {
    const insert = transaction.request();
    criterion.id ??= randomUUID();
    insert.input("id", sql.UniqueIdentifier, criterion.id);
    insert.input("procedure_id", sql.NVarChar, procedureId);
    insert.input("revision", sql.Int, revision);
    insert.input("sort_order", sql.Int, index + 1);
    insert.input("kind", sql.NVarChar, criterion.kind);
    insert.input("text", sql.NVarChar, criterion.text.trim());
    await insert.query("INSERT INTO ProcedureCriteria(criterion_id,procedure_id,revision,sort_order,criterion_kind,criterion_text) VALUES(@id,@procedure_id,@revision,@sort_order,@kind,@text)");
  }
  for (const [index, action] of input.immediate_actions.entries()) {
    const insert = transaction.request();
    action.id ??= randomUUID();
    insert.input("id", sql.UniqueIdentifier, action.id);
    insert.input("procedure_id", sql.NVarChar, procedureId);
    insert.input("revision", sql.Int, revision);
    insert.input("sort_order", sql.Int, index + 1);
    insert.input("kind", sql.NVarChar, action.kind);
    insert.input("instruction", sql.NVarChar, action.instruction.trim());
    await insert.query("INSERT INTO ProcedureImmediateActions(action_id,procedure_id,revision,sort_order,action_kind,instruction) VALUES(@id,@procedure_id,@revision,@sort_order,@kind,@instruction)");
  }
}

async function recordDraftAudit(transaction: sql.Transaction, procedureId: string, revision: number, actor: string, eventType: "draft_created" | "draft_saved" | "revision_cloned", details: Record<string, unknown> = {}) {
  const audit = transaction.request();
  audit.input("id", sql.UniqueIdentifier, randomUUID());
  audit.input("procedure_id", sql.NVarChar, procedureId);
  audit.input("revision", sql.Int, revision);
  audit.input("event_type", sql.NVarChar, eventType);
  audit.input("actor", sql.NVarChar, actor);
  audit.input("details", sql.NVarChar, JSON.stringify(details));
  await audit.query("IF OBJECT_ID('dbo.ProcedureAuditEvents', 'U') IS NOT NULL INSERT INTO ProcedureAuditEvents(event_id,procedure_id,revision,event_type,actor,details_json) VALUES(@id,@procedure_id,@revision,@event_type,@actor,@details)");
}

function refusalResponse(error: unknown) {
  return error instanceof ReferenceRefusal ? { status: error.status, jsonBody: { error: error.message } } : null;
}

// Only the Procedures table's own keys make a create a duplicate. Every other
// failure used to be answered "already exists" too, which sent an author to
// rename a Procedure that was not a duplicate.
function isDuplicateProcedure(error: unknown): boolean {
  const failure = error as { number?: unknown; message?: unknown } | null;
  return !!failure && (failure.number === 2627 || failure.number === 2601) && typeof failure.message === "string" && /object 'dbo\.Procedures'/.test(failure.message);
}

export async function createDecisionMatrixProcedureDraft(request: HttpRequest, context: InvocationContext, library: LibraryItemReader = approvedLibraryItems()) {
  const auth = await requireAccess(request, "decision-matrix.manage");
  if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  let body: unknown;
  try { body = await request.json(); } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON." } }; }
  const parsed = parseDraft(body, true);
  if (parsed.error) return { status: 400, jsonBody: { error: parsed.error } };
  const input = parsed.input;
  const procedureId = text(input.procedure_id, 100, "procedure_id", true)!;
  const conditionKey = text(input.condition_key, 100, "condition_key", true)!;
  const condition = text(input.condition, 200, "condition", true)!;
  const actor = auth.principal.userId;
  if (!actor) return { status: 401, jsonBody: { error: "A stable Admin identity is required to author a Procedure Draft." } };
  let references: PreparedReferences;
  try { references = await prepareSupportingDocumentReferences(input.document_references, library); } catch (error) { const refused = refusalResponse(error); if (refused) return refused; throw error; }
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin();
    const insertProcedure = transaction.request();
    insertProcedure.input("procedure_id", sql.NVarChar, procedureId);
    insertProcedure.input("condition_key", sql.NVarChar, conditionKey);
    insertProcedure.input("condition", sql.NVarChar, condition);
    insertProcedure.input("actor", sql.NVarChar, actor);
    await insertProcedure.query("INSERT INTO Procedures(procedure_id,condition_key,condition,created_by) VALUES(@procedure_id,@condition_key,@condition,@actor)");
    const insertRevision = transaction.request();
    insertRevision.input("procedure_id", sql.NVarChar, procedureId);
    insertRevision.input("actor", sql.NVarChar, actor);
    insertRevision.input("severity", sql.NVarChar, input.severity ?? null);
    insertRevision.input("severity_meaning", sql.NVarChar, input.severity_meaning ?? null);
    insertRevision.input("owner_team", sql.NVarChar, input.owner_team ?? null);
    insertRevision.input("owner_contact", sql.NVarChar, optionalText(input.owner_contact, 320, "owner_contact") ?? null);
    insertRevision.input("effective_at", sql.DateTime2, input.effective_at ? date(input.effective_at) : null);
    insertRevision.input("next_review_at", sql.DateTime2, input.next_review_at ? date(input.next_review_at) : null);
    insertRevision.input("tags_json", sql.NVarChar, JSON.stringify(input.tags ?? []));
    const created = await insertRevision.query<{ concurrency_token: string }>("INSERT INTO ProcedureRevisions(procedure_id,revision,severity,severity_meaning,owner_team,owner_contact,effective_at,next_review_at,tags_json,created_by,updated_by) OUTPUT CONVERT(varchar(34),INSERTED.row_version,1) AS concurrency_token VALUES(@procedure_id,1,@severity,@severity_meaning,@owner_team,@owner_contact,@effective_at,@next_review_at,@tags_json,@actor,@actor)");
    await replaceDraftContent(transaction, procedureId, 1, input);
    const written = await references.write(transaction, procedureId, 1);
    await recordDraftAudit(transaction, procedureId, 1, actor, "draft_created");
    await transaction.commit();
    return { status: 201, jsonBody: {
      procedure_id: procedureId,
      revision: 1,
      lifecycle_state: "Draft",
      concurrency_token: concurrencyToken(created.recordset[0]?.concurrency_token),
      tags: input.tags ?? [],
      criteria: input.criteria,
      immediate_actions: input.immediate_actions,
      document_references: written.map((reference) => ({ ...reference, health_status: "Needs review", checked_at: null })),
    } };
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    const refused = refusalResponse(error);
    if (refused) return refused;
    if (isDuplicateProcedure(error)) return { status: 409, jsonBody: { error: "Procedure identity or condition key already exists." } };
    context.error("Decision Matrix Draft creation failed", error);
    return { status: 500, jsonBody: { error: "Draft could not be created." } };
  }
}

export async function cloneDecisionMatrixProcedureDraft(request: HttpRequest, context: InvocationContext) {
  const auth = await requireAccess(request, "decision-matrix.manage");
  if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  const procedureId = request.params.procedureId;
  if (!procedureId) return { status: 400, jsonBody: { error: "procedureId is required." } };
  let body: { source_revision?: unknown };
  try { body = await request.json() as typeof body; } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON." } }; }
  const sourceRevision = Number(body.source_revision);
  if (!Number.isInteger(sourceRevision)) return { status: 400, jsonBody: { error: "source_revision must be an integer." } };
  const actor = auth.principal.userId;
  if (!actor) return { status: 401, jsonBody: { error: "A stable Admin identity is required to author a Procedure Draft." } };
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin();
    const next = transaction.request();
    next.input("procedure_id", sql.NVarChar, procedureId);
    const revisionResult = await next.query<{ revision: number }>("SELECT ISNULL(MAX(revision), 0) + 1 AS revision FROM ProcedureRevisions WITH (UPDLOCK,HOLDLOCK) WHERE procedure_id=@procedure_id");
    const revision = revisionResult.recordset[0]?.revision;
    if (!revision) {
      await transaction.rollback();
      return { status: 404, jsonBody: { error: "Procedure not found." } };
    }
    const copy = transaction.request();
    copy.input("procedure_id", sql.NVarChar, procedureId);
    copy.input("source_revision", sql.Int, sourceRevision);
    copy.input("revision", sql.Int, revision);
    copy.input("actor", sql.NVarChar, actor);
    const copied = await copy.query<{ concurrency_token: string }>("INSERT INTO ProcedureRevisions(procedure_id,revision,lifecycle_state,severity,severity_meaning,owner_team,owner_contact,effective_at,next_review_at,tags_json,created_by,updated_by) OUTPUT CONVERT(varchar(34),INSERTED.row_version,1) AS concurrency_token SELECT procedure_id,@revision,'Draft',severity,severity_meaning,owner_team,owner_contact,effective_at,next_review_at,tags_json,@actor,@actor FROM ProcedureRevisions WHERE procedure_id=@procedure_id AND revision=@source_revision");
    if (!copied.recordset[0]) {
      await transaction.rollback();
      return { status: 404, jsonBody: { error: "Source Procedure Revision not found." } };
    }
    const copyCriteria = transaction.request();
    copyCriteria.input("procedure_id", sql.NVarChar, procedureId);
    copyCriteria.input("source_revision", sql.Int, sourceRevision);
    copyCriteria.input("revision", sql.Int, revision);
    await copyCriteria.query("INSERT INTO ProcedureCriteria(criterion_id,procedure_id,revision,sort_order,criterion_kind,criterion_text) SELECT NEWID(),procedure_id,@revision,sort_order,criterion_kind,criterion_text FROM ProcedureCriteria WHERE procedure_id=@procedure_id AND revision=@source_revision");
    const copyActions = transaction.request();
    copyActions.input("procedure_id", sql.NVarChar, procedureId);
    copyActions.input("source_revision", sql.Int, sourceRevision);
    copyActions.input("revision", sql.Int, revision);
    await copyActions.query("INSERT INTO ProcedureImmediateActions(action_id,procedure_id,revision,sort_order,action_kind,instruction) SELECT NEWID(),procedure_id,@revision,sort_order,action_kind,instruction FROM ProcedureImmediateActions WHERE procedure_id=@procedure_id AND revision=@source_revision");
    const copyReferences = transaction.request();
    copyReferences.input("procedure_id", sql.NVarChar, procedureId);
    copyReferences.input("source_revision", sql.Int, sourceRevision);
    copyReferences.input("revision", sql.Int, revision);
    await copyReferences.query("INSERT INTO ProcedureDocumentReferences(reference_id,procedure_id,revision,sort_order,document_type,is_primary,document_code,site_id,drive_id,item_id,expected_version,expected_file_name,expected_mime_type,web_url) SELECT NEWID(),procedure_id,@revision,sort_order,document_type,is_primary,document_code,site_id,drive_id,item_id,expected_version,expected_file_name,expected_mime_type,web_url FROM ProcedureDocumentReferences WHERE procedure_id=@procedure_id AND revision=@source_revision");
    await recordDraftAudit(transaction, procedureId, revision, actor, "revision_cloned", { source_revision: sourceRevision });
    await transaction.commit();
    return { status: 201, jsonBody: { procedure_id: procedureId, revision, lifecycle_state: "Draft", concurrency_token: concurrencyToken(copied.recordset[0].concurrency_token), cloned_from_revision: sourceRevision } };
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    context.error("Decision Matrix Draft clone failed", error);
    return { status: 500, jsonBody: { error: "Procedure Revision could not be cloned." } };
  }
}

export async function saveDecisionMatrixProcedureDraft(request: HttpRequest, context: InvocationContext, library: LibraryItemReader = approvedLibraryItems()) {
  const auth = await requireAccess(request, "decision-matrix.manage");
  if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  const procedureId = request.params.procedureId;
  const revision = Number(request.params.revision);
  if (!procedureId || !Number.isInteger(revision)) return { status: 400, jsonBody: { error: "procedureId and integer revision are required." } };
  let body: unknown;
  try { body = await request.json(); } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON." } }; }
  const parsed = parseDraft(body, false);
  if (parsed.error) return { status: 400, jsonBody: { error: parsed.error } };
  const input = parsed.input;
  if (!text(input.concurrency_token, 34, "concurrency_token", true)) return { status: 400, jsonBody: { error: "concurrency_token is required to save a Draft." } };
  const actor = auth.principal.userId;
  if (!actor) return { status: 401, jsonBody: { error: "A stable Admin identity is required to author a Procedure Draft." } };
  let references: PreparedReferences;
  try { references = await prepareSupportingDocumentReferences(input.document_references, library); } catch (error) { const refused = refusalResponse(error); if (refused) return refused; throw error; }
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin();
    const update = transaction.request();
    update.input("procedure_id", sql.NVarChar, procedureId);
    update.input("revision", sql.Int, revision);
    update.input("concurrency_token", sql.NVarChar, input.concurrency_token);
    update.input("actor", sql.NVarChar, actor);
    update.input("severity", sql.NVarChar, input.severity ?? null);
    update.input("severity_meaning", sql.NVarChar, input.severity_meaning ?? null);
    update.input("owner_team", sql.NVarChar, input.owner_team ?? null);
    update.input("owner_contact", sql.NVarChar, optionalText(input.owner_contact, 320, "owner_contact") ?? null);
    update.input("effective_at", sql.DateTime2, input.effective_at ? date(input.effective_at) : null);
    update.input("next_review_at", sql.DateTime2, input.next_review_at ? date(input.next_review_at) : null);
    update.input("tags_json", sql.NVarChar, JSON.stringify(input.tags ?? []));
    const changed = await update.query<{ concurrency_token: string }>("UPDATE ProcedureRevisions SET severity=@severity,severity_meaning=@severity_meaning,owner_team=@owner_team,owner_contact=@owner_contact,effective_at=@effective_at,next_review_at=@next_review_at,tags_json=@tags_json,updated_by=@actor,updated_at=SYSUTCDATETIME() OUTPUT CONVERT(varchar(34),INSERTED.row_version,1) AS concurrency_token WHERE procedure_id=@procedure_id AND revision=@revision AND lifecycle_state='Draft' AND row_version=CONVERT(binary(8),@concurrency_token,1)");
    if (!changed.recordset[0]) {
      await transaction.rollback();
      return { status: 409, jsonBody: { error: "This Draft changed or is no longer editable. Refresh to compare the latest revision before saving again." } };
    }
    await replaceDraftContent(transaction, procedureId, revision, input);
    await references.write(transaction, procedureId, revision);
    await recordDraftAudit(transaction, procedureId, revision, actor, "draft_saved");
    await transaction.commit();
    return { status: 200, jsonBody: { procedure_id: procedureId, revision, lifecycle_state: "Draft", concurrency_token: concurrencyToken(changed.recordset[0].concurrency_token) } };
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    const refused = refusalResponse(error);
    if (refused) return refused;
    context.error("Decision Matrix Draft save failed", error);
    return { status: 500, jsonBody: { error: "Draft could not be saved." } };
  }
}

export async function getDecisionMatrixProcedureDraft(request: HttpRequest, context: InvocationContext) {
  const auth = await requireAccess(request, "decision-matrix.manage");
  if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  const procedureId = request.params.procedureId;
  const revision = Number(request.params.revision);
  if (!procedureId || !Number.isInteger(revision)) return { status: 400, jsonBody: { error: "procedureId and integer revision are required." } };
  try {
    const pool = await getPool();
    const revisionRequest = pool.request();
    revisionRequest.input("procedure_id", sql.NVarChar, procedureId);
    revisionRequest.input("revision", sql.Int, revision);
    const record = await revisionRequest.query<Record<string, unknown>>("SELECT p.procedure_id,p.condition_key,p.condition,r.revision,r.lifecycle_state,r.severity,r.severity_meaning,r.owner_team,r.owner_contact,r.effective_at,r.next_review_at,r.tags_json,CONVERT(varchar(34),r.row_version,1) AS concurrency_token FROM Procedures p JOIN ProcedureRevisions r ON r.procedure_id=p.procedure_id WHERE p.procedure_id=@procedure_id AND r.revision=@revision");
    if (!record.recordset[0]) return { status: 404, jsonBody: { error: "Procedure Draft not found." } };
    const contentRequest = () => {
      const content = pool.request();
      content.input("procedure_id", sql.NVarChar, procedureId);
      content.input("revision", sql.Int, revision);
      return content;
    };
    const [criteria, actions, references] = await Promise.all([
      contentRequest().query<{ criterion_id: string; criterion_kind: string; criterion_text: string }>("SELECT criterion_id,criterion_kind,criterion_text FROM ProcedureCriteria WHERE procedure_id=@procedure_id AND revision=@revision ORDER BY sort_order"),
      contentRequest().query<{ action_id: string; action_kind: string; instruction: string }>("SELECT action_id,action_kind,instruction FROM ProcedureImmediateActions WHERE procedure_id=@procedure_id AND revision=@revision ORDER BY sort_order"),
      contentRequest().query<{ reference_id: string; document_type: string; is_primary: boolean; document_code: string; site_id: string; drive_id: string; item_id: string; expected_version: string; expected_file_name: string; expected_mime_type: string; web_url: string; health_status: string; checked_at: Date | null }>("SELECT reference_id,document_type,is_primary,document_code,site_id,drive_id,item_id,expected_version,expected_file_name,expected_mime_type,web_url,health_status,checked_at FROM ProcedureDocumentReferences WHERE procedure_id=@procedure_id AND revision=@revision ORDER BY sort_order"),
    ]);
    return { status: 200, jsonBody: {
      ...record.recordset[0],
      // The same token create, save and clone return. Returned raw, a Draft
      // read and then saved failed its concurrency check with SQL 8114.
      concurrency_token: concurrencyToken(record.recordset[0]?.concurrency_token),
      tags: (() => { try { const value = JSON.parse(String(record.recordset[0]?.tags_json ?? "[]")); return Array.isArray(value) ? value : []; } catch { return []; } })(),
      criteria: criteria.recordset.map((row) => ({ id: row.criterion_id, kind: row.criterion_kind, text: row.criterion_text })),
      immediate_actions: actions.recordset.map((row) => ({ id: row.action_id, kind: row.action_kind, instruction: row.instruction })),
      document_references: references.recordset.map((row) => ({ id: row.reference_id, document_type: row.document_type, is_primary: row.is_primary, document_code: row.document_code, site_id: row.site_id, drive_id: row.drive_id, item_id: row.item_id, expected_version: row.expected_version, expected_file_name: row.expected_file_name, expected_mime_type: row.expected_mime_type, web_url: row.web_url, health_status: row.health_status, checked_at: row.checked_at })),
    } };
  } catch (error) {
    context.error("Decision Matrix Draft read failed", error);
    return { status: 500, jsonBody: { error: "Procedure Draft is temporarily unavailable." } };
  }
}

app.http("decisionMatrixProcedureDraftsCreate", { route: "manage/decision-matrix/procedures", methods: ["POST"], authLevel: "anonymous", handler: createDecisionMatrixProcedureDraft });
app.http("decisionMatrixProcedureDraftsClone", { route: "manage/decision-matrix/procedures/{procedureId}/revisions", methods: ["POST"], authLevel: "anonymous", handler: cloneDecisionMatrixProcedureDraft });
app.http("decisionMatrixProcedureDraftsGet", { route: "manage/decision-matrix/procedures/{procedureId}/revisions/{revision}", methods: ["GET"], authLevel: "anonymous", handler: getDecisionMatrixProcedureDraft });
app.http("decisionMatrixProcedureDraftsSave", { route: "manage/decision-matrix/procedures/{procedureId}/revisions/{revision}", methods: ["PUT"], authLevel: "anonymous", handler: saveDecisionMatrixProcedureDraft });
