// Count Sheet scan capture (plans/count-sheet-scan-upload.md, increment S1;
// migrations 163 and 164). The desk uploads a batch PDF; a queue worker
// splits it and identifies each page; OCC sees the page beside the sheet.
// Nothing handwritten is read and nothing here writes a count: a scan is
// evidence beside the sheet, and `entered_at` stays the time a person saved
// it (decision 4).
//
// The flow:
//   createUpload   POST   - a row, and a create-only SAS for the original
//   submitUpload   POST   - the file is there at the size claimed: queue it
//   splitUpload    worker - check the SHA-256, count pages, queue each page
//   processPage    worker - straighten, identify, store the image, decide
//                           matched / duplicate / superseded / blank / unreadable
//   assignPage     PATCH  - a person names an unreadable page, or sets it aside
//   pageImageLink  GET    - a 5-minute link to a page image, logged
import { randomUUID } from "node:crypto";
import { sql } from "../../db";
import type { Executor } from "../../otpMonth";
import { agencyServiceDate } from "../../missedTripTime";
import { pageCount } from "../print";
import { garageOn, isServiceDate, normalizeBlock } from "../rules";
import { loadBlockGarages, loadLoggedTrips } from "../store";
import { dateLooksWrong, duplicateOutcome, type PageState } from "./identify";
import { analysePage, candidatesFrom, type PageAnalysis } from "./pipeline";
import { pdfPageCount } from "./raster";
import { originalBlobPath, originalSize, originalUploadUrl, pageBlobPath, pageImageUrl, readOriginal, sha256Hex, writePageImage } from "./storage";

const request = (executor: Executor) => (executor instanceof sql.Transaction ? new sql.Request(executor) : executor.request());

export const SCAN_TABLES = ["RidershipScanUploads", "RidershipScanPages", "RidershipScanViews"] as const;

/** Whether migration 163 has landed. Without it the scan endpoints answer 503 and sheets carry no scan. */
export async function scanTablesReady(executor: Executor): Promise<boolean> {
  const checks = SCAN_TABLES.map((t) => `OBJECT_ID('dbo.${t}', 'U') IS NOT NULL`).join(" AND ");
  const result = await request(executor).query<{ ok: number }>(`SELECT CASE WHEN ${checks} THEN 1 ELSE 0 END AS ok`);
  return result.recordset[0]?.ok === 1;
}

/** A garage MFP batch is a shift's sheets, about 70 at most; allow rescans and blank backs. */
export const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;
export const MAX_PAGES = 400;

export type UploadStatus = "awaiting" | "queued" | "splitting" | "processing" | "done" | "failed";

export interface ScanPageView {
  page_id: string;
  /** 1-based page of the uploaded file, which is how the desk finds it in the stack. */
  page_number: number;
  state: PageState;
  reason: string | null;
  service_date: string | null;
  block: string | null;
  sheet_page: number | null;
  identified_by: "qr" | "printed_text" | "person" | null;
  straightened: boolean;
  /** The print run's time as printed in the footer; null when the run is not known. */
  printed_at: string | null;
  date_flag: boolean;
  processed_at: string | null;
  assigned_by: string | null;
}

export interface ScanUploadView {
  upload_id: string;
  garage: string | null;
  file_name: string;
  status: UploadStatus;
  status_detail: string | null;
  page_count: number | null;
  created_at: string;
  created_by: string;
  pages: ScanPageView[];
}

// ---------------------------------------------------------------- upload

export type CreateUploadResult =
  | { kind: "created"; upload_id: string; upload_url: string }
  | { kind: "invalid"; message: string };

export function checkUploadRequest(body: unknown): { file_name: string; size_bytes: number; garage: string | null } | { error: string } {
  if (!body || typeof body !== "object") return { error: "Request body must be an object." };
  const b = body as Record<string, unknown>;
  const fileName = typeof b.file_name === "string" ? b.file_name.trim() : "";
  if (!fileName || fileName.length > 200) return { error: "file_name must name the file, in at most 200 characters." };
  if (!/\.pdf$/i.test(fileName) || (b.content_type !== undefined && b.content_type !== "application/pdf")) {
    return { error: "Upload the MFP's PDF. Photos and other formats come later." };
  }
  const size = b.size_bytes;
  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0 || size > MAX_UPLOAD_BYTES) {
    return { error: `size_bytes must be the file's size, up to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` };
  }
  if (b.garage !== undefined && b.garage !== null && (typeof b.garage !== "string" || b.garage.trim().length > 50)) {
    return { error: "garage must be a garage name of at most 50 characters." };
  }
  const garage = typeof b.garage === "string" && b.garage.trim() !== "" ? b.garage.trim() : null;
  return { file_name: fileName, size_bytes: size, garage };
}

