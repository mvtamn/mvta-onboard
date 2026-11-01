import assert from "node:assert/strict";
import test from "node:test";
import QRCode from "qrcode";
import { clock, printedLabel, qrSide, renderCountSheets } from "./countSheetPdf";
import { linkBaseFor, normalizeLinkBase, pageCount, printStatus, sheetFingerprint, sheetLink, sheetsToPrint, type PrintSheet } from "./print";
import type { StoredPrintRun, StoredPrintedSheet } from "./store";
import type { LoggedTrip } from "./types";

const DAY = "20261202";

function trip(block: string | null, tripId: string, start: number, extra: Partial<LoggedTrip> = {}): LoggedTrip {
  return {
    service_date: DAY, trip_id: tripId, block, route_short_name: "460", direction_label: "N",
    scheduled_start_seconds: start, scheduled_end_seconds: start + 2700, start_status: "unknown", ...extra,
  };
}

const GARAGES = [
  { block: "105", effective_from: "2026-08-22", garage: "Burnsville" },
  { block: "024", effective_from: "2026-08-22", garage: "Burnsville" },
  { block: "212", effective_from: "2026-08-22", garage: "Eagan" },
];

// Block 024 pulls out first though 105 sorts first by number; 777 has no garage.
const TRIPS = [
  trip("105", "105-b", 25000), trip("105", "105-a", 21000),
  trip("024", "024-a", 18600),
  trip("212", "212-a", 52000),
  trip("777", "777-a", 30000),
  trip(null, "no-block", 30000),
];

// --- which sheets, in which order -----------------------------------------------

test("a garage's sheets come in pull-out order, numbered through its stack", () => {
  const sheets = sheetsToPrint(TRIPS, GARAGES, DAY, "Burnsville");
  assert.deepEqual(sheets.map((s) => [s.block, s.order]), [["024", 1], ["105", 2]]);
  assert.deepEqual(sheets[1].trips.map((t) => t.trip_id), ["105-a", "105-b"], "trips in time order on the sheet");
});

test("Unassigned blocks print as their own stack, so none goes missing", () => {
  assert.deepEqual(sheetsToPrint(TRIPS, GARAGES, DAY, null).map((s) => s.block), ["777"]);
  const all = sheetsToPrint(TRIPS, GARAGES, DAY, undefined);
  assert.deepEqual(all.map((s) => [s.garage, s.block, s.order]), [
    ["Burnsville", "024", 1], ["Burnsville", "105", 2], ["Eagan", "212", 1], [null, "777", 1],
  ]);
});

test("a garage row from a later service change does not move the date's sheets", () => {
  const moved = [...GARAGES, { block: "212", effective_from: "2026-12-05", garage: "Burnsville" }];
  assert.deepEqual(sheetsToPrint(TRIPS, moved, DAY, "Eagan").map((s) => s.block), ["212"]);
});

test("a block continues on a second page past 14 trips", () => {
  assert.equal(pageCount(0), 1);
  assert.equal(pageCount(14), 1);
  assert.equal(pageCount(15), 2);
});

// --- the fingerprint ---------------------------------------------------------------

test("the fingerprint changes with anything printed on the sheet, and only that", () => {
  const base = sheetsToPrint(TRIPS, GARAGES, DAY, "Eagan")[0];
  const same = sheetsToPrint(TRIPS.map((t) => (t.trip_id === "212-a" ? { ...t, start_status: "missed" as const } : t)), GARAGES, DAY, "Eagan")[0];
  assert.equal(same.fingerprint, base.fingerprint, "a status is not printed");
  const later = sheetsToPrint(TRIPS.map((t) => (t.trip_id === "212-a" ? { ...t, scheduled_start_seconds: 52300 } : t)), GARAGES, DAY, "Eagan")[0];
  assert.notEqual(later.fingerprint, base.fingerprint);
  const tripper = sheetsToPrint([...TRIPS, trip("212", "212-b", 60000)], GARAGES, DAY, "Eagan")[0];
  assert.notEqual(tripper.fingerprint, base.fingerprint);
  assert.match(sheetFingerprint(base.trips), /^[0-9a-f]{64}$/);
});

// --- the print log ------------------------------------------------------------------

const AT = new Date("2026-12-02T03:05:00Z");
const run = (over: Partial<StoredPrintRun>): StoredPrintRun => ({
  print_id: "r1", garage: "Burnsville", scope: "garage", blank_backs: false, sheet_count: 2, page_count: 2, printed_at: AT, printed_by: "desk@example.test", ...over,
});
const printed = (block: string, fingerprint: string, over: Partial<StoredPrintedSheet> = {}): StoredPrintedSheet => ({
  print_id: "r1", garage: "Burnsville", block, fingerprint, printed_at: AT, printed_by: "desk@example.test", ...over,
});

test("each sheet reads not printed, printed, or changed since printing", () => {
  const sheets = sheetsToPrint(TRIPS, GARAGES, DAY, undefined);
  const s024 = sheets.find((s) => s.block === "024")!;
  const status = printStatus(DAY, "Burnsville", sheets, { runs: [run({})], sheets: [printed("024", s024.fingerprint), printed("105", "stale")] });
  assert.deepEqual(status.sheets.map((s) => [s.block, s.state]), [["024", "printed"], ["105", "changed"]]);
  assert.equal(status.changed, 1);
  assert.equal(status.not_printed, 0);
  assert.equal(status.last_print?.printed_by, "desk@example.test");
  assert.deepEqual(status.garages, ["Burnsville", "Eagan", null]);

  const eagan = printStatus(DAY, "Eagan", sheets, { runs: [run({})], sheets: [] });
  assert.equal(eagan.last_print, null, "Burnsville's print is not Eagan's");
  assert.equal(eagan.not_printed, 1);
});

