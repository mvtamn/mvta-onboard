import { app, type HttpRequest, type InvocationContext, type Timer } from "@azure/functions";
import { requireAccess } from "../lib/access/require";
import { getPool } from "../lib/db";
import { walkLocation } from "../lib/decisionMatrixLocationSync";
import { DECISION_MATRIX_SURFACES, surfaceReady } from "../lib/decisionMatrixReadiness";
import type { LibraryConfig, LibraryListing } from "../lib/sharepointLibrary";
import { chooseSopLocation, ensureSopLocation, recordSopFolderWalk, recordSopFolderWalkFailure, sopFolderSetting, unreferencedSopReport, watchedSopLocation, type SopFolderSetting } from "../lib/unreferencedSops";
import { approvedLibrary, libraryConfig } from "./decisionMatrixLibrary";

/** What one walk needs: the library it reads, how it lists a folder, and which folder. */
export interface SopFolderSource {
  config: LibraryConfig;
  listFolder(path: string): Promise<LibraryListing>;
  setting: SopFolderSetting;
}

function productionSource(): SopFolderSource | { reason: string } {
  const approved = approvedLibrary();
  if (!("library" in approved)) return { reason: approved.reason };
  // An unset setting is no longer fatal here - the watch may have been chosen
  // in the console. walkSopFolder decides, once it has looked.
  return { config: approved.config, listFolder: (path) => approved.library.listFolder(path), setting: sopFolderSetting() };
}

/**
 * Walk the SOP folder once and record what was seen. Returns what it did, for
 * the log; throws only when the database cannot be reached at all.
 */
export async function walkSopFolder(context: InvocationContext, source: SopFolderSource | { reason: string } = productionSource()): Promise<string> {
  if ("reason" in source) return `skipped: ${source.reason}`;
  const pool = await getPool();
  // Absent tables are an unmigrated environment, not a fault to retry in a
  // stack trace every morning.
  if (!(await surfaceReady(pool, DECISION_MATRIX_SURFACES.sopFolder))) return `skipped: migration ${DECISION_MATRIX_SURFACES.sopFolder.migration} has not been applied`;

  // A folder an Admin chose in the console wins; the setting only seeds an
  // environment where nobody has chosen one. Without this the walk dragged the
  // watch back to the configured folder every morning.
  const watched = await watchedSopLocation(pool, source.config);
  if (!watched && !source.setting.configured) return `skipped: ${source.setting.reason}`;
  const location = watched ?? await ensureSopLocation(pool, source.config.site_id, source.config.drive_id, (source.setting as { configured: true; folder_path: string }).folder_path);
  try {
    const walk = await walkLocation((path) => source.listFolder(path), location.folder_path);
    const recorded = await recordSopFolderWalk(pool, location, walk);
    return `walked ${location.folder_path || "the whole library"}: ${walk.outcome}${walk.complete ? "" : " (incomplete)"}, ${walk.folders_read} folders, added ${recorded.added}, changed ${recorded.changed}, returned ${recorded.returned}, gone ${recorded.disappeared}, unchanged ${recorded.unchanged}`;
  } catch (error) {
    context.error("Decision Matrix SOP folder walk failed", error);
    await recordSopFolderWalkFailure(pool, location, error instanceof Error ? `The SOP folder could not be walked: ${error.message}` : "The SOP folder could not be walked.");
    return "failed";
  }
}

export async function listUnreferencedSops(request: HttpRequest, context: InvocationContext) {
  const auth = await requireAccess(request, "decision-matrix.manage");
  if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  try {
    const pool = await getPool();
    // The report reads what walks recorded, not SharePoint, so a credential
    // that lapsed stops the next walk but not the report of the last one.
    const approved = approvedLibrary();
    return { status: 200, jsonBody: await unreferencedSopReport(pool, libraryConfig(), sopFolderSetting(), "reason" in approved ? approved.reason : null) };
  } catch (error) {
    context.error("GET Decision Matrix unreferenced SOPs failed", error);
    return { status: 500, jsonBody: { error: "Unreferenced SOPs are temporarily unavailable." } };
  }
}