export async function createUpload(pool: sql.ConnectionPool, body: unknown, actor: string, now = new Date()): Promise<CreateUploadResult> {
  const checked = checkUploadRequest(body);
  if ("error" in checked) return { kind: "invalid", message: checked.error };
  const uploadId = randomUUID();
  const blobPath = originalBlobPath(uploadId, now);
  // The SAS first: with storage unset this throws before any row is written.
  const uploadUrl = await originalUploadUrl(blobPath);
  const req = pool.request();
  req.input("id", sql.UniqueIdentifier, uploadId);
  req.input("garage", sql.NVarChar(50), checked.garage);
  req.input("file_name", sql.NVarChar(260), checked.file_name);
  req.input("blob_path", sql.NVarChar(400), blobPath);
  req.input("size", sql.BigInt, checked.size_bytes);
  req.input("day", sql.Char(8), agencyServiceDate(now).serviceDate);
  req.input("at", sql.DateTime2, now);
  req.input("by", sql.NVarChar(200), actor);
  await req.query(`
    INSERT dbo.RidershipScanUploads (upload_id, garage, file_name, blob_path, size_bytes, upload_day, created_at, created_by)
    VALUES (@id, @garage, @file_name, @blob_path, @size, @day, @at, @by)
  `);
  return { kind: "created", upload_id: uploadId, upload_url: uploadUrl };
}

export type SubmitResult =
  | { kind: "queued"; upload: ScanUploadView }
  | { kind: "not_found" }
  | { kind: "invalid"; message: string }
  | { kind: "queue_unavailable" };

/**
 * The browser has written the file. Its size must be what was claimed and its
 * SHA-256 well-formed; the worker checks the hash against the stored bytes
 * before reading a page, so a file changed or cut short in between fails
 * there rather than being read.
 */
export async function submitUpload(
  pool: sql.ConnectionPool,
  uploadId: string,
  body: unknown,
  publish: (uploadId: string) => Promise<boolean>,
  now = new Date(),
): Promise<SubmitResult> {
  const sha = body && typeof body === "object" ? (body as Record<string, unknown>).sha256 : undefined;
  if (typeof sha !== "string" || !/^[0-9a-f]{64}$/.test(sha)) return { kind: "invalid", message: "sha256 must be the file's SHA-256 as 64 lower-case hex digits." };
  const upload = await loadUploadRow(pool, uploadId);
  if (!upload) return { kind: "not_found" };
  if (upload.status === "awaiting") {
    const size = await originalSize(upload.blob_path);
    if (size === null) return { kind: "invalid", message: "The file has not arrived in storage. Upload it again." };
    if (size !== Number(upload.size_bytes)) return { kind: "invalid", message: `The stored file is ${size} bytes, not the ${upload.size_bytes} announced. Upload it again.` };
    const req = pool.request();
    req.input("id", sql.UniqueIdentifier, uploadId);
    req.input("sha", sql.Char(64), sha);
    req.input("at", sql.DateTime2, now);
    await req.query(`UPDATE dbo.RidershipScanUploads SET sha256 = @sha, status = 'queued', submitted_at = @at WHERE upload_id = @id AND status = 'awaiting'`);
  } else if (upload.sha256 !== sha) {
    return { kind: "invalid", message: "This upload was already submitted with a different file." };
  }
  // Queued again on a repeat submit too: a lost message is resent, and the
  // worker skips work already done.
  if ((upload.status === "awaiting" || upload.status === "queued") && !(await publish(uploadId))) return { kind: "queue_unavailable" };
  return { kind: "queued", upload: (await loadUpload(pool, uploadId))! };
}

// ---------------------------------------------------------------- worker

interface UploadRow {
  upload_id: string;
  garage: string | null;
  file_name: string;
  blob_path: string;
  size_bytes: string | number | null;
  sha256: string | null;
  page_count: number | null;
  status: UploadStatus;
  status_detail: string | null;
  upload_day: string;
  created_at: Date;
  created_by: string;
}

async function loadUploadRow(executor: Executor, uploadId: string): Promise<UploadRow | null> {
  const req = request(executor);
  req.input("id", sql.UniqueIdentifier, uploadId);
  const r = await req.query<UploadRow>(`
    SELECT LOWER(CONVERT(NVARCHAR(36), upload_id)) AS upload_id, garage, file_name, blob_path, size_bytes, sha256, page_count,
           status, status_detail, upload_day, created_at, created_by
    FROM dbo.RidershipScanUploads WHERE upload_id = @id
  `);
  return r.recordset[0] ?? null;
}

async function failUpload(pool: sql.ConnectionPool, uploadId: string, detail: string): Promise<void> {
  const req = pool.request();
  req.input("id", sql.UniqueIdentifier, uploadId);
  req.input("detail", sql.NVarChar(400), detail.slice(0, 400));
  await req.query(`UPDATE dbo.RidershipScanUploads SET status = 'failed', status_detail = @detail, completed_at = SYSUTCDATETIME() WHERE upload_id = @id`);
}

