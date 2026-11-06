import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import PDFDocument from "pdfkit";
import { parseConnectionString, sql } from "../../db";
import { buildWorklist, printCountSheets, saveBlockGarages } from "../index";
import { assignPage, loadScanDesk, loadScanMarkers, loadSheetScans, loadUpload, pageImageLink, processPage, sha256Hex, splitUpload, withScanMarkers } from "./index";
import { encodeJpeg, rasterizePage } from "./raster";
import { ScanStorageNotConfiguredError } from "./storage";

// The scan worker against a real SQL Server, end to end on synthetic sheets
// (the repository is public: no real sheet, name or scan). Sheets are printed
// by the real printCountSheets, so the print log holds real runs, and the
// "scans" are those PDFs, or an image-only copy of one with its code defaced.
// Storage is replaced by memory; everything else is the shipped code:
//
//   migration 163 creates its tables on top of 153/157/161, and re-runs;
//   an upload splits into one pending row per page, once, however often the
//   message is delivered;
//   a page is identified by its QR code, matched to its print run by the
//   footer, and a blank back is dropped with no image;
//   a later print run's copy supersedes the earlier one, and an older copy
//   uploaded afterwards is itself superseded;
//   a page the code cannot read waits for a person, who assigns it;
//   the desk sees the garage's expected sheets and how far each is scanned;
//   the worklist marks the sheet Scanned;
//   an image open is logged before any link is made.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;
const DATABASE = "mvta_ridership_scan_contract";
const DESK = "desk-contract@example.test";
const OCC = "occ-contract@example.test";
const DAY = "20261212";
const EVENING = new Date("2026-12-12T03:10:00Z");
const MORNING = new Date("2026-12-12T10:45:00Z");

function batches(text: string): string[] {
  return text.split(/^\s*GO\s*$/gim).map((b) => b.trim()).filter(Boolean);
}

async function ownDatabase(cs: string): Promise<sql.ConnectionPool> {
  const admin = await new sql.ConnectionPool(parseConnectionString(cs)).connect();
  try {
    await admin.request().batch(
      `IF DB_ID('${DATABASE}') IS NOT NULL BEGIN ALTER DATABASE [${DATABASE}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${DATABASE}]; END; CREATE DATABASE [${DATABASE}];`,
    );
  } finally {
    await admin.close();
  }
  return new sql.ConnectionPool({ ...parseConnectionString(cs), database: DATABASE }).connect();
}

const PREREQUISITES = `
CREATE TABLE dbo.TripStartLog (
  service_date CHAR(8) NOT NULL, trip_id NVARCHAR(100) NOT NULL, block_id NVARCHAR(50) NULL, route_id NVARCHAR(50) NULL,
  route_short_name NVARCHAR(50) NULL, direction_label NVARCHAR(10) NULL,
  scheduled_start_seconds INT NOT NULL, start_status NVARCHAR(20) NULL,
  PRIMARY KEY (service_date, trip_id));
CREATE TABLE dbo.MonitoredMissedTrips (
  trip_id NVARCHAR(100) NOT NULL, service_date NVARCHAR(20) NOT NULL, status NVARCHAR(30) NOT NULL,
  validation_status NVARCHAR(30) NOT NULL, data_quality_status NVARCHAR(30) NOT NULL,
  detection_type NVARCHAR(40) NULL, source_system NVARCHAR(20) NULL, undecided_reason NVARCHAR(60) NULL,
  grace_deadline_at DATETIME2 NOT NULL, detected_late_arrival_at DATETIME2 NULL, detector_version NVARCHAR(40) NULL,
  expected_window_end_at DATETIME2 NULL, evidence_conflict_at DATETIME2 NULL);
`;

const FIXTURE = `
INSERT dbo.TripStartLog (service_date, trip_id, block_id, route_short_name, direction_label, scheduled_start_seconds, start_status) VALUES
  ('${DAY}', 's1', '24-v65', '99', 'S', 18000, 'on_time'),
  ('${DAY}', 's2', '24-v65', '99', 'N', 21600, 'on_time'),
  ('${DAY}', 's3', '24-v65', '99', 'S', 25200, 'on_time'),
  ('${DAY}', 'u1', '31-v65', '98', 'E', 19000, 'on_time');
`;

