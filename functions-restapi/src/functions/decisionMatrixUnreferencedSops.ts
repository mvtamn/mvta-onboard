import { app, type HttpRequest, type InvocationContext, type Timer } from "@azure/functions";
import { ADMIN_ROLES, requireRole } from "../lib/auth";
import { getPool } from "../lib/db";
import { walkLocation } from "../lib/decisionMatrixLocationSync";
import { DECISION_MATRIX_SURFACES, surfaceReady } from "../lib/decisionMatrixReadiness";
import type { LibraryConfig, LibraryListing } from "../lib/sharepointLibrary";
import { ensureSopLocation, recordSopFolderWalk, recordSopFolderWalkFailure, sopFolderSetting, unreferencedSopReport, type SopFolderSetting } from "../lib/unreferencedSops";
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
  const setting = sopFolderSetting();
  if (!setting.configured) return { reason: setting.reason };
  return { config: approved.config, listFolder: (path) => approved.library.listFolder(path), setting };
}

/**
 * Walk the SOP folder once and record what was seen. Returns what it did, for
 * the log; throws only when the database cannot be reached at all.
 */
export async function walkSopFolder(context: InvocationContext, source: SopFolderSource | { reason: string } = productionSource()): Promise<string> {
  if ("reason" in source) return `skipped: ${source.reason}`;
  if (!source.setting.configured) return `skipped: ${source.setting.reason}`;
  const pool = await getPool();
  // Absent tables are an unmigrated environment, not a fault to retry in a
  // stack trace every morning.
  if (!(await surfaceReady(pool, DECISION_MATRIX_SURFACES.sopFolder))) return `skipped: migration ${DECISION_MATRIX_SURFACES.sopFolder.migration} has not been applied`;

  const location = await ensureSopLocation(pool, source.config.site_id, source.config.drive_id, source.setting.folder_path);
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
  const auth = requireRole(request, ADMIN_ROLES);
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

app.http("decisionMatrixUnreferencedSops", {
  route: "manage/decision-matrix/library/unreferenced",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: listUnreferencedSops,
});
