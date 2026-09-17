import { randomUUID } from "node:crypto";
import { sql } from "./db";
import type { LibraryItem, LibraryItemReader } from "./sharepointLibrary";

// A Supporting Document Reference, as a Draft save writes it.
//
// An author says which document and how it is used: its type, whether it is
// primary, its SOP code, and where it sits in the list. Everything that
// identifies the document - site, drive, name, type, link, the version the
// author chose - OnBoard learns from SharePoint, not from the request. The
// browser used to send all of it, and the save took a site and drive of up to
// 500 characters on trust, which is not what ADR 0024 means by "validated for
// identity".
//
// A reference the author keeps is named by its id and keeps the document it
// already names, with its health. It is updated in place, never deleted and
// inserted again, so saving a Draft does not reset Document Reference Health
// and nothing here writes a health column (that is
// lib/decisionMatrixDocumentHealth.ts, and only that).
//
// Reading SharePoint happens in prepare, before any transaction opens; write
// runs inside the caller's transaction and touches only the database.

export const DOCUMENT_TYPES: ReadonlySet<string> = new Set(["SOP", "Reference", "Form", "Map", "QRG", "Visual rendition"]);

/** A PNG or JPEG is the only document a Document Rendition can be. */
export function isInlineImageMime(mime: string): boolean {
  const lower = mime.toLowerCase();
  return lower === "image/png" || lower === "image/jpeg";
}

/** Why a set of references cannot be saved, with the status the handler answers. */
export class ReferenceRefusal extends Error {
  constructor(readonly status: 400 | 409 | 503, message: string) {
    super(message);
    this.name = "ReferenceRefusal";
  }
}

export interface WrittenReference {
  id: string;
  document_type: string;
  is_primary: boolean;
  document_code: string;
  site_id: string;
  drive_id: string;
  item_id: string;
  expected_version: string;
  expected_file_name: string;
  expected_mime_type: string;
  web_url: string;
}

export interface PreparedReferences {
  /** Replace the revision's references with these. Throws ReferenceRefusal. */
  write(transaction: sql.Transaction, procedureId: string, revision: number): Promise<WrittenReference[]>;
}

type Usage = { label: string; document_type: string; is_primary: boolean; document_code: string };
type Kept = Usage & { kind: "kept"; id: string };
type Chosen = Usage & { kind: "new"; item_id: string; seen_version: string };
type Resolved = Chosen & { item: LibraryItem & { mime_type: string; etag: string; web_url: string } };

// Sized to migration 076's columns. A value longer than its column used to
// pass a flat 500-character check and fail the insert, which the create
// handler then reported as a duplicate Procedure.
const LIMITS = { document_code: 100, item_id: 200, seen_version: 200, site_id: 200, drive_id: 200, name: 500, mime_type: 200, web_url: 2000 } as const;

// What the browser used to send. Silently ignoring a site_id would let a
// caller believe it had chosen a library.
const SERVER_READ_FIELDS = ["site_id", "drive_id", "web_url", "expected_version", "expected_file_name", "expected_mime_type"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function refuse(status: 400 | 409 | 503, message: string): never {
  throw new ReferenceRefusal(status, message);
}

function renditionRefusal(name: string, mime: string): ReferenceRefusal {
  return new ReferenceRefusal(400, `A Visual rendition must be a PNG or JPEG image; ${name} is ${mime}.`);
}

function parse(value: unknown): Array<Kept | Chosen> {
  if (value === undefined) return [];
  if (!Array.isArray(value)) refuse(400, "document_references must be an array.");
  const references: Array<Kept | Chosen> = [];
  const ids = new Set<string>();
  const items = new Set<string>();
  let primaries = 0;
  value.forEach((raw: unknown, index) => {
    const label = `Supporting Document Reference ${index + 1}`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) refuse(400, `${label} must be an object.`);
    const reference = raw as Record<string, unknown>;
    const sent = SERVER_READ_FIELDS.filter((field) => field in reference);
    if (sent.length) refuse(400, `${label} sends ${sent.join(", ")}, which OnBoard reads from SharePoint itself. Send item_id and seen_version for a newly chosen document, or id for one already on the Draft.`);
    if (typeof reference.document_type !== "string" || !DOCUMENT_TYPES.has(reference.document_type)) refuse(400, "Each Supporting Document Reference needs a supported document type.");
    if (reference.is_primary !== undefined && typeof reference.is_primary !== "boolean") refuse(400, `${label}: is_primary must be true or false.`);
    const isPrimary = reference.is_primary === true;
    if (isPrimary) {
      primaries++;
      if (reference.document_type !== "SOP" && reference.document_type !== "Reference") refuse(400, "Only an SOP or Reference can be primary.");
    }
    const code = typeof reference.document_code === "string" ? reference.document_code.trim() : "";
    if (!code || code.length > LIMITS.document_code) refuse(400, `${label}: document_code must be a non-empty value of ${LIMITS.document_code} characters or fewer.`);
    const usage = { label, document_type: reference.document_type, is_primary: isPrimary, document_code: code };

    if (reference.id !== undefined) {
      if (typeof reference.id !== "string" || !UUID.test(reference.id) || ids.has(reference.id.toLowerCase())) refuse(400, "Supporting Document Reference identities must be unique UUIDs.");
      if ("item_id" in reference || "seen_version" in reference) refuse(400, `${label} keeps the document it already references, so it cannot also choose one. To reference a different document, remove it and choose the document again.`);
      ids.add(reference.id.toLowerCase());
      references.push({ ...usage, kind: "kept", id: reference.id });
      return;
    }
    const itemId = reference.item_id;
    if (typeof itemId !== "string" || !itemId.trim() || itemId.length > LIMITS.item_id) refuse(400, `${label}: item_id must be a non-empty value of ${LIMITS.item_id} characters or fewer.`);
    const seen = reference.seen_version;
    if (typeof seen !== "string" || !seen.trim() || seen.length > LIMITS.seen_version) refuse(400, `${label}: seen_version must be the version the picker showed, ${LIMITS.seen_version} characters or fewer. Choose the document again.`);
    if (items.has(itemId)) refuse(400, `${label} chooses a document this Draft already references.`);
    items.add(itemId);
    references.push({ ...usage, kind: "new", item_id: itemId, seen_version: seen });
  });
  if (primaries > 1) refuse(400, "A Draft can have only one primary Supporting Document Reference.");
  return references;
}

