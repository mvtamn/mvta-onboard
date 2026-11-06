import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { requireAccess, requireAnyAccess } from "../lib/access/require";
import { rangedPenaltyBoundsSql } from "../lib/assessment/rangedPenalty";
import { agreementScope } from "../lib/assessment/schemaScope";
import { getPool, sql } from "../lib/db";
import { attributeOccurrence, parseOccurrenceSource, recordOccurrence, resolveOccurrence, setAssessedAmount, type IntakeOutcome, type IntakeRefusal, type OccurrenceAttribution } from "../lib/occurrenceIntake";
import { isGuid, isServiceMonth, validateComplianceOccurrence } from "../lib/validation";

app.http("complianceOccurrencesList", { route:"compliance-occurrences",methods:["GET"],authLevel:"anonymous",handler:async(request:HttpRequest,context:InvocationContext)=>{
  const auth=await requireAccess(request,"compliance-review.view");if(!auth.authorized)return{status:auth.status,jsonBody:{error:auth.message}};
  try{const pool=await getPool();const check=await pool.request().query<{ready:number}>(`SELECT CASE WHEN OBJECT_ID('dbo.ComplianceOccurrences','U') IS NULL THEN 0 ELSE 1 END ready`);if(!check.recordset[0]?.ready)return{status:200,jsonBody:{occurrences:[],diagnostics:{table_ready:false}}};const scope=await agreementScope(pool);const q=pool.request();const contractor=request.query.get("contractor_id"),month=request.query.get("service_month"),status=request.query.get("review_status");const limit=Math.min(2000,Math.max(1,Number(request.query.get("limit")??500)||500)),offset=Math.max(0,Number(request.query.get("offset")??0)||0);q.input("contractor",sql.UniqueIdentifier,isGuid(contractor)?contractor:null);q.input("month",sql.Char(6),isServiceMonth(month)?month:null);q.input("status",sql.NVarChar(20),["candidate","confirmed","dismissed"].includes(String(status))?status:null);q.input("limit",sql.Int,limit);q.input("offset",sql.Int,offset);const result=await q.query(`SELECT o.*,s.code standard_code,s.name standard_name,c.name contractor_name,bounds.penalty_amount_min,bounds.penalty_amount_max FROM ComplianceOccurrences o JOIN ContractorPerformanceStandards s ON s.id=o.standard_id JOIN Contractors c ON c.id=o.contractor_id ${rangedPenaltyBoundsSql("o",scope.scoped)} WHERE (@contractor IS NULL OR o.contractor_id=@contractor) AND (@month IS NULL OR o.service_month=@month) AND (@status IS NULL OR o.review_status=@status) ORDER BY o.service_date DESC,o.created_at DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`);return{status:200,jsonBody:{occurrences:result.recordset.map(o=>({...o,observation:parseOccurrenceSource(o.source_ref)})),diagnostics:{table_ready:true}}};}
  catch(error){context.error("GET compliance occurrences failed",error);return{status:500,jsonBody:{error:"Internal server error"}};}
}});

// Every write goes through the occurrence intake module, which assigns the
// contractor from the Agreement, refuses a finalized or issued month, and
// tells the month its input changed. A refusal is a 409 carrying the module's
// code and sentence; a missing occurrence is a 404.
function refused(refusal: IntakeRefusal) {
  const status = refusal.code === "not_found" ? 404 : refusal.code === "attribution_authority" ? 403 : 409;
  return { status, jsonBody: { error: refusal.sentence, code: refusal.code } };
}

type Handler = (request: HttpRequest, context: InvocationContext) => Promise<{ status: number; jsonBody: unknown }>;