test("a block this garage printed that no longer runs is reported as dropped", () => {
  const sheets = sheetsToPrint(TRIPS, GARAGES, DAY, undefined);
  const s024 = sheets.find((s) => s.block === "024")!;
  const status = printStatus(DAY, "Burnsville", sheets, {
    runs: [run({})],
    sheets: [printed("024", s024.fingerprint), printed("330", "gone"), printed("400", "gone", { garage: "Eagan" })],
  });
  assert.deepEqual(status.dropped.map((d) => d.block), ["330"], "Eagan's dropped block is Eagan's to hear about");
  assert.equal(status.sheets.length, 2);
});

test("the latest print of a block decides, and a reprint is not the garage's stack", () => {
  const sheets = sheetsToPrint(TRIPS, GARAGES, DAY, "Burnsville");
  const s105 = sheets.find((s) => s.block === "105")!;
  const later = new Date("2026-12-02T04:00:00Z");
  const status = printStatus(DAY, "Burnsville", sheets, {
    runs: [run({ print_id: "r2", scope: "blocks", sheet_count: 1, printed_at: later }), run({})],
    sheets: [printed("105", s105.fingerprint, { print_id: "r2", printed_at: later }), printed("105", "stale"), printed("024", "stale")],
  });
  assert.deepEqual(status.sheets.map((s) => [s.block, s.state]), [["024", "changed"], ["105", "printed"]]);
  assert.equal(status.last_print?.printed_at, AT.toISOString());
  assert.deepEqual(status.prints.map((p) => p.scope), ["blocks", "garage"]);
});

// --- the QR link -----------------------------------------------------------------------

test("the QR link names the date and block, and the page past the first", () => {
  assert.equal(sheetLink("https://ops.example.test", DAY, "024"), "https://ops.example.test/r/20261202/024");
  assert.equal(sheetLink("https://ops.example.test/console", DAY, "024", 2), "https://ops.example.test/console/r/20261202/024?p=2");
});

test("the link base is an https address, or a local dev console", () => {
  assert.equal(normalizeLinkBase("https://ops.example.test/console/"), "https://ops.example.test/console");
  assert.equal(normalizeLinkBase("http://localhost:5173"), "http://localhost:5173");
  assert.equal(normalizeLinkBase("http://ops.example.test"), null);
  assert.equal(normalizeLinkBase("https://ops.example.test/?x=1"), null);
  assert.equal(normalizeLinkBase("javascript:alert(1)"), null);
  assert.equal(normalizeLinkBase(""), null);
  assert.equal(normalizeLinkBase(42), null);
});

test("a configured operator app address wins over the console that printed", () => {
  assert.equal(linkBaseFor("https://console.example.test", "https://console.example.test", "https://operator.example.test"), "https://operator.example.test");
  assert.equal(linkBaseFor("https://console.example.test/console", "https://console.example.test", ""), "https://console.example.test/console");
});

test("the console's address is taken only from the console the request came from", () => {
  assert.equal(linkBaseFor("https://elsewhere.example.test", "https://console.example.test", undefined), null);
  assert.equal(linkBaseFor("https://console.example.test", null, undefined), null, "no Origin, no console address");
  assert.equal(linkBaseFor("http://localhost:5176/console", "http://localhost:5176", undefined), "http://localhost:5176/console");
});

test("the code is 25 mm, grown for a long link to keep modules near 0.7 mm, never past 30 mm", () => {
  const mm = (points: number) => (points * 25.4) / 72;
  const moduleMm = (link: string) => mm(qrSide(link)) / (QRCode.create(link, { errorCorrectionLevel: "Q" }).modules.size + 2);
  const short = "https://ops.example.test/r/20261202/024";
  assert.equal(Math.round(mm(qrSide(short))), 25);
  // A console on a long generated hostname, on a continuation page.
  const long = "https://generated-name-00000000e.7.azurestaticapps.net/console/r/20261202/024?p=2";
  assert.ok(moduleMm(long) >= 0.6, `${moduleMm(long).toFixed(2)} mm modules`);
  assert.ok(mm(qrSide(long)) <= 30.01);
  assert.ok(moduleMm("https://alerts.example.org/console/r/20261202/024") >= 0.7);
});

// --- the PDF ------------------------------------------------------------------------

test("the sheet shows clock times, after midnight included, and the print time in Central", () => {
  assert.equal(clock(18600), "05:10");
  assert.equal(clock(88800), "00:40");
  assert.equal(printedLabel(new Date("2026-12-02T03:05:00Z")), "2026-12-01 21:05 CT");
});

const pagesIn = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;

test("one PDF holds each sheet's pages, with a blank back after each when asked", async () => {
  const long: PrintSheet = sheetsToPrint(
    Array.from({ length: 16 }, (_, i) => trip("024", `024-${String(i).padStart(2, "0")}`, 18600 + i * 3000)), GARAGES, DAY, "Burnsville",
  )[0];
  const short = sheetsToPrint(TRIPS, GARAGES, DAY, "Eagan")[0];
  const input = { serviceDate: DAY, sheets: [long, short], stackSize: 2, linkBase: "https://ops.example.test", printedAt: AT };
  const single = await renderCountSheets({ ...input, blankBacks: false });
  assert.equal(single.subarray(0, 5).toString(), "%PDF-");
  assert.equal(pagesIn(single), 3, "two pages for 16 trips, one for the short block");
  assert.equal(pagesIn(await renderCountSheets({ ...input, blankBacks: true })), 6);
});
