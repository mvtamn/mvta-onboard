// POST a QRG, get back a Draft seeded from it.
//
// The work is in qrgDraftSeed.ts; this is the handler around it. It reserves
// the seeding, creates the Draft through the one existing Draft-creation path,
// and records what was proposed - mirroring how decisionMatrixLegacyMigration
// maps a legacy candidate, including compensating when the Draft is refused.
// Going through createDecisionMatrixProcedureDraft rather than writing rows
// here is the point: a seeded Draft is validated, audited and governed exactly
// as a hand-typed one, which is what makes ADR 0044 sit beside ADR 0024.
import { randomUUID } from "node:crypto";
import { app, HttpRequest, type InvocationContext } from "@azure/functions";
import { requireAccess } from "../lib/access/require";
import { getPool, sql } from "../lib/db";
import { DECISION_MATRIX_SURFACES, surfaceReady } from "../lib/decisionMatrixReadiness";
import { seedDraftFromQrg, SeedRefusal, type GuidanceProposer, type QrgSource, type SeedingRecord } from "../lib/qrgDraftSeed";
import { anthropicGuidanceProposer } from "../lib/qrgGuidanceProposer";
import { libraryQrgSource } from "../lib/qrgLibrarySource";
import { createDecisionMatrixProcedureDraft } from "./decisionMatrixDrafts";
import { approvedLibrary } from "./decisionMatrixLibrary";

const DOCUMENT_CODE_LIMIT = 100;
const PRIMARY_TYPES = new Set(["SOP", "Reference"]);

type ChosenBody = { item_id?: unknown; seen_version?: unknown; document_code?: unknown; document_type?: unknown };
type SeedBody = { procedure_id?: unknown; condition_key?: unknown; condition?: unknown; qrg?: unknown; primary?: unknown };

function text(value: unknown, limit: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= limit ? trimmed : null;
}

/** The chosen document, or which field is wrong - named, so the console can
 *  say which of the two pickers needs attention. */
function chosen(value: unknown, label: string): { item_id: string; seen_version: string; document_code: string } | { error: string } {
  if (!value || typeof value !== "object") return { error: `${label} must be an object.` };
  const body = value as ChosenBody;
  const itemId = text(body.item_id, 200);
  const seenVersion = text(body.seen_version, 200);
  const documentCode = text(body.document_code, DOCUMENT_CODE_LIMIT);
  if (!itemId) return { error: `${label} needs the document you chose.` };
  if (!seenVersion) return { error: `${label} needs the version the picker showed.` };
  if (!documentCode) return { error: `${label} needs a document code of ${DOCUMENT_CODE_LIMIT} characters or fewer.` };
  return { item_id: itemId, seen_version: seenVersion, document_code: documentCode };
}