/**
 * The upload message: check the stored bytes, count the pages, make a row
 * for each and queue it. Safe to run twice: rows are made only when missing,
 * and every page still pending is queued again.
 */
export async function splitUpload(
  pool: sql.ConnectionPool,
  uploadId: string,
  publishPage: (pageId: string) => Promise<boolean>,
  read: (blobPath: string, sha256: string) => Promise<Buffer> = readOriginal,
): Promise<"split" | "skipped" | "failed"> {
  const upload = await loadUploadRow(pool, uploadId);
  if (!upload || !upload.sha256 || !["queued", "splitting", "processing"].includes(upload.status)) return "skipped";
  await setStatus(pool, uploadId, "splitting");
  let pages: number;
  try {
    const bytes = await read(upload.blob_path, upload.sha256);
    pages = await pdfPageCount(bytes);
  } catch (err) {
    await failUpload(pool, uploadId, /SHA-256/.test(String(err)) ? "The stored file does not match the one the browser sent. Upload it again." : "This file could not be opened as a PDF.");
    return "failed";
  }
  if (pages < 1 || pages > MAX_PAGES) {
    await failUpload(pool, uploadId, `The PDF has ${pages} pages; a batch can have 1 to ${MAX_PAGES}.`);
    return "failed";
  }
  const req = pool.request();
  req.input("id", sql.UniqueIdentifier, uploadId);
  req.input("pages", sql.Int, pages);
  await req.query(`
    WITH n AS (SELECT TOP (@pages) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 AS i FROM sys.all_objects a CROSS JOIN sys.all_objects b)
    INSERT dbo.RidershipScanPages (upload_id, page_index)
    SELECT @id, n.i FROM n
    WHERE NOT EXISTS (SELECT 1 FROM dbo.RidershipScanPages p WHERE p.upload_id = @id AND p.page_index = n.i);
    UPDATE dbo.RidershipScanUploads SET page_count = @pages, status = 'processing' WHERE upload_id = @id;
  `);
  const pending = await pool.request().input("id", sql.UniqueIdentifier, uploadId).query<{ page_id: string }>(
    `SELECT LOWER(CONVERT(NVARCHAR(36), page_id)) AS page_id FROM dbo.RidershipScanPages WHERE upload_id = @id AND state = 'pending' ORDER BY page_index`,
  );
  for (const p of pending.recordset) {
    if (!(await publishPage(p.page_id))) throw new Error(`Could not queue page ${p.page_id}; the upload message will be retried.`);
  }
  await finishUploadIfDone(pool, uploadId);
  return "split";
}

async function setStatus(pool: sql.ConnectionPool, uploadId: string, status: UploadStatus): Promise<void> {
  const req = pool.request();
  req.input("id", sql.UniqueIdentifier, uploadId);
  req.input("status", sql.NVarChar(12), status);
  await req.query(`UPDATE dbo.RidershipScanUploads SET status = @status WHERE upload_id = @id AND status NOT IN ('done', 'failed')`);
}

async function finishUploadIfDone(executor: Executor, uploadId: string): Promise<void> {
  const req = request(executor);
  req.input("id", sql.UniqueIdentifier, uploadId);
  await req.query(`
    UPDATE dbo.RidershipScanUploads SET status = 'done', completed_at = SYSUTCDATETIME()
    WHERE upload_id = @id AND status = 'processing'
      AND NOT EXISTS (SELECT 1 FROM dbo.RidershipScanPages p WHERE p.upload_id = @id AND p.state = 'pending')
  `);
}

interface PageRow {
  page_id: string;
  upload_id: string;
  page_index: number;
  state: PageState;
  blob_path: string;
  sha256: string;
  upload_day: string;
}

/** The print log's runs for a sheet, newest first. */
async function printRunsFor(executor: Executor, serviceDate: string, block: string): Promise<{ print_id: string; printed_at: Date }[]> {
  if ((await request(executor).query<{ ok: number }>("SELECT CASE WHEN OBJECT_ID('dbo.RidershipPrintedSheets', 'U') IS NULL THEN 0 ELSE 1 END AS ok")).recordset[0]?.ok !== 1) return [];
  const req = request(executor);
  req.input("date", sql.Char(8), serviceDate);
  req.input("block", sql.Char(3), block);
  const r = await req.query<{ print_id: string; printed_at: Date }>(`
    SELECT LOWER(CONVERT(NVARCHAR(36), r.print_id)) AS print_id, r.printed_at
    FROM dbo.RidershipPrintedSheets s JOIN dbo.RidershipPrintRuns r ON r.print_id = s.print_id
    WHERE s.service_date = @date AND s.block = @block
    ORDER BY r.printed_at DESC
  `);
  return r.recordset;
}

/**
 * Records where an identified page stands against the other scans of the same
 * sheet page, inside a transaction holding an app lock on that sheet page, so
 * two copies processed at once cannot both become the sheet's page.
 */