async function resolve(reference: Chosen, library: LibraryItemReader): Promise<Resolved> {
  const read = await library.readItem(reference.item_id);
  // Three owners, three answers - the same split the picker shows. A document
  // that is not there is the request's fault; a library OnBoard may not read
  // is a state someone has to change; an outage is worth retrying.
  if (read.outcome !== "ok") {
    if (read.outcome === "not_found") refuse(400, `${reference.label}: ${read.reason}`);
    if (read.outcome === "failed") refuse(503, `${read.reason} Nothing was saved; try again.`);
    refuse(409, read.reason);
  }
  const { item } = read;
  if (item.kind === "folder") refuse(400, `${reference.label}: ${item.name} is a folder, not a document.`);
  const missing = [!item.etag && "a version", !item.mime_type && "a file type", !item.web_url && "a link"].filter(Boolean);
  if (missing.length || !item.etag || !item.mime_type || !item.web_url) refuse(409, `SharePoint did not report ${missing.join(", ")} for ${item.name}, so it cannot be referenced.`);
  // What reviewers approve against is the version the author chose. Recording
  // a newer one would make "unchanged" mean "unchanged since the save".
  if (item.etag !== reference.seen_version) refuse(409, `${item.name} changed in SharePoint after you chose it. Choose it again to reference the current version.`);
  const host = process.env.DECISION_MATRIX_SHAREPOINT_HOST ?? "mvtamn.sharepoint.com";
  let linkHost: string | null = null;
  try { const url = new URL(item.web_url); linkHost = url.protocol === "https:" ? url.hostname : null; } catch { linkHost = null; }
  if (linkHost !== host) refuse(409, `SharePoint gave ${item.name} a link outside ${host}, so it cannot be referenced.`);
  for (const [field, value, limit] of [["site", item.site_id, LIMITS.site_id], ["drive", item.drive_id, LIMITS.drive_id], ["name", item.name, LIMITS.name], ["file type", item.mime_type, LIMITS.mime_type], ["link", item.web_url, LIMITS.web_url]] as const) {
    if (value.length > limit) refuse(409, `The ${field} SharePoint reports for ${item.name} is longer than OnBoard can record.`);
  }
  if (reference.document_type === "Visual rendition" && !isInlineImageMime(item.mime_type)) throw renditionRefusal(item.name, item.mime_type);
  return { ...reference, item: { ...item, etag: item.etag, mime_type: item.mime_type, web_url: item.web_url } };
}

type StoredRow = { reference_id: string; site_id: string; drive_id: string; item_id: string; expected_version: string; expected_file_name: string; expected_mime_type: string; web_url: string };

/**
 * Validate a Draft's references and read each newly chosen document from the
 * Approved Document Library. Call before opening a transaction: this is the
 * only step that talks to SharePoint, and a save that chooses no new document
 * never does. Throws ReferenceRefusal.
 */
