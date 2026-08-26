import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { OnBehalfOfCredential } from "@azure/identity";
import { DECISION_MATRIX_READ_ROLES, requireRole } from "../lib/auth";
import { getPool, sql } from "../lib/db";

type RevisionRow = { procedure_id: string; revision: number; condition_key: string; condition: string; severity: string; severity_meaning: string; owner_team: string; owner_contact: string | null; effective_at: Date; next_review_at: Date; tags_json: string };
type CriterionRow = { procedure_id: string; revision: number; criterion_id: string; criterion_kind: string; criterion_text: string };
type ActionRow = { procedure_id: string; revision: number; action_id: string; action_kind: string; instruction: string };
type ReferenceRow = { procedure_id: string; revision: number; reference_id: string; document_type: string; is_primary: boolean; document_code: string; expected_file_name: string; expected_mime_type: string; web_url: string; health_status: "Valid" | "Needs review" | "Unavailable"; checked_at: Date | null; health_reason: string | null };

export function isInlineImageMime(mime: string): boolean { return mime.toLowerCase() === "image/png" || mime.toLowerCase() === "image/jpeg"; }
function tags(value: string): string[] { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : []; } catch { return []; } }
function key(row: { procedure_id: string; revision: number }) { return `${row.procedure_id}:${row.revision}`; }
function isHealthyPrimary(reference: Pick<ReferenceRow, "is_primary" | "health_status" | "document_type">) { return reference.is_primary && reference.health_status === "Valid" && (reference.document_type === "SOP" || reference.document_type === "Reference"); }

export async function listDecisionMatrix(request: HttpRequest, context: InvocationContext) {
  const auth = requireRole(request, DECISION_MATRIX_READ_ROLES);
  if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  const query = request.query.get("q")?.trim().slice(0, 200);
  try {
    const pool = await getPool(); const list = pool.request();
    if (query) list.input("q", sql.NVarChar, `%${query}%`);
    const revisions = await list.query<RevisionRow>(`
      SELECT p.procedure_id,r.revision,p.condition_key,p.condition,r.severity,r.severity_meaning,r.owner_team,r.owner_contact,r.effective_at,r.next_review_at,ISNULL(r.tags_json,'[]') tags_json
      FROM Procedures p JOIN ProcedureRevisions r ON r.procedure_id=p.procedure_id WHERE r.lifecycle_state='Approved'
      ${query ? `AND (p.condition_key LIKE @q OR p.condition LIKE @q OR r.tags_json LIKE @q OR EXISTS(SELECT 1 FROM ProcedureCriteria c WHERE c.procedure_id=r.procedure_id AND c.revision=r.revision AND c.criterion_text LIKE @q) OR EXISTS(SELECT 1 FROM ProcedureImmediateActions a WHERE a.procedure_id=r.procedure_id AND a.revision=r.revision AND a.instruction LIKE @q) OR EXISTS(SELECT 1 FROM ProcedureDocumentReferences d WHERE d.procedure_id=r.procedure_id AND d.revision=r.revision AND (d.document_code LIKE @q OR d.expected_file_name LIKE @q)))` : ""}
      ORDER BY p.condition,r.revision DESC`);
    const wanted = new Set(revisions.recordset.map(key));
    if (!wanted.size) return { status: 200, jsonBody: { procedures: [] } };
    const [criteria, actions, references] = await Promise.all([
      pool.request().query<CriterionRow>("SELECT c.procedure_id,c.revision,c.criterion_id,c.criterion_kind,c.criterion_text FROM ProcedureCriteria c JOIN ProcedureRevisions r ON r.procedure_id=c.procedure_id AND r.revision=c.revision WHERE r.lifecycle_state='Approved' ORDER BY c.sort_order"),
      pool.request().query<ActionRow>("SELECT a.procedure_id,a.revision,a.action_id,a.action_kind,a.instruction FROM ProcedureImmediateActions a JOIN ProcedureRevisions r ON r.procedure_id=a.procedure_id AND r.revision=a.revision WHERE r.lifecycle_state='Approved' ORDER BY a.sort_order"),
      pool.request().query<ReferenceRow>("SELECT d.procedure_id,d.revision,d.reference_id,d.document_type,d.is_primary,d.document_code,d.expected_file_name,d.expected_mime_type,d.web_url,d.health_status,d.checked_at,d.health_reason FROM ProcedureDocumentReferences d JOIN ProcedureRevisions r ON r.procedure_id=d.procedure_id AND r.revision=d.revision WHERE r.lifecycle_state='Approved' ORDER BY d.sort_order"),
    ]);
    const groupedCriteria = new Map<string, CriterionRow[]>(), groupedActions = new Map<string, ActionRow[]>(), groupedReferences = new Map<string, ReferenceRow[]>();
    for (const row of criteria.recordset) if (wanted.has(key(row))) groupedCriteria.set(key(row), [...(groupedCriteria.get(key(row)) ?? []), row]);
    for (const row of actions.recordset) if (wanted.has(key(row))) groupedActions.set(key(row), [...(groupedActions.get(key(row)) ?? []), row]);
    for (const row of references.recordset) if (wanted.has(key(row))) groupedReferences.set(key(row), [...(groupedReferences.get(key(row)) ?? []), row]);
    return { status: 200, jsonBody: { procedures: revisions.recordset.map((revision) => {
      const referenceRows = groupedReferences.get(key(revision)) ?? [];
      return { ...revision, tags: tags(revision.tags_json), criteria: (groupedCriteria.get(key(revision)) ?? []).map(({ criterion_id, criterion_kind, criterion_text }) => ({ id: criterion_id, kind: criterion_kind, text: criterion_text })), immediate_actions: (groupedActions.get(key(revision)) ?? []).map(({ action_id, action_kind, instruction }) => ({ id: action_id, kind: action_kind, instruction })), document_references: referenceRows.map(({ procedure_id, revision: _revision, ...reference }) => ({ ...reference, source_available: isHealthyPrimary(reference), inline_preview_available: (reference.document_type === "QRG" || reference.document_type === "Visual rendition") && reference.health_status === "Valid" && isInlineImageMime(reference.expected_mime_type) })) };
    }) } };
  } catch (error) { context.error("GET /decision-matrix failed", error); return { status: 500, jsonBody: { error: "Decision Matrix content is temporarily unavailable." } }; }
}