async function recordIdentified(
  pool: sql.ConnectionPool,
  page: PageRow,
  found: {
    serviceDate: string;
    block: string;
    sheetPage: number;
    identifiedBy: "qr" | "printed_text" | "person";
    printId: string | null;
    qrText?: string | null;
    footer?: string | null;
    straightened?: boolean;
    imagePath?: string | null;
    assignedBy?: string | null;
  },
): Promise<PageState> {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const lock = new sql.Request(tx);
    lock.input("resource", sql.NVarChar(255), `ridership-scan:${found.serviceDate}:${found.block}:${found.sheetPage}`);
    await lock.query(`EXEC sp_getapplock @Resource = @resource, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 30000`);

    const existing = new sql.Request(tx);
    existing.input("date", sql.Char(8), found.serviceDate);
    existing.input("block", sql.Char(3), found.block);
    existing.input("sheet_page", sql.TinyInt, found.sheetPage);
    existing.input("page", sql.UniqueIdentifier, page.page_id);
    const others = await existing.query<{ page_id: string; printed_at: Date | null }>(`
      SELECT LOWER(CONVERT(NVARCHAR(36), p.page_id)) AS page_id, r.printed_at
      FROM dbo.RidershipScanPages p LEFT JOIN dbo.RidershipPrintRuns r ON r.print_id = p.print_id
      WHERE p.service_date = @date AND p.block = @block AND p.sheet_page = @sheet_page AND p.state = 'matched' AND p.page_id <> @page
    `);
    let printedAt: Date | null = null;
    if (found.printId) {
      const run = await new sql.Request(tx).input("id", sql.UniqueIdentifier, found.printId).query<{ printed_at: Date }>("SELECT printed_at FROM dbo.RidershipPrintRuns WHERE print_id = @id");
      printedAt = run.recordset[0]?.printed_at ?? null;
    }
    const outcome = duplicateOutcome(others.recordset, printedAt);
    for (const id of outcome.supersede) {
      await new sql.Request(tx).input("id", sql.UniqueIdentifier, id).query("UPDATE dbo.RidershipScanPages SET state = 'superseded' WHERE page_id = @id AND state = 'matched'");
    }
    const req = new sql.Request(tx);
    req.input("id", sql.UniqueIdentifier, page.page_id);
    req.input("state", sql.NVarChar(12), outcome.state);
    req.input("date", sql.Char(8), found.serviceDate);
    req.input("block", sql.Char(3), found.block);
    req.input("sheet_page", sql.TinyInt, found.sheetPage);
    req.input("by", sql.NVarChar(12), found.identifiedBy);
    req.input("print", sql.UniqueIdentifier, found.printId);
    req.input("date_flag", sql.Bit, dateLooksWrong(found.serviceDate, page.upload_day));
    req.input("assigned_by", sql.NVarChar(200), found.assignedBy ?? null);
    if (found.assignedBy) {
      await req.query(`
        UPDATE dbo.RidershipScanPages SET state = @state, reason = NULL, service_date = @date, block = @block, sheet_page = @sheet_page,
          identified_by = @by, print_id = @print, date_flag = @date_flag, assigned_by = @assigned_by, assigned_at = SYSUTCDATETIME()
        WHERE page_id = @id
      `);
    } else {
      req.input("qr", sql.NVarChar(400), found.qrText ?? null);
      req.input("footer", sql.NVarChar(40), found.footer ?? null);
      req.input("straight", sql.Bit, Boolean(found.straightened));
      req.input("image", sql.NVarChar(400), found.imagePath ?? null);
      await req.query(`
        UPDATE dbo.RidershipScanPages SET state = @state, reason = NULL, service_date = @date, block = @block, sheet_page = @sheet_page,
          identified_by = @by, print_id = @print, date_flag = @date_flag, qr_text = @qr, footer_text = @footer,
          straightened = @straight, image_path = @image, processed_at = SYSUTCDATETIME(), attempts = attempts + 1
        WHERE page_id = @id AND state = 'pending'
      `);
    }
    await tx.commit();
    return outcome.state;
  } catch (err) {
    await tx.rollback().catch(() => undefined);
    throw err;
  }
}

export interface ProcessDeps {
  read?: (blobPath: string, sha256: string) => Promise<Buffer>;
  writeImage?: (blobPath: string, jpeg: Buffer) => Promise<void>;
  analyse?: typeof analysePage;
}

/**
 * The page message. A page already processed is skipped, so a redelivered
 * message does nothing twice; the image is written before the row, so a
 * crash between the two leaves the page pending and the retry rewrites it.
 */