app.timer("decisionMatrixSopFolderWalk", {
  // After the 05:00 document checks, inside the overnight gap in service, on a
  // single worker that also serves every endpoint. SOPs change during office
  // hours; nothing needs to know within the hour.
  schedule: "0 30 6 * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    const outcome = await walkSopFolder(context);
    if (outcome.startsWith("skipped")) context.warn(`Decision Matrix SOP folder walk ${outcome}`);
    else context.log(`Decision Matrix SOP folder walk ${outcome}`);
  },
});

/**
 * Point the SOP watch at a folder an Admin browsed to in the console.
 *
 * The folder is validated against the library before it is stored: a path that
 * SharePoint has no folder at would otherwise be accepted here and only fail
 * at 06:30 the next morning, which is how the configured `_SOPs` folder came
 * to be wrong for weeks without anyone being told.
 */
export async function chooseDecisionMatrixSopFolder(request: HttpRequest, context: InvocationContext) {
  const auth = await requireAccess(request, "decision-matrix.manage");
  if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  const actor = auth.principal.userId;
  if (!actor) return { status: 401, jsonBody: { error: "A stable Admin identity is required to choose the SOP folder." } };

  let body: { folder_path?: unknown; whole_library?: unknown };
  try { body = await request.json() as typeof body; } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON." } }; }
  const wholeLibrary = body.whole_library === true;
  if (!wholeLibrary && typeof body.folder_path !== "string") {
    return { status: 400, jsonBody: { error: "Send the folder_path to watch, or whole_library true for the entire library." } };
  }
  // "" is the library root, which is what whole_library means; the setting
  // spells it "/" because an app setting cannot hold an empty value.
  const requested = wholeLibrary ? "" : (body.folder_path as string);

  const pool = await getPool();
  const surface = DECISION_MATRIX_SURFACES.sopFolder;
  if (!(await surfaceReady(pool, surface))) {
    return { status: 503, jsonBody: { error: `Choosing the SOP folder needs migration ${surface.migration}.`, diagnostics: { required_migration: surface.migration } } };
  }
  const approved = approvedLibrary();
  if (!("library" in approved)) return { status: 409, jsonBody: { error: approved.reason } };

  // Does it exist? listFolder answers that and nothing else here depends on
  // the listing, so the refusal it reports is the refusal the Admin sees.
  const listing = await approved.library.listFolder(requested);
  if (listing.outcome === "not_found") return { status: 400, jsonBody: { error: listing.reason } };
  if (listing.outcome === "forbidden") return { status: 409, jsonBody: { error: listing.reason } };
  if (listing.outcome !== "ok") return { status: 503, jsonBody: { error: listing.reason } };

  try {
    const location = await chooseSopLocation(pool, approved.config, requested, actor);
    return {
      status: 200,
      jsonBody: {
        folder: location.folder_path,
        whole_library: location.folder_path === "",
        documents_in_folder: listing.entries.filter((entry) => entry.kind === "file").length,
        folders_in_folder: listing.entries.filter((entry) => entry.kind === "folder").length,
        // Nothing is known about the new folder until it is walked, and the
        // report will say so rather than reading as an empty result.
        walked: false,
      },
    };
  } catch (error) {
    context.error("Choosing the Decision Matrix SOP folder failed", error);
    return { status: 500, jsonBody: { error: "The SOP folder could not be changed." } };
  }
}

app.http("decisionMatrixUnreferencedSops", {
  route: "manage/decision-matrix/library/unreferenced",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: listUnreferencedSops,
});
app.http("decisionMatrixSopFolderChoice", { route: "manage/decision-matrix/library/sop-folder", methods: ["PUT"], authLevel: "anonymous", handler: chooseDecisionMatrixSopFolder });
