import assert from "node:assert/strict";
import test from "node:test";
import { printedLabel } from "../countSheetPdf";
import { choosePrintRun, dateLooksWrong, duplicateOutcome, parseFooterLabel, parseSheetLink, readTextLayer } from "./identify";
import { withScanMarkers } from "./index";

test("the QR link names the sheet by its path; the host does not matter", () => {
  assert.deepEqual(parseSheetLink("https://console.example.test/r/20261212/024"), { serviceDate: "20261212", block: "024", sheetPage: 1 });
  assert.deepEqual(parseSheetLink("http://localhost:5173/r/20261212/7?p=2"), { serviceDate: "20261212", block: "007", sheetPage: 2 });
  assert.equal(parseSheetLink("https://x.test/r/20261332/024"), null, "not a calendar day");
  assert.equal(parseSheetLink("https://x.test/r/20261212/1234"), null, "blocks are up to three digits");
  assert.equal(parseSheetLink("https://x.test/s/20261212/024"), null);
});

test("the footer print time reads back as printedLabel wrote it", () => {
  const at = new Date("2026-12-12T03:10:00Z");
  assert.equal(parseFooterLabel(`Printed ${printedLabel(at)} from the Dispatch Log`), printedLabel(at));
  assert.equal(parseFooterLabel("Printed sometime"), null);
});

test("a text layer gives the sheet from the footer link, else from the large BLOCK and the date", () => {
  assert.deepEqual(readTextLayer([{ str: "console.example.test/r/20261212/024?p=2", height: 6.5 }]).identity, { serviceDate: "20261212", block: "024", sheetPage: 2 });
  const printed = readTextLayer([
    { str: "BLOCK", height: 8 },
    { str: "24", height: 34 },
    { str: "2026-12-12", height: 13 },
    { str: "Page 1 of 1 · pull-out order 3 of 20", height: 7 },
    { str: "1", height: 8 },
  ]);
  assert.deepEqual(printed.identity, { serviceDate: "20261212", block: "024", sheetPage: 1 });
  assert.equal(readTextLayer([{ str: "This side intentionally blank", height: 9 }]).blank, true);
  assert.equal(readTextLayer([{ str: "24", height: 8 }]).identity, null, "a small number is a trip row, not the block");
});

const run = (id: string, iso: string) => ({ print_id: id, printed_at: new Date(iso), label: printedLabel(new Date(iso)) });
const EVENING = run("evening", "2026-12-12T03:10:00Z");
const MORNING = run("morning", "2026-12-12T10:45:00Z");

test("the print run: by the footer read as text, else the only run, else a clearly better image match", () => {
  assert.equal(choosePrintRun([EVENING, MORNING], EVENING.label), "evening");
  assert.equal(choosePrintRun([EVENING, MORNING], "2026-12-12 1:00 AM CT"), null, "a footer no run printed");
  assert.equal(choosePrintRun([EVENING], null), "evening");
  assert.equal(choosePrintRun([], null), null);
  assert.equal(choosePrintRun([EVENING, MORNING], null), null, "two runs and nothing to tell them apart");
  assert.equal(choosePrintRun([EVENING, MORNING], null, new Map([["evening", 0.78], ["morning", 0.72]])), "evening");
  assert.equal(choosePrintRun([EVENING, MORNING], null, new Map([["evening", 0.78], ["morning", 0.77]])), null, "too close to call");
});

test("a second copy of a sheet page is kept: newer run wins, older is superseded, same or unknown is a duplicate", () => {
  const evening = new Date("2026-12-12T03:10:00Z");
  const morning = new Date("2026-12-12T10:45:00Z");
  assert.deepEqual(duplicateOutcome([], evening), { state: "matched", supersede: [] });
  assert.deepEqual(duplicateOutcome([{ page_id: "a", printed_at: evening }], morning), { state: "matched", supersede: ["a"] });
  assert.deepEqual(duplicateOutcome([{ page_id: "a", printed_at: morning }], evening), { state: "superseded", supersede: [] });
  assert.deepEqual(duplicateOutcome([{ page_id: "a", printed_at: evening }], evening), { state: "duplicate", supersede: [] });
  assert.deepEqual(duplicateOutcome([{ page_id: "a", printed_at: null }], morning), { state: "duplicate", supersede: [] });
  assert.deepEqual(duplicateOutcome([{ page_id: "a", printed_at: evening }], null), { state: "duplicate", supersede: [] });
});

test("a QR date more than two days from the upload is flagged", () => {
  assert.equal(dateLooksWrong("20261212", "20261214"), false);
  assert.equal(dateLooksWrong("20261212", "20261215"), true);
  assert.equal(dateLooksWrong("20261231", "20270101"), false);
});

test("the worklist marks Scanned, and Not scanned only for a garage that scans and a day that has run", () => {
  const sheet = (block: string, garage: string | null, service_date = "20261212", state = "not_entered") => ({ service_date, block, garage, state } as { service_date: string; block: string; garage: string | null; state: string; scan?: "scanned" | "not_scanned" | null; first_scanned_at?: string | null });
  const worklist = {
    sheets: [sheet("004", "Burnsville"), sheet("006", "Burnsville"), sheet("009", "Burnsville", "20261213"), sheet("013", "Burnsville", "20261212", "entered"), sheet("101", "Eagan")],
    garages: [{ garage: "Burnsville" } as { garage: string | null; scanned_open?: number | null; not_scanned?: number | null }, { garage: "Eagan" }],
  };
  withScanMarkers(worklist, {
    sheets: new Map([["20261212|004", { first_scanned_at: "2026-12-13T04:00:00.000Z", scanned_pages: 1 }], ["20261212|013", { first_scanned_at: "2026-12-13T04:01:00.000Z", scanned_pages: 1 }]]),
    scanningGarages: new Set(["Burnsville"]),
  }, "20261212");
  assert.deepEqual(worklist.sheets.map((s) => s.scan), ["scanned", "not_scanned", null, "scanned", null]);
  assert.equal(worklist.sheets[0].first_scanned_at, "2026-12-13T04:00:00.000Z");
  assert.deepEqual(worklist.garages, [
    { garage: "Burnsville", scanned_open: 1, not_scanned: 1 },
    { garage: "Eagan", scanned_open: null, not_scanned: null },
  ]);
});