/** The page as a garage MFP makes it: one image, no text layer, with the QR code blacked out. */
async function defacedImageOnly(pdf: Buffer): Promise<Buffer> {
  const page = await rasterizePage(pdf, 0, 150);
  const data = new Uint8Array(page.image.data);
  for (let y = Math.round(32 * page.scale); y < Math.round(122 * page.scale); y++) {
    for (let x = Math.round(488 * page.scale); x < Math.round(578 * page.scale); x++) data[y * page.image.width + x] = 30;
  }
  const doc = new PDFDocument({ size: "LETTER", margin: 0 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  doc.image(await encodeJpeg({ ...page.image, data }), 0, 0, { width: 612, height: 792 });
  doc.end();
  return done;
}

test("Count Sheet scan capture against real SQL", { skip: !connectionString && "DECISION_MATRIX_TEST_SQL_CONNECTION_STRING not set" }, async (t) => {
  const pool = await ownDatabase(connectionString!);
  const files = new Map<string, Buffer>();
  const images = new Map<string, Buffer>();
  const read = async (blobPath: string) => files.get(blobPath)!;
  const deps = { read, writeImage: async (path: string, jpeg: Buffer) => { images.set(path, jpeg); } };

  /** What createUpload + the browser's PUT + submitUpload leave behind, without storage. */
  async function uploaded(bytes: Buffer, name: string): Promise<string> {
    const path = `2026/12/${name}.pdf`;
    files.set(path, bytes);
    const r = await pool.request()
      .input("path", sql.NVarChar(400), path).input("size", sql.BigInt, bytes.length).input("sha", sql.Char(64), sha256Hex(bytes))
      .query<{ id: string }>(`
        INSERT dbo.RidershipScanUploads (garage, file_name, blob_path, size_bytes, sha256, status, upload_day, created_by, submitted_at)
        OUTPUT LOWER(CONVERT(NVARCHAR(36), INSERTED.upload_id)) AS id
        VALUES ('Burnsville', '${name}.pdf', @path, @size, @sha, 'queued', '${DAY}', '${DESK}', SYSUTCDATETIME())`);
    return r.recordset[0].id;
  }

  async function runUpload(id: string): Promise<string[]> {
    const queued: string[] = [];
    assert.equal(await splitUpload(pool, id, async (pageId) => { queued.push(pageId); return true; }, read), "split");
    for (const pageId of queued) await processPage(pool, pageId, deps);
    return queued;
  }

  try {
    await pool.request().batch(PREREQUISITES);
    for (const file of ["migration-013-fixed-route-departures.sql", "migration-153-ridership-counting.sql", "migration-157-ridership-print-log.sql", "migration-161-ridership-printed-trip-ids.sql", "migration-163-ridership-scan-capture.sql", "migration-163-ridership-scan-capture.sql"]) {
      for (const b of batches(readFileSync(join(process.cwd(), "sql", file), "utf8"))) await pool.request().batch(b);
    }
    await pool.request().batch(FIXTURE);
    await saveBlockGarages(pool, { effective_from: "2026-12-07", rows: [{ block: "24", garage: "Burnsville" }, { block: "31", garage: "Burnsville" }] }, OCC, { from: DAY, to: DAY });

    const evening = await printCountSheets(pool, { service_date: DAY, garage: "Burnsville", blocks: ["024"], blank_backs: true, link_base: "https://console.example.test" }, DESK, EVENING);
    const morning = await printCountSheets(pool, { service_date: DAY, garage: "Burnsville", blocks: ["024"], blank_backs: false, link_base: "https://console.example.test" }, DESK, MORNING);
    assert.ok(evening.kind === "printed" && morning.kind === "printed");
    const runs = (await pool.request().query<{ print_id: string; printed_at: Date }>("SELECT LOWER(CONVERT(NVARCHAR(36), print_id)) AS print_id, printed_at FROM dbo.RidershipPrintRuns ORDER BY printed_at")).recordset;
    const [eveningRun, morningRun] = runs.map((r) => r.print_id);

    let eveningPage = "";
    await t.test("an upload splits once into pages; a QR page matches its print run and a blank back is dropped", async () => {
      const id = await uploaded(evening.pdf, "evening");
      const pages = await runUpload(id);
      assert.equal(pages.length, 2);
      // A redelivered upload message makes no second set of rows and queues nothing new.
      assert.equal(await splitUpload(pool, id, async () => { throw new Error("nothing should be queued"); }, read), "skipped");
      const upload = (await loadUpload(pool, id))!;
      assert.equal(upload.status, "done");
      assert.equal(upload.page_count, 2);
      assert.deepEqual(upload.pages.map((p) => [p.page_number, p.state, p.block, p.identified_by]), [[1, "matched", "024", "qr"], [2, "blank", null, null]]);
      eveningPage = upload.pages[0].page_id;
      const row = (await pool.request().input("id", sql.UniqueIdentifier, eveningPage).query<{ print_id: string; image_path: string }>(
        "SELECT LOWER(CONVERT(NVARCHAR(36), print_id)) AS print_id, image_path FROM dbo.RidershipScanPages WHERE page_id = @id")).recordset[0];
      assert.equal(row.print_id, eveningRun, "the footer says which print this copy came from");
      assert.ok(images.has(row.image_path));
      assert.equal(images.size, 1, "a blank back keeps no image");
      assert.equal(await processPage(pool, eveningPage, deps), "skipped", "a redelivered page message does nothing twice");
    });

    await t.test("the morning reprint supersedes the evening copy; an evening copy scanned later is superseded itself", async () => {
      await runUpload(await uploaded(morning.pdf, "morning"));
      const again = await runUpload(await uploaded(evening.pdf, "evening-again"));
      const scans = await loadSheetScans(pool, DAY, "024");
      assert.deepEqual(scans.map((s) => s.state), ["matched", "superseded", "superseded"]);
      assert.equal(scans[0].printed_at, MORNING.toISOString());
      const late = (await loadUpload(pool, (await pool.request().input("p", sql.UniqueIdentifier, again[0]).query<{ u: string }>("SELECT LOWER(CONVERT(NVARCHAR(36), upload_id)) AS u FROM dbo.RidershipScanPages WHERE page_id = @p")).recordset[0].u))!;
      assert.equal(late.pages[0].state, "superseded");
      void morningRun;
    });

    await t.test("a page the code cannot read waits for a person, who assigns it from the paper", async () => {
      const id = await uploaded(await defacedImageOnly(evening.pdf), "defaced");
      const [pageId] = await runUpload(id);
      let desk = await loadScanDesk(pool, DAY, "Burnsville");
      assert.equal(desk.unassigned, 1);
      const page = desk.uploads.find((u) => u.upload_id === id)!.pages[0];
      assert.equal(page.state, "unreadable");
      assert.equal(page.reason, "not_identified");

      const refused = await assignPage(pool, eveningPage, { action: "assign", service_date: DAY, block: "31" }, DESK);
      assert.equal(refused.kind, "conflict", "a page its code identified is not reassigned from the desk");
      assert.equal((await assignPage(pool, pageId, { action: "assign", service_date: DAY, block: "9999" }, DESK)).kind, "invalid");

      const saved = await assignPage(pool, pageId, { action: "assign", service_date: DAY, block: "24" }, DESK);
      assert.equal(saved.kind, "saved");
      if (saved.kind === "saved") {
        assert.equal(saved.page.identified_by, "person");
        assert.equal(saved.page.assigned_by, DESK);
        assert.equal(saved.page.state, "duplicate", "two runs and no footer: the copy is not known, so it does not displace the matched page");
      }
      desk = await loadScanDesk(pool, DAY, "Burnsville");
      assert.equal(desk.unassigned, 0);
      assert.deepEqual(desk.expected, [{ block: "024", pages: 1, scanned_pages: 1 }, { block: "031", pages: 1, scanned_pages: 0 }]);
    });

    await t.test("the worklist marks block 024 Scanned and block 031 Not scanned", async () => {
      const worklist = await buildWorklist(pool, DAY, DAY, new Date("2026-12-13T12:00:00Z"));
      withScanMarkers(worklist, await loadScanMarkers(pool, DAY, DAY), "20261213");
      assert.deepEqual(worklist.sheets.map((s) => [s.block, s.scan]).sort(), [["024", "scanned"], ["031", "not_scanned"]]);
      assert.equal(worklist.garages[0].scanned_open, 1);
      assert.equal(worklist.garages[0].not_scanned, 1);
    });

    await t.test("opening an image is logged before a link is made", async () => {
      delete process.env.RIDERSHIP_SCANS_STORAGE_ACCOUNT;
      await assert.rejects(pageImageLink(pool, eveningPage, OCC), ScanStorageNotConfiguredError);
      const views = (await pool.request().query<{ viewed_by: string }>("SELECT viewed_by FROM dbo.RidershipScanViews")).recordset;
      assert.deepEqual(views.map((v) => v.viewed_by), [OCC]);
    });
  } finally {
    await pool.close();
  }
});
