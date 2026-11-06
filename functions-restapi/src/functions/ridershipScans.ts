// Count Sheet scan capture (plans/count-sheet-scan-upload.md §4, increment
// S1; migrations 163 and 164). The rules are in lib/ridership/scan; these
// handlers check access and translate results into HTTP.
//
//   POST  /ridership/scans                       - ridership.scan
//     { file_name, size_bytes, garage } -> { upload_id, upload_url }: a
//     create-only SAS the browser PUTs the PDF to. Nothing is read yet.
//   POST  /ridership/scans/{uploadId}/submit     - ridership.scan
//     { sha256 }: the file is there at the size announced; queue it.
//   GET   /ridership/scans/{uploadId}            - ridership.scan
//     One upload's page outcomes (no images), for the page to poll.
//   GET   /ridership/scans?date=&garage=         - ridership.scan
//     The desk's view of a service date: recent uploads with their pages'
//     outcomes, and the garage's sheets with how far each is scanned.
//   PATCH /ridership/scan-pages/{pageId}          - ridership.scan
//     { action: "assign", service_date, block, sheet_page? } | { action: "ignore" } | { action: "blank" }
//   GET   /ridership/scan-pages/{pageId}/image    - ridership.scans.view
//     { url, expires_at }: a 5-minute link to the page image. Every call is
//     logged in RidershipScanViews before the link is made. JSON rather than
//     a redirect, because the console's API calls carry a bearer token that
//     an <img> request would not.
//
// The desk (Ridership Printer) holds ridership.scan and not scans.view: it
// sees which pages were recognised, never a page image.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { requireAccess } from "../lib/access/require";
import { publishScanWork } from "../lib/events";
import { agencyServiceDate } from "../lib/missedTripTime";
import { isServiceDate, ridershipTablesReady } from "../lib/ridership";
import { assignPage, createUpload, loadScanDesk, loadUpload, pageImageLink, scanTablesReady, submitUpload } from "../lib/ridership/scan";
import { ScanStorageNotConfiguredError, scanStorageConfigured } from "../lib/ridership/scan/storage";

const NOT_READY = {
  status: 503,
  jsonBody: { error: "Count Sheet scanning is not set up in this environment yet. Apply migrations 163 and 164." },
};
const NO_STORAGE = {
  status: 503,
  jsonBody: { error: "Count Sheet scanning has no storage account in this environment yet (RIDERSHIP_SCANS_STORAGE_ACCOUNT)." },
};

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const actorOf = (principal: { userDetails?: string | null }) => principal.userDetails || "system";

async function readJson(request: HttpRequest): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false };
  }
}

async function ready(): Promise<"ok" | typeof NOT_READY> {
  const pool = await getPool();
  return (await ridershipTablesReady(pool)) && (await scanTablesReady(pool)) ? "ok" : NOT_READY;
}