export async function prepareSupportingDocumentReferences(value: unknown, library: LibraryItemReader): Promise<PreparedReferences> {
  const requested = parse(value);
  const chosen = requested.filter((reference): reference is Chosen => reference.kind === "new");
  const resolvedByLabel = new Map<string, Resolved>();
  // Read in parallel, refuse in list order, so the answer names the first
  // reference that cannot be saved whichever read finished first.
  const settled = await Promise.allSettled(chosen.map((reference) => resolve(reference, library)));
  for (const result of settled) {
    if (result.status === "rejected") throw result.reason;
    resolvedByLabel.set(result.value.label, result.value);
  }
  const references = requested.map((reference) => reference.kind === "new" ? resolvedByLabel.get(reference.label)! : reference);

  return {
    async write(transaction, procedureId, revision) {
      const scoped = () => transaction.request().input("procedure_id", sql.NVarChar, procedureId).input("revision", sql.Int, revision);
      const stored = await scoped().query<StoredRow>("SELECT CONVERT(varchar(36),reference_id) AS reference_id,site_id,drive_id,item_id,expected_version,expected_file_name,expected_mime_type,web_url FROM ProcedureDocumentReferences WITH (UPDLOCK,HOLDLOCK) WHERE procedure_id=@procedure_id AND revision=@revision");
      const byId = new Map(stored.recordset.map((row) => [row.reference_id.toLowerCase(), row]));

      const documents = new Set<string>();
      const written: WrittenReference[] = [];
      for (const reference of references) {
        let facts: Omit<WrittenReference, "id" | "document_type" | "is_primary" | "document_code">;
        let id: string;
        if (reference.kind === "kept") {
          const row = byId.get(reference.id.toLowerCase());
          if (!row) refuse(400, `${reference.label} is not on this Draft. Refresh the Draft and save again.`);
          if (reference.document_type === "Visual rendition" && !isInlineImageMime(row.expected_mime_type)) throw renditionRefusal(row.expected_file_name, row.expected_mime_type);
          id = row.reference_id;
          facts = { site_id: row.site_id, drive_id: row.drive_id, item_id: row.item_id, expected_version: row.expected_version, expected_file_name: row.expected_file_name, expected_mime_type: row.expected_mime_type, web_url: row.web_url };
        } else {
          id = randomUUID();
          const { item } = reference as Resolved;
          facts = { site_id: item.site_id, drive_id: item.drive_id, item_id: item.item_id, expected_version: item.etag, expected_file_name: item.name, expected_mime_type: item.mime_type, web_url: item.web_url };
        }
        const document = `${facts.site_id}\n${facts.drive_id}\n${facts.item_id}`;
        if (documents.has(document)) refuse(400, `${reference.label} references ${facts.expected_file_name}, which this Draft already references.`);
        documents.add(document);
        written.push({ id, document_type: reference.document_type, is_primary: reference.is_primary, document_code: reference.document_code, ...facts });
      }

      const keptIds = new Set(references.filter((reference): reference is Kept => reference.kind === "kept").map((reference) => reference.id.toLowerCase()));
      for (const row of stored.recordset) {
        if (keptIds.has(row.reference_id.toLowerCase())) continue;
        await scoped().input("reference_id", sql.UniqueIdentifier, row.reference_id).query("DELETE FROM ProcedureDocumentReferences WHERE reference_id=@reference_id AND procedure_id=@procedure_id AND revision=@revision");
      }
      // Positions and the one primary are unique per revision, so moving kept
      // rows one at a time could collide with a position or a primary another
      // row still holds. Park them first, past any position a Draft reaches,
      // in one statement.
      if (keptIds.size) await scoped().query("UPDATE ProcedureDocumentReferences SET sort_order=sort_order+1000000,is_primary=0 WHERE procedure_id=@procedure_id AND revision=@revision");

      for (const [index, reference] of written.entries()) {
        const request = scoped()
          .input("reference_id", sql.UniqueIdentifier, reference.id)
          .input("sort_order", sql.Int, index + 1)
          .input("document_type", sql.NVarChar, reference.document_type)
          .input("is_primary", sql.Bit, reference.is_primary ? 1 : 0)
          .input("document_code", sql.NVarChar, reference.document_code);
        if (keptIds.has(reference.id.toLowerCase())) {
          // Usage only. The document and its health stay as they are.
          await request.query("UPDATE ProcedureDocumentReferences SET sort_order=@sort_order,document_type=@document_type,is_primary=@is_primary,document_code=@document_code WHERE reference_id=@reference_id AND procedure_id=@procedure_id AND revision=@revision");
        } else {
          await request
            .input("site_id", sql.NVarChar, reference.site_id)
            .input("drive_id", sql.NVarChar, reference.drive_id)
            .input("item_id", sql.NVarChar, reference.item_id)
            .input("expected_version", sql.NVarChar, reference.expected_version)
            .input("expected_file_name", sql.NVarChar, reference.expected_file_name)
            .input("expected_mime_type", sql.NVarChar, reference.expected_mime_type)
            .input("web_url", sql.NVarChar, reference.web_url)
            .query("INSERT INTO ProcedureDocumentReferences(reference_id,procedure_id,revision,sort_order,document_type,is_primary,document_code,site_id,drive_id,item_id,expected_version,expected_file_name,expected_mime_type,web_url) VALUES(@reference_id,@procedure_id,@revision,@sort_order,@document_type,@is_primary,@document_code,@site_id,@drive_id,@item_id,@expected_version,@expected_file_name,@expected_mime_type,@web_url)");
        }
      }
      return written;
    },
  };
}
