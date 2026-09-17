import assert from "node:assert/strict";
import test from "node:test";
import type { sql } from "./db";
import { createInMemoryLibraryItems } from "./sharepointLibrary";
import { isInlineImageMime, prepareSupportingDocumentReferences, ReferenceRefusal } from "./supportingDocumentReferences";

const config = { site_id: "mvtamn.sharepoint.com,site-1,web-1", drive_id: "drive-1" };
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function library() {
  return createInMemoryLibraryItems(config, {
    "item-sop": { name: "SOP-OCC-001.docx", kind: "file", mime_type: DOCX, etag: '"{A},3"', web_url: "https://mvtamn.sharepoint.com/sites/Ops/SOP-OCC-001.docx" },
    "item-map": { name: "Detour map.png", kind: "file", mime_type: "image/png", etag: '"{B},1"', web_url: "https://mvtamn.sharepoint.com/sites/Ops/Detour%20map.png" },
    "item-folder": { name: "_SOPs", kind: "folder", mime_type: null, etag: '"{C},1"', web_url: "https://mvtamn.sharepoint.com/sites/Ops/_SOPs" },
    "item-untagged": { name: "Untagged.pdf", kind: "file", mime_type: "application/pdf", etag: null, web_url: "https://mvtamn.sharepoint.com/sites/Ops/Untagged.pdf" },
    "item-elsewhere": { name: "Elsewhere.pdf", kind: "file", mime_type: "application/pdf", etag: '"{D},1"', web_url: "https://example.com/Elsewhere.pdf" },
    "item-refused": { outcome: "forbidden", reason: "SharePoint refused OnBoard's read of this library." },
    "item-down": { outcome: "failed", reason: "SharePoint could not be read: Microsoft Graph returned 503." },
    "item-unconfigured": { outcome: "not_configured", reason: "No approved SharePoint library is configured." },
  });
}

const sop = { document_type: "SOP", is_primary: true, document_code: "SOP-OCC-001", item_id: "item-sop", seen_version: '"{A},3"' };

async function refusal(value: unknown, reader = library()): Promise<{ status: number; message: string }> {
  try {
    await prepareSupportingDocumentReferences(value, reader);
  } catch (error) {
    assert.ok(error instanceof ReferenceRefusal, `expected a ReferenceRefusal, got ${String(error)}`);
    return { status: error.status, message: error.message };
  }
  assert.fail("expected the references to be refused");
}

type Stored = { reference_id: string; site_id: string; drive_id: string; item_id: string; expected_version: string; expected_file_name: string; expected_mime_type: string; web_url: string };

/** A transaction that holds a revision's stored references and records every statement. */
function transactionHolding(stored: Stored[]) {
  const statements: Array<{ query: string; inputs: Record<string, unknown> }> = [];
  const transaction = {
    request() {
      const inputs: Record<string, unknown> = {};
      const request = {
        input(name: string, _type: unknown, value: unknown) { inputs[name] = value; return request; },
        async query(query: string) {
          statements.push({ query, inputs });
          return { recordset: query.startsWith("SELECT") ? stored : [] };
        },
      };
      return request;
    },
  } as unknown as sql.Transaction;
  return { transaction, statements };
}