export async function processPage(pool: sql.ConnectionPool, pageId: string, deps: ProcessDeps = {}): Promise<PageState | "skipped"> {
  const req = pool.request();
  req.input("id", sql.UniqueIdentifier, pageId);
  const r = await req.query<PageRow>(`
    SELECT LOWER(CONVERT(NVARCHAR(36), p.page_id)) AS page_id, LOWER(CONVERT(NVARCHAR(36), p.upload_id)) AS upload_id, p.page_index, p.state,
           u.blob_path, u.sha256, u.upload_day
    FROM dbo.RidershipScanPages p JOIN dbo.RidershipScanUploads u ON u.upload_id = p.upload_id
    WHERE p.page_id = @id
  `);
  const page = r.recordset[0];
  if (!page || page.state !== "pending") return "skipped";

  const bytes = await (deps.read ?? readOriginal)(page.blob_path, page.sha256);
  const analysis: PageAnalysis = await (deps.analyse ?? analysePage)(bytes, page.page_index, {
    printRuns: async (date, block) => candidatesFrom(await printRunsFor(pool, date, block)),
  });

  let state: PageState;
  if (analysis.kind === "blank") {
    await updatePending(pool, page.page_id, "blank", null, null, false);
    state = "blank";
  } else {
    const imagePath = pageBlobPath(page.upload_id, page.page_index);
    await (deps.writeImage ?? writePageImage)(imagePath, analysis.jpeg);
    if (analysis.kind === "unreadable") {
      await updatePending(pool, page.page_id, "unreadable", analysis.reason, imagePath, false);
      state = "unreadable";
    } else {
      state = await recordIdentified(pool, page, {
        ...analysis.identity,
        identifiedBy: analysis.identifiedBy,
        printId: analysis.printId,
        qrText: analysis.qrText,
        footer: analysis.footer,
        straightened: analysis.straightened,
        imagePath,
      });
    }
  }
  await finishUploadIfDone(pool, page.upload_id);
  return state;
}

async function updatePending(pool: sql.ConnectionPool, pageId: string, state: PageState, reason: string | null, imagePath: string | null, straightened: boolean): Promise<void> {
  const req = pool.request();
  req.input("id", sql.UniqueIdentifier, pageId);
  req.input("state", sql.NVarChar(12), state);
  req.input("reason", sql.NVarChar(40), reason);
  req.input("image", sql.NVarChar(400), imagePath);
  req.input("straight", sql.Bit, straightened);
  await req.query(`
    UPDATE dbo.RidershipScanPages SET state = @state, reason = @reason, image_path = @image, straightened = @straight,
      processed_at = SYSUTCDATETIME(), attempts = attempts + 1
    WHERE page_id = @id AND state = 'pending'
  `);
}

/** After the last delivery fails: the page goes to a person rather than staying pending for ever. */
export async function giveUpOnPage(pool: sql.ConnectionPool, pageId: string): Promise<void> {
  await updatePending(pool, pageId, "unreadable", "processing_failed", null, false);
  const r = await pool.request().input("id", sql.UniqueIdentifier, pageId).query<{ upload_id: string }>(
    "SELECT LOWER(CONVERT(NVARCHAR(36), upload_id)) AS upload_id FROM dbo.RidershipScanPages WHERE page_id = @id",
  );
  if (r.recordset[0]) await finishUploadIfDone(pool, r.recordset[0].upload_id);
}

export async function giveUpOnUpload(pool: sql.ConnectionPool, uploadId: string): Promise<void> {
  await failUpload(pool, uploadId, "The file could not be processed. Upload it again; if it fails twice, tell OnBoard support.");
}

// ---------------------------------------------------------------- a person's word

export type AssignResult = { kind: "saved"; page: ScanPageView } | { kind: "not_found" } | { kind: "invalid"; message: string } | { kind: "conflict"; message: string };

/**
 * PATCH a page: `{ action: "assign", service_date, block, sheet_page? }`
 * names an unreadable page from the paper; `{ action: "ignore" }` sets a page
 * aside; `{ action: "blank" }` marks one blank. Only an unreadable page, or
 * one a person already handled, can be changed: a page the code identified is
 * not overridden from the desk.
 */