async function inTransaction(write: (tx: sql.Transaction) => Promise<IntakeOutcome>, onOk: (outcome: Extract<IntakeOutcome, { ok: true }>) => { status: number; jsonBody: unknown }, context: InvocationContext, label: string) {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    const outcome = await write(tx);
    if (!outcome.ok) { await tx.rollback(); return refused(outcome.refusal); }
    await tx.commit();
    return onOk(outcome);
  } catch (error) {
    try { await tx.rollback(); } catch { /* the transaction is already resolved */ }
    context.error(`${label} failed`, error);
    return { status: 500, jsonBody: { error: "Internal server error" } };
  }
}

async function jsonBody(request: HttpRequest): Promise<Record<string, unknown> | null> {
  try { return await request.json() as Record<string, unknown>; } catch { return null; }
}

const actorOf = (auth: { principal: { userDetails?: string | null } }) => auth.principal.userDetails ?? "onboard-console";

const create: Handler = async (request, context) => {
  const auth = await requireAccess(request, "compliance-review.review");
  if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  const body = await jsonBody(request);
  if (!body) return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
  const errors = validateComplianceOccurrence(body);
  if (errors.length) return { status: 400, jsonBody: { error: "Validation failed", details: errors } };
  // Entering one is recording that it happened. Charging it is attribution,
  // so it is entered as contractor error only by someone who may attribute;
  // anyone else enters a candidate a manager then attributes (plan step 0.8).
  const attributed = auth.access.actions.includes("compliance-review.attribute");
  return inTransaction(tx => recordOccurrence(tx, {
    kind: "manual",
    attributed,
    standardId: String(body.standard_id),
    serviceDate: String(body.service_date),
    quantity: typeof body.quantity === "number" ? body.quantity : 1,
    durationDays: typeof body.duration_days === "number" ? body.duration_days : null,
    qualifierCode: typeof body.qualifier_code === "string" ? body.qualifier_code : null,
    description: String(body.description).trim(),
    contractorId: isGuid(body.contractor_id) ? body.contractor_id : null,
  }, actorOf(auth)), outcome => ({ status: 201, jsonBody: { id: outcome.occurrence.id, contractor_id: outcome.occurrence.contractorId } }), context, "POST compliance occurrence");
};

// The three authorities over an occurrence (plan step 0.8, ADR 0048):
//   PATCH .../{id}             - compliance-review.review: whether it happened
//                                (dismiss or reopen) and its relief link.
//   PUT   .../{id}/attribution - compliance-review.attribute: contractor error
//                                or MVTA-directed; compliance-review.excuse:
//                                excusable. The module decides which a change
//                                needs, so excusable is never a manager's.
const REVIEW_STATUSES = ["candidate", "dismissed"] as const;
const ATTRIBUTIONS: readonly OccurrenceAttribution[] = ["contractor_error", "excusable", "mvta_directed", "undetermined"];

const resolve: Handler = async (request, context) => {
  const auth = await requireAccess(request, "compliance-review.review");
  if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  if (!isGuid(request.params.id)) return { status: 400, jsonBody: { error: "Invalid occurrence id" } };
  const body = await jsonBody(request);
  if (!body) return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
  // Attribution moved to its own endpoint and authority. An older console
  // still sends it; refusing it says so rather than dropping it silently.
  if (body.attribution !== undefined) {
    return { status: 400, jsonBody: { error: "attribution is recorded with PUT /compliance-occurrences/{id}/attribution, by a manager (or the COO for excusable)" } };
  }
  const status = body.review_status === undefined ? undefined : REVIEW_STATUSES.find(v => v === body.review_status);
  if (body.review_status !== undefined && !status) {
    return { status: 400, jsonBody: { error: "review_status must be candidate or dismissed. Confirming one is attributing it to the contractor." } };
  }
  if (body.relief_id !== undefined && body.relief_id !== null && !isGuid(body.relief_id)) return { status: 400, jsonBody: { error: "relief_id must be a claim id or null" } };
  if (status === undefined && body.relief_id === undefined) return { status: 400, jsonBody: { error: "Give review_status, relief_id, or both" } };
  const id = request.params.id;
  return inTransaction(tx => resolveOccurrence(tx, id, {
    reviewStatus: status,
    dismissReason: typeof body.dismiss_reason === "string" ? body.dismiss_reason : null,
    reliefId: body.relief_id === undefined ? undefined : (body.relief_id as string | null),
  }, actorOf(auth)), () => ({ status: 200, jsonBody: { id } }), context, "PATCH compliance occurrence");
};