function requiredSetting(name: string): string { const value = process.env[name]?.trim(); if (!value) throw new Error(`${name} is required for delegated SharePoint preview.`); return value; }
async function delegatedGraphToken(assertion: string): Promise<string> {
  const credential = new OnBehalfOfCredential({ tenantId: requiredSetting("AZURE_TENANT_ID"), clientId: requiredSetting("ONBOARD_API_CLIENT_ID"), clientSecret: requiredSetting("ONBOARD_API_CLIENT_SECRET"), userAssertionToken: assertion });
  const token = await credential.getToken("https://graph.microsoft.com/.default"); if (!token?.token) throw new Error("Microsoft Graph delegated token acquisition returned no token."); return token.token;
}

export async function previewDecisionMatrixRendition(request: HttpRequest, context: InvocationContext) {
  const auth = requireRole(request, DECISION_MATRIX_READ_ROLES);
  if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  const { procedureId, revision: revisionParam, referenceId } = request.params; const revision = Number(revisionParam);
  if (!procedureId || !referenceId || !Number.isInteger(revision)) return { status: 400, jsonBody: { error: "Procedure, revision, and reference identities are required." } };
  const assertion = request.headers.get("x-ms-token-aad-access-token");
  if (!assertion) return { status: 401, jsonBody: { error: "A delegated SharePoint session is required to preview this rendition." } };
  try {
    const pool = await getPool();
    const source = await pool.request().input("procedure_id", sql.NVarChar, procedureId).input("revision", sql.Int, revision).input("reference_id", sql.UniqueIdentifier, referenceId).query<ReferenceRow & { site_id: string; drive_id: string; item_id: string }>("SELECT d.procedure_id,d.revision,d.reference_id,d.document_type,d.is_primary,d.document_code,d.expected_file_name,d.expected_mime_type,d.web_url,d.health_status,d.checked_at,d.health_reason,d.site_id,d.drive_id,d.item_id FROM ProcedureDocumentReferences d JOIN ProcedureRevisions r ON r.procedure_id=d.procedure_id AND r.revision=d.revision WHERE d.procedure_id=@procedure_id AND d.revision=@revision AND d.reference_id=@reference_id AND r.lifecycle_state='Approved'");
    const reference = source.recordset[0];
    if (!reference) return { status: 404, jsonBody: { error: "Approved visual rendition not found." } };
    if ((reference.document_type !== "QRG" && reference.document_type !== "Visual rendition") || reference.health_status !== "Valid" || !isInlineImageMime(reference.expected_mime_type)) return { status: 415, jsonBody: { error: "Only a currently Valid PNG or JPEG QRG or visual rendition can be displayed inline." } };
    const token = await delegatedGraphToken(assertion);
    const response = await fetch(`https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(reference.site_id)}/drives/${encodeURIComponent(reference.drive_id)}/items/${encodeURIComponent(reference.item_id)}/content`, { headers: { Authorization: `Bearer ${token}` }, redirect: "follow" });
    if (!response.ok) return { status: response.status === 401 || response.status === 403 || response.status === 404 ? 404 : 502, jsonBody: { error: "SharePoint rendition is unavailable to this user." } };
    return { status: 200, body: new Uint8Array(await response.arrayBuffer()), headers: { "content-type": reference.expected_mime_type, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } };
  } catch (error) { context.error("GET Decision Matrix visual rendition failed", error); return { status: 502, jsonBody: { error: "SharePoint rendition could not be displayed." } }; }
}

app.http("decisionMatrix", { route: "decision-matrix", methods: ["GET"], authLevel: "anonymous", handler: listDecisionMatrix });
app.http("decisionMatrixRenditionPreview", { route: "decision-matrix/procedures/{procedureId}/revisions/{revision}/document-references/{referenceId}/preview", methods: ["GET"], authLevel: "anonymous", handler: previewDecisionMatrixRendition });