export async function assignPage(pool: sql.ConnectionPool, pageId: string, body: unknown, actor: string): Promise<AssignResult> {
  if (!body || typeof body !== "object") return { kind: "invalid", message: "Request body must be an object." };
  const b = body as Record<string, unknown>;
  const req = pool.request();
  req.input("id", sql.UniqueIdentifier, pageId);
  const r = await req.query<PageRow & { assigned_by: string | null }>(`
    SELECT LOWER(CONVERT(NVARCHAR(36), p.page_id)) AS page_id, LOWER(CONVERT(NVARCHAR(36), p.upload_id)) AS upload_id, p.page_index, p.state,
           p.assigned_by, u.blob_path, u.sha256, u.upload_day
    FROM dbo.RidershipScanPages p JOIN dbo.RidershipScanUploads u ON u.upload_id = p.upload_id WHERE p.page_id = @id
  `);
  const page = r.recordset[0];
  if (!page) return { kind: "not_found" };
  // A person's earlier word can be corrected; the code's cannot be overridden from here.
  const personsPage = page.assigned_by !== null;
  if (page.state !== "unreadable" && !personsPage) {
    return { kind: "conflict", message: page.state === "pending" ? "This page has not been processed yet." : "This page was identified from its code; it cannot be reassigned here." };
  }

  if (b.action === "ignore" || b.action === "blank") {
    const u = pool.request();
    u.input("id", sql.UniqueIdentifier, pageId);
    u.input("state", sql.NVarChar(12), b.action === "ignore" ? "ignored" : "blank");
    u.input("by", sql.NVarChar(200), actor);
    await u.query(`
      UPDATE dbo.RidershipScanPages SET state = @state, service_date = NULL, block = NULL, sheet_page = NULL, identified_by = NULL,
        print_id = NULL, date_flag = 0, assigned_by = @by, assigned_at = SYSUTCDATETIME()
      WHERE page_id = @id
    `);
  } else if (b.action === "assign") {
    const serviceDate = typeof b.service_date === "string" ? b.service_date.trim() : "";
    const block = typeof b.block === "string" ? normalizeBlock(b.block) : null;
    const sheetPage = b.sheet_page === undefined ? 1 : b.sheet_page;
    if (!isServiceDate(serviceDate)) return { kind: "invalid", message: "service_date must be the sheet's date as YYYYMMDD." };
    if (!block) return { kind: "invalid", message: "block must be the sheet's block number, up to three digits." };
    if (typeof sheetPage !== "number" || !Number.isInteger(sheetPage) || sheetPage < 1 || sheetPage > 9) return { kind: "invalid", message: "sheet_page must be 1 to 9." };
    // No footer is read here, so the run is known only when the sheet was printed once.
    const runs = await printRunsFor(pool, serviceDate, block);
    await recordIdentified(pool, page, {
      serviceDate,
      block,
      sheetPage,
      identifiedBy: "person",
      printId: runs.length === 1 ? runs[0].print_id : null,
      assignedBy: actor,
    });
  } else {
    return { kind: "invalid", message: "action must be assign, ignore or blank." };
  }
  const view = (await loadPages(pool, { pageId }))[0];
  return { kind: "saved", page: view };
}

// ---------------------------------------------------------------- reads

interface PageViewRow {
  page_id: string;
  upload_id: string;
  page_index: number;
  state: PageState;
  reason: string | null;
  service_date: string | null;
  block: string | null;
  sheet_page: number | null;
  identified_by: ScanPageView["identified_by"];
  straightened: boolean;
  printed_at: Date | null;
  date_flag: boolean;
  processed_at: Date | null;
  assigned_by: string | null;
}

function pageView(row: PageViewRow): ScanPageView {
  return {
    page_id: row.page_id,
    page_number: row.page_index + 1,
    state: row.state,
    reason: row.reason,
    service_date: row.service_date,
    block: row.block,
    sheet_page: row.sheet_page,
    identified_by: row.identified_by,
    straightened: Boolean(row.straightened),
    printed_at: row.printed_at ? new Date(row.printed_at).toISOString() : null,
    date_flag: Boolean(row.date_flag),
    processed_at: row.processed_at ? new Date(row.processed_at).toISOString() : null,
    assigned_by: row.assigned_by,
  };
}

async function loadPages(executor: Executor, where: { pageId?: string; uploadIds?: string[]; sheet?: { serviceDate: string; block: string } }): Promise<(ScanPageView & { upload_id: string })[]> {
  const req = request(executor);
  let filter: string;
  if (where.pageId) {
    req.input("id", sql.UniqueIdentifier, where.pageId);
    filter = "p.page_id = @id";
  } else if (where.sheet) {
    req.input("date", sql.Char(8), where.sheet.serviceDate);
    req.input("block", sql.Char(3), where.sheet.block);
    filter = "p.service_date = @date AND p.block = @block";
  } else {
    const ids = where.uploadIds ?? [];
    if (ids.length === 0) return [];
    ids.forEach((id, i) => req.input(`u${i}`, sql.UniqueIdentifier, id));
    filter = `p.upload_id IN (${ids.map((_, i) => `@u${i}`).join(", ")})`;
  }
  const r = await req.query<PageViewRow>(`
    SELECT LOWER(CONVERT(NVARCHAR(36), p.page_id)) AS page_id, LOWER(CONVERT(NVARCHAR(36), p.upload_id)) AS upload_id, p.page_index, p.state, p.reason,
           p.service_date, p.block, p.sheet_page, p.identified_by, p.straightened, r.printed_at, p.date_flag, p.processed_at, p.assigned_by
    FROM dbo.RidershipScanPages p LEFT JOIN dbo.RidershipPrintRuns r ON r.print_id = p.print_id
    WHERE ${filter}
    ORDER BY p.upload_id, p.page_index
  `);
  return r.recordset.map((row) => ({ ...pageView(row), upload_id: row.upload_id }));
}