const attribute: Handler = async (request, context) => {
  const auth = await requireAnyAccess(request, ["compliance-review.attribute", "compliance-review.excuse"]);
  if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  if (!isGuid(request.params.id)) return { status: 400, jsonBody: { error: "Invalid occurrence id" } };
  const body = await jsonBody(request);
  if (!body) return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
  const attribution = ATTRIBUTIONS.find(v => v === body.attribution);
  if (!attribution) return { status: 400, jsonBody: { error: `attribution must be one of: ${ATTRIBUTIONS.join(", ")}` } };
  const held = {
    attribute: auth.access.actions.includes("compliance-review.attribute"),
    excuse: auth.access.actions.includes("compliance-review.excuse"),
  };
  const id = request.params.id;
  return inTransaction(tx => attributeOccurrence(tx, id, attribution, held, actorOf(auth)), () => ({ status: 200, jsonBody: { id, attribution } }), context, "PUT compliance occurrence attribution");
};

app.http("complianceOccurrencesCreate", { route: "compliance-occurrences", methods: ["POST"], authLevel: "anonymous", handler: create });
app.http("complianceOccurrencePatch", { route: "compliance-occurrences/{id}", methods: ["PATCH"], authLevel: "anonymous", handler: resolve });
app.http("complianceOccurrenceAttribution", { route: "compliance-occurrences/{id}/attribution", methods: ["PUT"], authLevel: "anonymous", handler: attribute });

// A reviewer's figure for one occurrence on a ranged band.
//
// Some penalties are stated as a range rather than a number - damage
// reimbursement runs $2,500-$10,000 - so the contract sets the bounds and a
// person sets the figure on the facts. It is a judgement, so it is recorded
// with who made it and why, and the month cannot read as complete while any
// confirmed occurrence on a ranged band is still waiting for one. A figure
// outside the contract's bounds is refused while the reviewer is looking at
// it, not at month-end close.
app.http("complianceOccurrenceAmount", {
  route: "compliance-occurrences/{id}/assessed-amount", methods: ["PUT"], authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = await requireAccess(request, "compliance-review.review");
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    if (!isGuid(request.params.id)) return { status: 400, jsonBody: { error: "Invalid occurrence id" } };
    const body = await jsonBody(request);
    if (!body) return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
    const clearing = body.assessed_amount === null;
    if (!clearing && (typeof body.assessed_amount !== "number" || !Number.isFinite(body.assessed_amount) || body.assessed_amount < 0)) {
      return { status: 400, jsonBody: { error: "assessed_amount must be a non-negative number, or null to clear it" } };
    }
    if (!clearing && (typeof body.note !== "string" || !body.note.trim() || body.note.length > 1000)) {
      return { status: 400, jsonBody: { error: "note is required and must be at most 1000 characters — the figure is a judgement, so say what it rests on" } };
    }

    const pool = await getPool();
    const ready = await pool.request().query<{ ready: number }>(
      `SELECT CASE WHEN COL_LENGTH('dbo.ComplianceOccurrences','assessed_amount') IS NULL THEN 0 ELSE 1 END ready`);
    if (!ready.recordset[0]?.ready) return { status: 409, jsonBody: { error: "Migration 107 has not been applied to this database yet" } };

    const id = request.params.id;
    const amount = clearing ? null : { amount: body.assessed_amount as number, note: String(body.note).trim() };
    return inTransaction(tx => setAssessedAmount(tx, id, amount, actorOf(auth)), () => ({ status: 200, jsonBody: { id } }), context, "PUT compliance occurrence assessed amount");
  },
});
