// Reading the approved SOP library, and nothing else.
//
// The application holds Sites.Selected, so SharePoint itself will refuse any
// site an administrator has not granted it. That is the outer guarantee and it
// is the one that matters. This module adds the inner one: the site and drive
// are configuration, never request input, so an OCC.Admin browsing the picker
// cannot reach a second granted library by editing a query string. Only the
// path within the configured drive comes from the caller, and it is validated
// before it is ever put in a URL.
//
// Graph addresses a folder as `/drives/{drive}/root:/{path}:/children`, where
// the colons delimit the path. A path containing a colon, or a `..` segment,
// would change which item is addressed rather than failing - so both are
// refused here rather than encoded and hoped for.

export interface LibraryEntry {
  /** Graph's driveItem id: what a document reference stores as item_id. */
  item_id: string;
  name: string;
  kind: "folder" | "file";
  /** Relative to the drive root, so it can be handed straight back as `path`. */
  path: string;
  mime_type: string | null;
  size_bytes: number | null;
  etag: string | null;
  last_modified_at: string | null;
  /** Null for files; folders carry it so the picker can show an empty folder as empty. */
  child_count: number | null;
  web_url: string | null;
}

// The four outcomes are kept apart for the same reason the document health
// check now keeps them apart: "you were never granted this library" and "there
// is nothing in this folder" are different facts, and collapsing them sends
// whoever is looking to the wrong place.
export type LibraryListing =
  | { outcome: "ok"; path: string; entries: LibraryEntry[] }
  | { outcome: "forbidden"; path: string; reason: string }
  | { outcome: "not_found"; path: string; reason: string }
  | { outcome: "failed"; path: string; reason: string };

export interface LibraryConfig {
  site_id: string;
  drive_id: string;
}

type TokenProvider = () => Promise<string>;
type GraphFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const MAX_PATH = 800;
const MAX_SEGMENTS = 30;

export class InvalidLibraryPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidLibraryPathError";
  }
}

/**
 * Normalises a caller-supplied path to the form Graph is asked for, or throws.
 * Returns "" for the drive root.
 */
export function normalizeLibraryPath(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return "";
  const trimmed = String(raw).trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (!trimmed) return "";
  if (trimmed.length > MAX_PATH) throw new InvalidLibraryPathError("That folder path is too long to be a real one.");
  // A colon would close or reopen Graph's `root:/…:` addressing and change
  // which item is read. A backslash is not a SharePoint separator and usually
  // means someone pasted a Windows path.
  if (trimmed.includes(":")) throw new InvalidLibraryPathError("A folder path cannot contain a colon.");
  if (trimmed.includes("\\")) throw new InvalidLibraryPathError("Use forward slashes in a folder path.");
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) throw new InvalidLibraryPathError("That folder path contains characters SharePoint does not allow.");
  const segments = trimmed.split("/");
  if (segments.length > MAX_SEGMENTS) throw new InvalidLibraryPathError("That folder path is nested too deeply to be a real one.");
  for (const segment of segments) {
    if (!segment) throw new InvalidLibraryPathError("A folder path cannot contain an empty segment.");
    if (segment === "." || segment === "..") throw new InvalidLibraryPathError("A folder path cannot navigate upwards.");
  }
  return segments.join("/");
}