test("a newly chosen document is recorded as SharePoint describes it, in the configured library", async () => {
  const reader = library();
  const prepared = await prepareSupportingDocumentReferences([sop], reader);
  const { transaction, statements } = transactionHolding([]);
  const [written] = await prepared.write(transaction, "procedure-1", 1);
  assert.match(written.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual({ ...written, id: undefined }, {
    id: undefined, document_type: "SOP", is_primary: true, document_code: "SOP-OCC-001",
    site_id: config.site_id, drive_id: config.drive_id, item_id: "item-sop",
    expected_version: '"{A},3"', expected_file_name: "SOP-OCC-001.docx", expected_mime_type: DOCX,
    web_url: "https://mvtamn.sharepoint.com/sites/Ops/SOP-OCC-001.docx",
  });
  assert.deepEqual(reader.reads, ["item-sop"]);
  assert.ok(statements.some((statement) => statement.query.startsWith("INSERT INTO ProcedureDocumentReferences")));
});

// The browser used to send these, and the save stored them on trust.
test("a request that names the site, drive or any fact SharePoint owns is refused, naming the fields", async () => {
  const refused = await refusal([{ ...sop, site_id: "another-site", drive_id: "another-drive" }]);
  assert.equal(refused.status, 400);
  assert.match(refused.message, /sends site_id, drive_id, which OnBoard reads from SharePoint itself/);
});

test("a save that chooses no new document never asks SharePoint", async () => {
  const reader = library();
  await prepareSupportingDocumentReferences([{ id: "00000000-0000-4000-8000-000000000001", document_type: "SOP", is_primary: true, document_code: "SOP-OCC-001" }], reader);
  await prepareSupportingDocumentReferences(undefined, reader);
  assert.deepEqual(reader.reads, []);
});

test("each value the author sends is held to its own column, and the refusal names it", async () => {
  assert.deepEqual(await refusal([{ ...sop, document_code: "S".repeat(101) }]), { status: 400, message: "Supporting Document Reference 1: document_code must be a non-empty value of 100 characters or fewer." });
  assert.match((await refusal([{ ...sop, item_id: "i".repeat(201) }])).message, /item_id must be a non-empty value of 200 characters or fewer/);
  assert.match((await refusal([{ ...sop, seen_version: "" }])).message, /seen_version must be the version the picker showed/);
});

test("the primary rules are the module's: one primary, and only an SOP or Reference", async () => {
  assert.equal((await refusal([{ ...sop, document_type: "QRG" }])).message, "Only an SOP or Reference can be primary.");
  assert.equal((await refusal([sop, { ...sop, item_id: "item-map", seen_version: '"{B},1"', document_type: "Reference" }])).message, "A Draft can have only one primary Supporting Document Reference.");
  assert.equal((await refusal([{ ...sop, document_type: "Memo" }])).message, "Each Supporting Document Reference needs a supported document type.");
});

// Three owners, three answers: the request, a SharePoint administrator, and
// nobody (try again).
test("a document that cannot be read is refused as the kind of fault it is", async () => {
  assert.deepEqual(await refusal([{ ...sop, item_id: "item-gone" }]), { status: 400, message: "Supporting Document Reference 1: SharePoint has no document with that id in the approved library. Choose the document again." });
  assert.deepEqual(await refusal([{ ...sop, item_id: "item-refused" }]), { status: 409, message: "SharePoint refused OnBoard's read of this library." });
  assert.deepEqual(await refusal([{ ...sop, item_id: "item-unconfigured" }]), { status: 409, message: "No approved SharePoint library is configured." });
  assert.deepEqual(await refusal([{ ...sop, item_id: "item-down" }]), { status: 503, message: "SharePoint could not be read: Microsoft Graph returned 503. Nothing was saved; try again." });
  assert.deepEqual(await refusal([{ ...sop, item_id: "item-folder", seen_version: '"{C},1"' }]), { status: 400, message: "Supporting Document Reference 1: _SOPs is a folder, not a document." });
});

test("a document that changed after it was chosen is refused rather than recorded at its new version", async () => {
  assert.deepEqual(await refusal([{ ...sop, seen_version: '"{A},2"' }]), { status: 409, message: "SOP-OCC-001.docx changed in SharePoint after you chose it. Choose it again to reference the current version." });
});

test("a document SharePoint does not fully describe, or links outside the tenant, cannot be referenced", async () => {
  assert.deepEqual(await refusal([{ ...sop, item_id: "item-untagged", seen_version: "x" }]), { status: 409, message: "SharePoint did not report a version for Untagged.pdf, so it cannot be referenced." });
  assert.deepEqual(await refusal([{ ...sop, item_id: "item-elsewhere", seen_version: '"{D},1"' }]), { status: 409, message: "SharePoint gave Elsewhere.pdf a link outside mvtamn.sharepoint.com, so it cannot be referenced." });
});

test("a Visual rendition that could never be shown is refused when it is chosen", async () => {
  assert.deepEqual(await refusal([{ document_type: "Visual rendition", document_code: "VR-1", item_id: "item-sop", seen_version: '"{A},3"' }]), { status: 400, message: `A Visual rendition must be a PNG or JPEG image; SOP-OCC-001.docx is ${DOCX}.` });
  await prepareSupportingDocumentReferences([{ document_type: "Visual rendition", document_code: "VR-1", item_id: "item-map", seen_version: '"{B},1"' }], library());
  assert.equal(isInlineImageMime("image/JPEG"), true);
});

test("the same document cannot be chosen twice", async () => {
  const refused = await refusal([sop, { ...sop, is_primary: false, document_type: "Form" }]);
  assert.equal(refused.message, "Supporting Document Reference 2 chooses a document this Draft already references.");
});

test("a kept reference cannot also choose a document", async () => {
  const refused = await refusal([{ id: "00000000-0000-4000-8000-000000000001", ...sop }]);
  assert.match(refused.message, /keeps the document it already references, so it cannot also choose one/);
});

const storedSop: Stored = { reference_id: "00000000-0000-4000-8000-000000000001", site_id: "hand-typed-site", drive_id: "hand-typed-drive", item_id: "item-old", expected_version: '"{Z},9"', expected_file_name: "Old SOP.docx", expected_mime_type: DOCX, web_url: "https://mvtamn.sharepoint.com/Old%20SOP.docx" };
const storedForm: Stored = { ...storedSop, reference_id: "00000000-0000-4000-8000-000000000002", item_id: "item-form", expected_file_name: "Form.pdf", expected_mime_type: "application/pdf" };

// Health describes the document, not the save. A kept reference is updated in
// place, and nothing here names a health column.
test("a kept reference keeps its stored document and is never deleted or re-inserted", async () => {
  const prepared = await prepareSupportingDocumentReferences([
    { document_type: "Reference", is_primary: false, document_code: "REF-NEW", item_id: "item-map", seen_version: '"{B},1"' },
    { id: storedSop.reference_id.toUpperCase(), document_type: "Reference", is_primary: true, document_code: "SOP-OCC-001-B" },
  ], library());
  const { transaction, statements } = transactionHolding([storedSop, storedForm]);
  const written = await prepared.write(transaction, "procedure-1", 2);

  assert.equal(written[1].site_id, "hand-typed-site", "a hand-typed reference stays as stored");
  assert.equal(written[1].expected_version, '"{Z},9"');
  const deleted = statements.filter((statement) => statement.query.startsWith("DELETE"));
  assert.deepEqual(deleted.map((statement) => statement.inputs.reference_id), [storedForm.reference_id], "only the reference the author removed is deleted");
  const kept = statements.find((statement) => statement.query.startsWith("UPDATE ProcedureDocumentReferences SET sort_order=@sort_order"));
  assert.deepEqual(kept?.inputs, { procedure_id: "procedure-1", revision: 2, reference_id: storedSop.reference_id, sort_order: 2, document_type: "Reference", is_primary: 1, document_code: "SOP-OCC-001-B" });
  const parked = statements.findIndex((statement) => statement.query.includes("sort_order+1000000"));
  assert.ok(parked >= 0 && parked < statements.indexOf(kept!), "kept rows are parked before any takes its new position");
  assert.equal(statements.filter((statement) => statement.query.startsWith("INSERT")).length, 1);
  assert.ok(statements.every((statement) => !/health|checked_at|observed_/.test(statement.query)), "no statement writes health");
});

test("a kept reference that is not on this revision is refused", async () => {
  const prepared = await prepareSupportingDocumentReferences([{ id: "00000000-0000-4000-8000-000000000099", document_type: "SOP", is_primary: true, document_code: "SOP-OCC-001" }], library());
  await assert.rejects(prepared.write(transactionHolding([storedSop]).transaction, "procedure-1", 1), (error: unknown) => error instanceof ReferenceRefusal && error.status === 400 && /is not on this Draft/.test(error.message));
});

test("a newly chosen document the Draft already keeps is refused, by name", async () => {
  const kept: Stored = { ...storedSop, site_id: config.site_id, drive_id: config.drive_id, item_id: "item-sop", expected_file_name: "SOP-OCC-001.docx" };
  const prepared = await prepareSupportingDocumentReferences([
    { id: kept.reference_id, document_type: "SOP", is_primary: true, document_code: "SOP-OCC-001" },
    { ...sop, is_primary: false, document_type: "Reference" },
  ], library());
  await assert.rejects(prepared.write(transactionHolding([kept]).transaction, "procedure-1", 1), (error: unknown) => error instanceof ReferenceRefusal && error.message === "Supporting Document Reference 2 references SOP-OCC-001.docx, which this Draft already references.");
});

test("a kept reference cannot become a Visual rendition unless its stored document is an image", async () => {
  const prepared = await prepareSupportingDocumentReferences([{ id: storedSop.reference_id, document_type: "Visual rendition", document_code: "VR-1" }], library());
  await assert.rejects(prepared.write(transactionHolding([storedSop]).transaction, "procedure-1", 1), (error: unknown) => error instanceof ReferenceRefusal && /Old SOP\.docx is application/.test(error.message));
});