function uploadView(row: UploadRow, pages: ScanPageView[]): ScanUploadView {
  return {
    upload_id: row.upload_id,
    garage: row.garage,
    file_name: row.file_name,
    status: row.status,
    status_detail: row.status_detail,
    page_count: row.page_count,
    created_at: new Date(row.created_at).toISOString(),
    created_by: row.created_by,
    pages,
  };
}

export async function loadUpload(executor: Executor, uploadId: string): Promise<ScanUploadView | null> {
  const row = await loadUploadRow(executor, uploadId);
  if (!row) return null;
  return uploadView(row, (await loadPages(executor, { uploadIds: [uploadId] })).map(({ upload_id: _, ...p }) => p));
}

export interface ExpectedSheet {
  block: string;
  pages: number;
  /** Pages of the sheet with a matched scan. */
  scanned_pages: number;
}

export interface ScanDesk {
  service_date: string;
  garage: string | null;
  uploads: ScanUploadView[];
  /** The garage's sheets on the date (its blocks with Dispatch Log trips), and how many of each one's pages are scanned. */
  expected: ExpectedSheet[];
  /** Pages from these uploads still waiting for a person. */
  unassigned: number;
}

/**
 * The upload page: the garage's uploads from the day before the service date
 * to two days after (a desk scans the evening's sheets that night or the next
 * morning), each with its pages' outcomes and no image; and the garage's
 * expected sheets for the date with how far each is scanned.
 */
export async function loadScanDesk(executor: Executor, serviceDate: string, garage: string | null | undefined): Promise<ScanDesk> {
  const req = request(executor);
  req.input("from", sql.Char(8), shiftDay(serviceDate, -1));
  req.input("to", sql.Char(8), shiftDay(serviceDate, 2));
  let garageFilter = "";
  if (garage !== undefined) {
    req.input("garage", sql.NVarChar(50), garage);
    garageFilter = garage === null ? "AND garage IS NULL" : "AND garage = @garage";
  }
  const uploads = await req.query<UploadRow>(`
    SELECT TOP 50 LOWER(CONVERT(NVARCHAR(36), upload_id)) AS upload_id, garage, file_name, blob_path, size_bytes, sha256, page_count,
           status, status_detail, upload_day, created_at, created_by
    FROM dbo.RidershipScanUploads
    WHERE upload_day BETWEEN @from AND @to AND status <> 'awaiting' ${garageFilter}
    ORDER BY created_at DESC
  `);
  const pages = await loadPages(executor, { uploadIds: uploads.recordset.map((u) => u.upload_id) });
  const byUpload = new Map<string, ScanPageView[]>();
  for (const { upload_id, ...p } of pages) byUpload.set(upload_id, [...(byUpload.get(upload_id) ?? []), p]);

  const [trips, garages] = await Promise.all([loadLoggedTrips(executor, { from: serviceDate, to: serviceDate }), loadBlockGarages(executor)]);
  const tripsByBlock = new Map<string, number>();
  for (const t of trips) if (t.block && t.service_date === serviceDate) tripsByBlock.set(t.block, (tripsByBlock.get(t.block) ?? 0) + 1);
  const scanned = await scannedPagesOn(executor, serviceDate);
  const expected = [...tripsByBlock]
    .filter(([block]) => garage === undefined || garageOn(garages, block, serviceDate) === garage)
    .map(([block, n]) => ({ block, pages: pageCount(n), scanned_pages: scanned.get(block)?.size ?? 0 }))
    .sort((a, b) => a.block.localeCompare(b.block));

  return {
    service_date: serviceDate,
    garage: garage ?? null,
    uploads: uploads.recordset.map((u) => uploadView(u, byUpload.get(u.upload_id) ?? [])),
    expected,
    unassigned: pages.filter((p) => p.state === "unreadable").length,
  };
}