export async function seedDecisionMatrixDraftFromQrg(
  request: HttpRequest,
  context: InvocationContext,
  // Both seams are injected so the handler's own behaviour - reservation,
  // compensation, what it answers - is testable without SharePoint or a model.
  source?: QrgSource,
  proposer: GuidanceProposer = anthropicGuidanceProposer(),
) {
  const auth = await requireAccess(request, "decision-matrix.manage");
  if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  const actor = auth.principal.userId;
  if (!actor) return { status: 401, jsonBody: { error: "A stable Admin identity is required to seed a Procedure Draft." } };

  let body: SeedBody;
  try { body = await request.json() as SeedBody; } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON." } }; }

  const procedureId = text(body.procedure_id, 100);
  const conditionKey = text(body.condition_key, 100);
  const condition = text(body.condition, 200);
  if (!procedureId || !conditionKey || !condition) {
    return { status: 400, jsonBody: { error: "procedure_id, condition_key, and condition are required." } };
  }
  const qrg = chosen(body.qrg, "The QRG");
  if ("error" in qrg) return { status: 400, jsonBody: { error: qrg.error } };
  const primary = chosen(body.primary, "The governing document");
  if ("error" in primary) return { status: 400, jsonBody: { error: primary.error } };
  const primaryType = typeof (body.primary as ChosenBody).document_type === "string" ? (body.primary as ChosenBody).document_type as string : "";
  if (!PRIMARY_TYPES.has(primaryType)) {
    // Said here rather than discovered at review: only an SOP or Reference can
    // be the primary Supporting Document Reference, and a Draft without one
    // cannot be submitted.
    return { status: 400, jsonBody: { error: "The governing document must be an SOP or a Reference, because a QRG cannot be a Procedure's primary document." } };
  }

  const pool = await getPool();
  const surface = DECISION_MATRIX_SURFACES.qrgSeeding;
  if (!(await surfaceReady(pool, surface))) {
    return { status: 503, jsonBody: { error: `Seeding a Draft from a QRG needs migration ${surface.migration}.`, diagnostics: { required_migration: surface.migration } } };
  }

  const already = await pool.request()
    .input("item_id", sql.NVarChar, qrg.item_id)
    .input("seen_version", sql.NVarChar, qrg.seen_version)
    .query<{ procedure_id: string; revision: number }>(
      "SELECT procedure_id,revision FROM DecisionMatrixQrgSeedings WHERE item_id=@item_id AND seen_version=@seen_version",
    );
  if (already.recordset[0]) {
    return { status: 409, jsonBody: { error: "This version of that QRG has already seeded a Draft.", seeded: already.recordset[0] } };
  }

  // The library is read as the sign-in application, the same identity that
  // let the author browse to this QRG in the first place.
  let qrgSource = source;
  if (!qrgSource) {
    const approved = approvedLibrary();
    if (!("library" in approved)) return { status: 409, jsonBody: { error: approved.reason } };
    qrgSource = libraryQrgSource(approved.library);
  }

  let seeded;
  try {
    seeded = await seedDraftFromQrg(
      { procedure_id: procedureId, condition_key: conditionKey, condition, qrg, primary: { ...primary, document_type: primaryType as "SOP" | "Reference" } },
      qrgSource,
      proposer,
    );
  } catch (error) {
    if (error instanceof SeedRefusal) return { status: error.status, jsonBody: { error: error.message } };
    context.error("Seeding a Decision Matrix Draft from a QRG failed", error);
    return { status: 500, jsonBody: { error: "The QRG could not be read." } };
  }

  // Reserve before creating, so two authors racing on the same QRG cannot both
  // get a Draft: the unique index on (drive_id, item_id, seen_version) decides
  // the race that the SELECT above cannot.
  const seedingId = randomUUID();
  const site = approvedLibrarySite();
  try {
    await insertSeeding(pool, seedingId, { procedureId, revision: 1, actor, site, record: seeded.seeding });
  } catch {
    return { status: 409, jsonBody: { error: "This version of that QRG has already seeded a Draft." } };
  }

  const draftRequest = new HttpRequest({
    method: "POST",
    url: request.url,
    headers: { "content-type": "application/json", "x-ms-client-principal": request.headers.get("x-ms-client-principal") ?? "" },
    body: { string: JSON.stringify(seeded.draft) },
  });
  const created = await createDecisionMatrixProcedureDraft(draftRequest, context);
  if (created.status !== 201) {
    await pool.request().input("seeding_id", sql.UniqueIdentifier, seedingId)
      .query("DELETE FROM DecisionMatrixQrgSeedings WHERE seeding_id=@seeding_id").catch(() => undefined);
    return created;
  }
  const result = created.jsonBody as { procedure_id: string; revision: number };

  // The Draft creation path assigns the revision, so the reservation is
  // corrected to what was actually created rather than assumed.
  await pool.request()
    .input("seeding_id", sql.UniqueIdentifier, seedingId)
    .input("procedure_id", sql.NVarChar, result.procedure_id)
    .input("revision", sql.Int, result.revision)
    .query("UPDATE DecisionMatrixQrgSeedings SET procedure_id=@procedure_id,revision=@revision WHERE seeding_id=@seeding_id")
    .catch((error: unknown) => { context.error("Recording which Draft a QRG seeded failed", error); });

  return {
    status: 201,
    jsonBody: {
      procedure_id: result.procedure_id,
      revision: result.revision,
      lifecycle_state: "Draft",
      // The author needs to know whether they are reviewing proposed guidance
      // or filling in an empty Draft, and why if it is empty.
      seeded_from: {
        name: seeded.seeding.qrg_name,
        outcome: seeded.seeding.outcome,
        reason: seeded.seeding.outcome_reason,
        pages_read: seeded.seeding.pages_read,
        criteria: seeded.draft.criteria.length,
        immediate_actions: seeded.draft.immediate_actions.length,
      },
      reviewed: false,
    },
  };
}

function approvedLibrarySite(): { site_id: string; drive_id: string } {
  const approved = approvedLibrary();
  return { site_id: approved.config?.site_id ?? "", drive_id: approved.config?.drive_id ?? "" };
}

async function insertSeeding(
  pool: sql.ConnectionPool,
  seedingId: string,
  args: { procedureId: string; revision: number; actor: string; site: { site_id: string; drive_id: string }; record: SeedingRecord },
) {
  await pool.request()
    .input("seeding_id", sql.UniqueIdentifier, seedingId)
    .input("procedure_id", sql.NVarChar, args.procedureId)
    .input("revision", sql.Int, args.revision)
    .input("site_id", sql.NVarChar, args.site.site_id)
    .input("drive_id", sql.NVarChar, args.site.drive_id)
    .input("item_id", sql.NVarChar, args.record.item_id)
    .input("seen_version", sql.NVarChar, args.record.seen_version)
    .input("qrg_name", sql.NVarChar, args.record.qrg_name)
    .input("qrg_mime", sql.NVarChar, args.record.qrg_mime)
    .input("pages_read", sql.Int, args.record.pages_read)
    .input("outcome", sql.NVarChar, args.record.outcome)
    .input("outcome_reason", sql.NVarChar, args.record.outcome_reason)
    .input("proposed_json", sql.NVarChar, args.record.proposed_json)
    .input("model", sql.NVarChar, args.record.model)
    .input("seeded_by", sql.NVarChar, args.actor)
    .query(`INSERT INTO DecisionMatrixQrgSeedings
      (seeding_id,procedure_id,revision,site_id,drive_id,item_id,seen_version,qrg_name,qrg_mime,pages_read,outcome,outcome_reason,proposed_json,model,seeded_by)
      VALUES(@seeding_id,@procedure_id,@revision,@site_id,@drive_id,@item_id,@seen_version,@qrg_name,@qrg_mime,@pages_read,@outcome,@outcome_reason,@proposed_json,@model,@seeded_by)`);
}

app.http("decisionMatrixQrgSeed", {
  route: "manage/decision-matrix/procedures/seed-from-qrg",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: seedDecisionMatrixDraftFromQrg,
});