function childrenUrl(config: LibraryConfig, path: string): string {
  const select = "$select=id,name,folder,file,size,eTag,lastModifiedDateTime,webUrl";
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const base = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(config.site_id)}/drives/${encodeURIComponent(config.drive_id)}`;
  return path
    ? `${base}/root:/${encoded}:/children?${select}&$top=200`
    : `${base}/root/children?${select}&$top=200`;
}

type GraphItem = {
  id?: unknown;
  name?: unknown;
  folder?: { childCount?: unknown } | null;
  file?: { mimeType?: unknown } | null;
  size?: unknown;
  eTag?: unknown;
  lastModifiedDateTime?: unknown;
  webUrl?: unknown;
};

function toEntry(item: GraphItem, parentPath: string): LibraryEntry | null {
  const id = typeof item.id === "string" ? item.id : null;
  const name = typeof item.name === "string" ? item.name : null;
  if (!id || !name) return null;
  const isFolder = !!item.folder;
  return {
    item_id: id,
    name,
    kind: isFolder ? "folder" : "file",
    path: parentPath ? `${parentPath}/${name}` : name,
    mime_type: typeof item.file?.mimeType === "string" ? item.file.mimeType : null,
    size_bytes: typeof item.size === "number" ? item.size : null,
    etag: typeof item.eTag === "string" ? item.eTag : null,
    last_modified_at: typeof item.lastModifiedDateTime === "string" ? item.lastModifiedDateTime : null,
    child_count: isFolder && typeof item.folder?.childCount === "number" ? item.folder.childCount : null,
    web_url: typeof item.webUrl === "string" ? item.webUrl : null,
  };
}

/** Folders first, then files, each A-Z: the order a person expects a file list in. */
function inReadingOrder(a: LibraryEntry, b: LibraryEntry): number {
  if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
  return a.name.localeCompare(b.name, "en", { sensitivity: "base", numeric: true });
}

// Two different faults with two different fixers. The application holds
// Sites.Selected with admin consent, which grants nothing on its own: a 403
// means the token was accepted and the per-site grant (POST
// /sites/{id}/permissions) is missing - a SharePoint administrator's act, not
// an Entra portal change. A 401 means the token itself was refused, so no site
// grant would help. The earlier single message sent people to Entra for a 403
// on 2026-09-11..14. See docs/runbooks/decision-matrix-sharepoint-documents.md
// step 4. Listing a folder and reading a chosen document share these words, so
// the picker and the Draft save describe one fault the same way.
function refusal(status: number): string | null {
  if (status === 403) return "SharePoint refused OnBoard's read of this library. A SharePoint administrator must grant the OnBoard application read access on this site (step 4 of the SharePoint documents runbook). This is a missing site grant, not a missing folder.";
  if (status === 401) return "SharePoint did not accept OnBoard's sign-in, so the library was never read. OnBoard's application credential or its consent needs checking. This is not a missing folder, and a site grant will not fix it.";
  return null;
}

/** One item of the Approved Document Library, as SharePoint describes it now. */
export interface LibraryItem {
  site_id: string;
  drive_id: string;
  item_id: string;
  name: string;
  kind: "folder" | "file";
  mime_type: string | null;
  etag: string | null;
  web_url: string | null;
}

// "not_configured" belongs here as well as on the handler: whoever reads an
// item needs to know that no library could be asked, and saying so is not an
// outage.
export type LibraryItemRead =
  | { outcome: "ok"; item: LibraryItem }
  | { outcome: "not_configured" | "forbidden" | "not_found" | "failed"; reason: string };

/** What saving a Supporting Document Reference needs from the library: one item, by id. */
export interface LibraryItemReader {
  readItem(itemId: string): Promise<LibraryItemRead>;
}

function itemUrl(config: LibraryConfig, itemId: string): string {
  return `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(config.site_id)}/drives/${encodeURIComponent(config.drive_id)}/items/${encodeURIComponent(itemId)}?$select=id,name,folder,file,eTag,webUrl`;
}

export function createSharePointLibrary(config: LibraryConfig, getToken: TokenProvider, fetchGraph: GraphFetch = fetch) {
  async function listFolder(rawPath: string | null | undefined): Promise<LibraryListing> {
    let path: string;
    try {
      path = normalizeLibraryPath(rawPath);
    } catch (error) {
      return { outcome: "not_found", path: String(rawPath ?? ""), reason: error instanceof Error ? error.message : "That folder path cannot be read." };
    }
    try {
      const token = await getToken();
      const entries: LibraryEntry[] = [];
      let url: string | null = childrenUrl(config, path);
      // Graph pages at $top; a library folder with hundreds of SOPs would
      // otherwise silently show only the first page.
      while (url) {
        const response: Response = await fetchGraph(url, { headers: { Authorization: `Bearer ${token}` } });
        const refused = refusal(response.status);
        if (refused) return { outcome: "forbidden", path, reason: refused };
        if (response.status === 404) {
          return { outcome: "not_found", path, reason: path ? "SharePoint has no folder at that path." : "SharePoint has no document library at the configured site and drive." };
        }
        if (!response.ok) throw new Error(`Microsoft Graph returned ${response.status}.`);
        const body = await response.json() as { value?: unknown; "@odata.nextLink"?: unknown };
        for (const item of Array.isArray(body.value) ? body.value : []) {
          const entry = toEntry(item as GraphItem, path);
          if (entry) entries.push(entry);
        }
        url = typeof body["@odata.nextLink"] === "string" ? body["@odata.nextLink"] : null;
      }
      return { outcome: "ok", path, entries: entries.sort(inReadingOrder) };
    } catch (error) {
      return { outcome: "failed", path, reason: error instanceof Error ? `SharePoint could not be read: ${error.message}` : "SharePoint could not be read." };
    }
  }

  // The item is addressed inside the configured drive, so an id from another
  // library is not found here rather than read from wherever it lives.
  async function readItem(itemId: string): Promise<LibraryItemRead> {
    try {
      const token = await getToken();
      const response = await fetchGraph(itemUrl(config, itemId), { headers: { Authorization: `Bearer ${token}` } });
      const refused = refusal(response.status);
      if (refused) return { outcome: "forbidden", reason: refused };
      // Graph answers 400 for an id it cannot parse. Either way there is no
      // such document in this library.
      if (response.status === 404 || response.status === 400) {
        return { outcome: "not_found", reason: "SharePoint has no document with that id in the approved library. Choose the document again." };
      }
      if (!response.ok) throw new Error(`Microsoft Graph returned ${response.status}.`);
      const entry = toEntry(await response.json() as GraphItem, "");
      if (!entry) throw new Error("Microsoft Graph described the item without an id or name.");
      return {
        outcome: "ok",
        item: { site_id: config.site_id, drive_id: config.drive_id, item_id: entry.item_id, name: entry.name, kind: entry.kind, mime_type: entry.mime_type, etag: entry.etag, web_url: entry.web_url },
      };
    } catch (error) {
      return { outcome: "failed", reason: error instanceof Error ? `SharePoint could not be read: ${error.message}` : "SharePoint could not be read." };
    }
  }

  return { listFolder, readItem };
}

/**
 * The library as tests hold it: items by id, with the site and drive of the
 * configuration they stand in for. Anything not listed is not in the library;
 * a value that is not an item answers as that outcome instead.
 */
export function createInMemoryLibraryItems(
  config: LibraryConfig,
  items: Record<string, Omit<LibraryItem, "site_id" | "drive_id" | "item_id"> | Exclude<LibraryItemRead, { outcome: "ok" }>>,
): LibraryItemReader & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    async readItem(itemId) {
      reads.push(itemId);
      const found = items[itemId];
      if (!found) return { outcome: "not_found", reason: "SharePoint has no document with that id in the approved library. Choose the document again." };
      if ("outcome" in found) return found;
      return { outcome: "ok", item: { ...found, site_id: config.site_id, drive_id: config.drive_id, item_id: itemId } };
    },
  };
}

export type SharePointLibrary = ReturnType<typeof createSharePointLibrary>;