function shiftDay(serviceDate: string, days: number): string {
  const d = new Date(Date.UTC(Number(serviceDate.slice(0, 4)), Number(serviceDate.slice(4, 6)) - 1, Number(serviceDate.slice(6, 8)) + days));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

async function scannedPagesOn(executor: Executor, serviceDate: string): Promise<Map<string, Set<number>>> {
  const req = request(executor);
  req.input("date", sql.Char(8), serviceDate);
  const r = await req.query<{ block: string; sheet_page: number }>(
    "SELECT DISTINCT block, sheet_page FROM dbo.RidershipScanPages WHERE service_date = @date AND state = 'matched'",
  );
  const out = new Map<string, Set<number>>();
  for (const row of r.recordset) out.set(row.block, (out.get(row.block) ?? new Set()).add(row.sheet_page));
  return out;
}

export interface SheetScanMarker {
  /** When the first page of the sheet was scanned and matched. */
  first_scanned_at: string;
  scanned_pages: number;
}

/**
 * For the worklist: each sheet with a matched scan, and the garages that scan
 * at all (any upload naming them in the range), so "Not scanned" is shown
 * only where scanning is expected. Eagan stays on paper in December.
 */
export async function loadScanMarkers(executor: Executor, from: string, to: string): Promise<{ sheets: Map<string, SheetScanMarker>; scanningGarages: Set<string> }> {
  const req = request(executor);
  req.input("from", sql.Char(8), from);
  req.input("to", sql.Char(8), to);
  const r = await req.query<{ service_date: string; block: string; first: Date; pages: number }>(`
    SELECT service_date, block, MIN(processed_at) AS first, COUNT(DISTINCT sheet_page) AS pages
    FROM dbo.RidershipScanPages
    WHERE service_date BETWEEN @from AND @to AND state = 'matched'
    GROUP BY service_date, block
  `);
  const g = request(executor);
  g.input("from", sql.Char(8), shiftDay(from, -1));
  g.input("to", sql.Char(8), shiftDay(to, 3));
  const garages = await g.query<{ garage: string }>(`SELECT DISTINCT garage FROM dbo.RidershipScanUploads WHERE garage IS NOT NULL AND upload_day BETWEEN @from AND @to AND status <> 'awaiting'`);
  return {
    sheets: new Map(r.recordset.map((row) => [`${row.service_date}|${row.block}`, { first_scanned_at: new Date(row.first ?? Date.now()).toISOString(), scanned_pages: row.pages }])),
    scanningGarages: new Set(garages.recordset.map((x) => x.garage)),
  };
}

/** The sheet form's scan panel: every page naming the sheet, the sheet's own first. No image links. */
export async function loadSheetScans(executor: Executor, serviceDate: string, block: string): Promise<ScanPageView[]> {
  const order: Record<string, number> = { matched: 0, duplicate: 1, superseded: 2 };
  return (await loadPages(executor, { sheet: { serviceDate, block } }))
    .filter((p) => p.state in order)
    .map(({ upload_id: _, ...p }) => p)
    .sort((a, b) => (a.sheet_page ?? 0) - (b.sheet_page ?? 0) || order[a.state] - order[b.state] || (b.processed_at ?? "").localeCompare(a.processed_at ?? ""));
}

/**
 * A page image link for one viewer, and the log line that says they opened
 * it. The log is written first: no link is handed out without its record.
 */
export async function pageImageLink(pool: sql.ConnectionPool, pageId: string, actor: string): Promise<{ kind: "ok"; url: string; expires_at: string } | { kind: "not_found" } | { kind: "no_image" }> {
  const req = pool.request();
  req.input("id", sql.UniqueIdentifier, pageId);
  const r = await req.query<{ image_path: string | null }>("SELECT image_path FROM dbo.RidershipScanPages WHERE page_id = @id");
  const row = r.recordset[0];
  if (!row) return { kind: "not_found" };
  if (!row.image_path) return { kind: "no_image" };
  const log = pool.request();
  log.input("id", sql.UniqueIdentifier, pageId);
  log.input("by", sql.NVarChar(200), actor);
  await log.query("INSERT dbo.RidershipScanViews (page_id, viewed_by) VALUES (@id, @by)");
  const link = await pageImageUrl(row.image_path);
  return { kind: "ok", url: link.url, expires_at: link.expiresOn.toISOString() };
}

export { sha256Hex };

/**
 * The worklist with each sheet's scan marker and each garage's two scan
 * counts (§4 "Completeness and lateness"). Pure, so it is tested without SQL.
 */
export function withScanMarkers<W extends {
  sheets: Array<{ service_date: string; block: string; garage: string | null; state: string; scan?: "scanned" | "not_scanned" | null; first_scanned_at?: string | null }>;
  garages: Array<{ garage: string | null; scanned_open?: number | null; not_scanned?: number | null }>;
}>(worklist: W, markers: { sheets: Map<string, SheetScanMarker>; scanningGarages: Set<string> }, today: string): W {
  const open = (state: string) => state !== "entered" && state !== "entered_late";
  for (const sheet of worklist.sheets) {
    const marker = markers.sheets.get(`${sheet.service_date}|${sheet.block}`);
    sheet.first_scanned_at = marker?.first_scanned_at ?? null;
    sheet.scan = marker ? "scanned" : sheet.garage !== null && markers.scanningGarages.has(sheet.garage) && sheet.service_date <= today ? "not_scanned" : null;
  }
  for (const g of worklist.garages) {
    const scans = g.garage !== null && markers.scanningGarages.has(g.garage);
    const mine = worklist.sheets.filter((s) => s.garage === g.garage);
    g.scanned_open = scans ? mine.filter((s) => s.scan === "scanned" && open(s.state)).length : null;
    g.not_scanned = scans ? mine.filter((s) => s.scan === "not_scanned").length : null;
  }
  return worklist;
}
