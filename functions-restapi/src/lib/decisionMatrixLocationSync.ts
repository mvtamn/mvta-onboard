import type { LibraryEntry, LibraryListing } from "./sharepointLibrary";

/** What a sync saw in a watched folder. */
export interface ObservedDocument {
  item_id: string;
  name: string;
  /** Relative to the watched folder; "" is directly inside it. */
  relative_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  etag: string | null;
  last_modified_at: string | null;
}

/** What the last sync recorded, as the database holds it. */
export interface KnownDocument {
  item_id: string;
  etag: string | null;
  disappeared: boolean;
}

export type WalkOutcome = "ok" | "forbidden" | "not_found" | "failed" | "too_large";

export interface WalkResult {
  outcome: WalkOutcome;
  /**
   * Whether every folder under the watched one was read. This is the field the
   * disappearance rule turns on, and it is separate from `outcome` because a
   * walk can end early for several reasons that all mean the same thing here:
   * what was seen is not the whole truth.
   */
  complete: boolean;
  reason: string | null;
  documents: ObservedDocument[];
  folders_read: number;
}

// A watched folder is a corner of a document library, not the library. These
// caps stop one misconfigured location from walking an entire tenant's
// SharePoint on a timer, and - more importantly - hitting one is reported as an
// incomplete walk rather than quietly returning a short list.
export const MAX_DOCUMENTS = 2000;
export const MAX_FOLDERS = 200;
export const MAX_DEPTH = 8;

function relativeTo(root: string, path: string): string {
  if (!root) return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const inside = path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
  return inside.includes("/") ? inside.slice(0, inside.lastIndexOf("/")) : "";
}

function toObserved(entry: LibraryEntry, root: string): ObservedDocument {
  return {
    item_id: entry.item_id,
    name: entry.name,
    relative_path: relativeTo(root, entry.path),
    mime_type: entry.mime_type,
    size_bytes: entry.size_bytes,
    etag: entry.etag,
    last_modified_at: entry.last_modified_at,
  };
}

/**
 * Reads a watched folder and everything under it.
 *
 * Stops at the first folder it cannot read. A partial walk is the dangerous
 * case: every document it did not reach looks missing, and marking those gone
 * would turn one forbidden subfolder into a library that appears to have
 * emptied itself. So the walk reports what it managed and says plainly that it
 * is not the whole picture.
 */
export async function walkLocation(
  listFolder: (path: string) => Promise<LibraryListing>,
  root: string,
): Promise<WalkResult> {
  const documents: ObservedDocument[] = [];
  const queue: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }];
  let foldersRead = 0;

  while (queue.length) {
    const { path, depth } = queue.shift()!;
    if (foldersRead >= MAX_FOLDERS) {
      return { outcome: "too_large", complete: false, reason: `This location holds more than ${MAX_FOLDERS} folders, so it was not read in full. Watch a folder further in.`, documents, folders_read: foldersRead };
    }
    const listing = await listFolder(path);
    if (listing.outcome !== "ok") {
      return { outcome: listing.outcome, complete: false, reason: listing.reason, documents, folders_read: foldersRead };
    }
    foldersRead += 1;
    for (const entry of listing.entries) {
      if (entry.kind === "folder") {
        // A folder past the depth limit is not silently ignored: ignoring it
        // would make its documents look deleted on the next sync.
        if (depth + 1 > MAX_DEPTH) {
          return { outcome: "too_large", complete: false, reason: `This location nests deeper than ${MAX_DEPTH} folders, so it was not read in full. Watch a folder further in.`, documents, folders_read: foldersRead };
        }
        queue.push({ path: entry.path, depth: depth + 1 });
        continue;
      }
      if (documents.length >= MAX_DOCUMENTS) {
        return { outcome: "too_large", complete: false, reason: `This location holds more than ${MAX_DOCUMENTS} documents, so it was not read in full. Watch a folder further in.`, documents, folders_read: foldersRead };
      }
      documents.push(toObserved(entry, root));
    }
  }

  return { outcome: "ok", complete: true, reason: null, documents, folders_read: foldersRead };
}

export interface Reconciliation {
  added: ObservedDocument[];
  /** Same document, different eTag: the SOP was revised in SharePoint. */
  changed: ObservedDocument[];
  /** Recorded as gone, and there again. */
  returned: ObservedDocument[];
  /** item_ids recorded as present that this walk did not find. */
  disappeared: string[];
  unchanged: number;
}

/**
 * What changed between what was recorded and what was just seen.
 *
 * `complete` governs disappearances and nothing else. A partial walk can still
 * report documents it found as added or changed - those are facts it observed.
 * What it cannot do is conclude anything from absence.
 */
export function reconcile(known: KnownDocument[], walk: Pick<WalkResult, "documents" | "complete">): Reconciliation {
  const byId = new Map(known.map((document) => [document.item_id, document]));
  const result: Reconciliation = { added: [], changed: [], returned: [], disappeared: [], unchanged: 0 };

  for (const document of walk.documents) {
    const previous = byId.get(document.item_id);
    if (!previous) { result.added.push(document); continue; }
    if (previous.disappeared) { result.returned.push(document); continue; }
    if (previous.etag !== document.etag) { result.changed.push(document); continue; }
    result.unchanged += 1;
  }

  if (walk.complete) {
    const seen = new Set(walk.documents.map((document) => document.item_id));
    for (const document of known) {
      if (!document.disappeared && !seen.has(document.item_id)) result.disappeared.push(document.item_id);
    }
  }
  return result;
}

/** The status recorded against the location, which the console reads back. */
export function syncStatusFor(walk: Pick<WalkResult, "outcome">): "ok" | "forbidden" | "not_found" | "failed" {
  if (walk.outcome === "ok") return "ok";
  if (walk.outcome === "forbidden") return "forbidden";
  if (walk.outcome === "not_found") return "not_found";
  return "failed";
}
