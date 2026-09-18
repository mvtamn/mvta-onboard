import assert from "node:assert/strict";
import test from "node:test";
import type { LibraryEntry, LibraryListing } from "./sharepointLibrary";
import { MAX_DEPTH, MAX_DOCUMENTS, reconcile, syncStatusFor, walkLocation, type KnownDocument } from "./decisionMatrixLocationSync";

const folder = (name: string, path: string): LibraryEntry => ({
  item_id: `f-${path}`, name, kind: "folder", path, mime_type: null, size_bytes: null,
  etag: null, last_modified_at: null, child_count: 1, web_url: null,
});
const file = (name: string, path: string, etag = '"v1"'): LibraryEntry => ({
  item_id: `d-${path}`, name, kind: "file", path, mime_type: "application/pdf", size_bytes: 1,
  etag, last_modified_at: "2026-09-01T00:00:00Z", child_count: null, web_url: `https://sp/${path}`,
});

function libraryOf(tree: Record<string, LibraryEntry[]>, failures: Record<string, LibraryListing> = {}) {
  return async (path: string): Promise<LibraryListing> =>
    failures[path] ?? { outcome: "ok", path, entries: tree[path] ?? [] };
}

test("a walk reads the watched folder and everything under it", async () => {
  const walk = await walkLocation(libraryOf({
    "_SOPs": [folder("_OCC Documents", "_SOPs/_OCC Documents"), file("Top.pdf", "_SOPs/Top.pdf")],
    "_SOPs/_OCC Documents": [file("Deep.pdf", "_SOPs/_OCC Documents/Deep.pdf")],
  }), "_SOPs");
  assert.equal(walk.outcome, "ok");
  assert.equal(walk.complete, true);
  assert.deepEqual(walk.documents.map((d) => d.name).sort(), ["Deep.pdf", "Top.pdf"]);
  // Paths are recorded relative to the watched folder, not the drive.
  assert.deepEqual(walk.documents.map((d) => d.relative_path).sort(), ["", "_OCC Documents"]);
});

// The dangerous case. Everything the walk did not reach looks missing, and
// marking it gone would turn one unreadable subfolder into a library that
// appears to have emptied itself.
test("a walk that hits an unreadable subfolder is incomplete, and its absences prove nothing", async () => {
  const walk = await walkLocation(libraryOf(
    { "": [folder("Locked", "Locked"), file("Seen.pdf", "Seen.pdf")] },
    { "Locked": { outcome: "forbidden", path: "Locked", reason: "OnBoard has not been granted access." } },
  ), "");
  assert.equal(walk.complete, false);
  assert.equal(walk.outcome, "forbidden");

  const known: KnownDocument[] = [
    { item_id: "d-Seen.pdf", etag: '"v1"', disappeared: false },
    { item_id: "d-Locked/Hidden.pdf", etag: '"v1"', disappeared: false },
  ];
  const changes = reconcile(known, walk);
  assert.deepEqual(changes.disappeared, [], "a partial walk must never conclude a document is gone");
});

test("a walk too large to read in full says so, and still concludes nothing from absence", async () => {
  const many = Array.from({ length: MAX_DOCUMENTS + 5 }, (_, index) => file(`SOP-${index}.pdf`, `SOP-${index}.pdf`));
  const walk = await walkLocation(libraryOf({ "": many }), "");
  assert.equal(walk.outcome, "too_large");
  assert.equal(walk.complete, false);
  assert.match(walk.reason ?? "", /not read in full/);
  assert.equal(syncStatusFor(walk), "failed", "too_large is a failure to read, not a successful empty read");
  assert.deepEqual(reconcile([{ item_id: "d-gone.pdf", etag: null, disappeared: false }], walk).disappeared, []);
});

test("a folder nested past the limit stops the walk rather than being skipped", async () => {
  const tree: Record<string, LibraryEntry[]> = {};
  let path = "";
  for (let depth = 0; depth <= MAX_DEPTH + 1; depth += 1) {
    const child = path ? `${path}/d${depth}` : `d${depth}`;
    tree[path] = [folder(`d${depth}`, child)];
    path = child;
  }
  const walk = await walkLocation(libraryOf(tree), "");
  assert.equal(walk.outcome, "too_large");
  assert.equal(walk.complete, false);
});

test("a complete walk tells apart a new document, a revised one and one that has gone", () => {
  const walk = {
    complete: true as const,
    documents: [
      { item_id: "a", name: "A.pdf", relative_path: "", mime_type: null, size_bytes: null, etag: '"v1"', last_modified_at: null },
      { item_id: "b", name: "B.pdf", relative_path: "", mime_type: null, size_bytes: null, etag: '"v2"', last_modified_at: null },
      { item_id: "c", name: "C.pdf", relative_path: "", mime_type: null, size_bytes: null, etag: '"v1"', last_modified_at: null },
    ],
  };
  const known: KnownDocument[] = [
    { item_id: "a", etag: '"v1"', disappeared: false },
    { item_id: "b", etag: '"v1"', disappeared: false },
    { item_id: "d", etag: '"v1"', disappeared: false },
  ];
  const changes = reconcile(known, walk);
  assert.deepEqual(changes.added.map((d) => d.item_id), ["c"]);
  assert.deepEqual(changes.changed.map((d) => d.item_id), ["b"], "a different eTag is the SOP being revised");
  assert.deepEqual(changes.disappeared, ["d"]);
  assert.equal(changes.unchanged, 1);
});

test("a document that comes back is reported as returned, not as new", () => {
  const walk = {
    complete: true as const,
    documents: [{ item_id: "a", name: "A.pdf", relative_path: "", mime_type: null, size_bytes: null, etag: '"v9"', last_modified_at: null }],
  };
  const changes = reconcile([{ item_id: "a", etag: '"v1"', disappeared: true }], walk);
  assert.deepEqual(changes.returned.map((d) => d.item_id), ["a"]);
  assert.deepEqual(changes.added, []);
  assert.deepEqual(changes.changed, []);
});

test("a document already recorded as gone is not reported gone again", () => {
  const changes = reconcile([{ item_id: "a", etag: null, disappeared: true }], { complete: true, documents: [] });
  assert.deepEqual(changes.disappeared, [], "a location's history should not repeat itself every morning");
});

test("an empty watched folder is a complete walk with nothing in it", async () => {
  const walk = await walkLocation(libraryOf({ "_SOPs/_Drafts": [] }), "_SOPs/_Drafts");
  assert.equal(walk.complete, true);
  assert.deepEqual(walk.documents, []);
  // This is the one case where absence does mean gone: the folder was read.
  assert.deepEqual(reconcile([{ item_id: "old", etag: null, disappeared: false }], walk).disappeared, ["old"]);
});

test("the four sync statuses are what the location column allows", async () => {
  const cases = [
    ["forbidden", "forbidden"],
    ["not_found", "not_found"],
    ["failed", "failed"],
  ] as const;
  for (const [outcome, expected] of cases) {
    const walk = await walkLocation(libraryOf({}, { "": { outcome, path: "", reason: "because" } }), "");
    assert.equal(syncStatusFor(walk), expected);
  }
  assert.equal(syncStatusFor(await walkLocation(libraryOf({ "": [] }), "")), "ok");
});