app.http("ridershipScanCreate", {
  route: "ridership/scans",
  methods: ["POST"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = await requireAccess(request, "ridership.scan");
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const json = await readJson(request);
    if (!json.ok) return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
    try {
      if ((await ready()) !== "ok") return NOT_READY;
      if (!scanStorageConfigured()) return NO_STORAGE;
      const result = await createUpload(await getPool(), json.body, actorOf(auth.principal));
      if (result.kind === "invalid") return { status: 400, jsonBody: { error: result.message } };
      return { status: 201, jsonBody: { upload_id: result.upload_id, upload_url: result.upload_url } };
    } catch (err) {
      if (err instanceof ScanStorageNotConfiguredError) return NO_STORAGE;
      context.error("POST /ridership/scans failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("ridershipScanSubmit", {
  route: "ridership/scans/{uploadId}/submit",
  methods: ["POST"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = await requireAccess(request, "ridership.scan");
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const uploadId = request.params.uploadId ?? "";
    if (!GUID.test(uploadId)) return { status: 400, jsonBody: { error: "uploadId must be an upload id." } };
    const json = await readJson(request);
    if (!json.ok) return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
    try {
      if ((await ready()) !== "ok") return NOT_READY;
      const result = await submitUpload(await getPool(), uploadId, json.body, (id) => publishScanWork({ kind: "upload", upload_id: id }, context));
      switch (result.kind) {
        case "not_found": return { status: 404, jsonBody: { error: "No such upload." } };
        case "invalid": return { status: 400, jsonBody: { error: result.message } };
        case "queue_unavailable": return { status: 503, jsonBody: { error: "The file is stored, but it could not be queued for processing. Submit it again in a minute." } };
        case "queued": return { status: 202, jsonBody: result.upload };
      }
    } catch (err) {
      if (err instanceof ScanStorageNotConfiguredError) return NO_STORAGE;
      context.error("POST /ridership/scans/{id}/submit failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("ridershipScanGet", {
  route: "ridership/scans/{uploadId}",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = await requireAccess(request, "ridership.scan");
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const uploadId = request.params.uploadId ?? "";
    if (!GUID.test(uploadId)) return { status: 400, jsonBody: { error: "uploadId must be an upload id." } };
    try {
      if ((await ready()) !== "ok") return NOT_READY;
      const upload = await loadUpload(await getPool(), uploadId);
      return upload ? { status: 200, jsonBody: upload } : { status: 404, jsonBody: { error: "No such upload." } };
    } catch (err) {
      context.error("GET /ridership/scans/{id} failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("ridershipScanDesk", {
  route: "ridership/scans",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = await requireAccess(request, "ridership.scan");
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    // The default is today: a desk scans the shift's sheets as they come in.
    const date = request.query.get("date")?.trim() || agencyServiceDate(new Date()).serviceDate;
    if (!isServiceDate(date)) return { status: 400, jsonBody: { error: "date must be a calendar day as YYYYMMDD." } };
    const raw = request.query.get("garage");
    const garage = raw === null ? undefined : raw.trim() === "" ? null : raw.trim();
    try {
      if ((await ready()) !== "ok") return NOT_READY;
      return { status: 200, jsonBody: await loadScanDesk(await getPool(), date, garage) };
    } catch (err) {
      context.error("GET /ridership/scans failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("ridershipScanPageAssign", {
  route: "ridership/scan-pages/{pageId}",
  methods: ["PATCH"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = await requireAccess(request, "ridership.scan");
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const pageId = request.params.pageId ?? "";
    if (!GUID.test(pageId)) return { status: 400, jsonBody: { error: "pageId must be a page id." } };
    const json = await readJson(request);
    if (!json.ok) return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
    try {
      if ((await ready()) !== "ok") return NOT_READY;
      const result = await assignPage(await getPool(), pageId, json.body, actorOf(auth.principal));
      switch (result.kind) {
        case "not_found": return { status: 404, jsonBody: { error: "No such page." } };
        case "invalid": return { status: 400, jsonBody: { error: result.message } };
        case "conflict": return { status: 409, jsonBody: { error: result.message } };
        case "saved": return { status: 200, jsonBody: result.page };
      }
    } catch (err) {
      context.error("PATCH /ridership/scan-pages/{id} failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("ridershipScanPageImage", {
  route: "ridership/scan-pages/{pageId}/image",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = await requireAccess(request, "ridership.scans.view");
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const pageId = request.params.pageId ?? "";
    if (!GUID.test(pageId)) return { status: 400, jsonBody: { error: "pageId must be a page id." } };
    try {
      if ((await ready()) !== "ok") return NOT_READY;
      if (!scanStorageConfigured()) return NO_STORAGE;
      const result = await pageImageLink(await getPool(), pageId, actorOf(auth.principal));
      if (result.kind === "not_found") return { status: 404, jsonBody: { error: "No such page." } };
      if (result.kind === "no_image") return { status: 404, jsonBody: { error: "This page has no image: it was a blank back, or is not processed yet." } };
      return { status: 200, jsonBody: { url: result.url, expires_at: result.expires_at }, headers: { "Cache-Control": "no-store" } };
    } catch (err) {
      if (err instanceof ScanStorageNotConfiguredError) return NO_STORAGE;
      context.error("GET /ridership/scan-pages/{id}/image failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
