import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parseConnectionString, sql } from "../db";
import { buildWorklist, listBlockGarages, loadPrintStatus, loadSheet, printCountSheets, saveBlockGarages, saveSheet } from "./index";

// The ridership module against a real SQL Server. rules.test.ts covers the
// judgements, which are pure; this file covers what only the database can
// show:
//
//   the Dispatch Log's GTFS block ("24-v64") read as the sheet's "024";
//   a confirmed missed-trip case excusing a trip through the shared
//   classification, and an unreviewed one not;
//   a save refused until every required trip has an entry, then written with
//   one history row per field it set;
//   entered_at set once and never moved by a correction;
//   a second editor's stale version refused rather than overwriting;
//   an unscheduled row removed by being left out, and kept in the table;
//   the pull-out pre-fill and the override it records;
//   Planning's block -> garage rows dated by service change;
//   a garage's print logged with each block's fingerprint, a block the
//   Dispatch Log changed since flagged, and a reprint of just that block
//   clearing it, and a printed block the day no longer runs reported as
//   dropped (migration 157).
//
// Ridership's tables come from the real migration 153; Avail's pull-out from
// the real migration 013; the Dispatch Log and missed-trip cases are reduced
// to the columns ridership reads.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;
const DATABASE = "mvta_ridership_contract";
const OCC = "occ-contract@example.test";
const PLANNING = "planning-contract@example.test";

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
  service_date CHAR(8) NOT NULL, trip_id NVARCHAR(100) NOT NULL, block_id NVARCHAR(50) NULL,
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

// Block 024 on 2026-12-01: four trips, one canceled in the Dispatch Log, one
// a reviewer confirmed missed. Block 105: two trips, one with an unreviewed
// case that excuses nothing. A trip with no block belongs on no sheet.
const DAY = "20261201";
const FIXTURE = `
INSERT dbo.TripStartLog (service_date, trip_id, block_id, route_short_name, direction_label, scheduled_start_seconds, start_status) VALUES
  ('${DAY}', 'a1', '24-v64', '436', 'S', 20520, 'on_time'),
  ('${DAY}', 'a2', '24-v64', '436', 'N', 24300, 'unknown'),
  ('${DAY}', 'a3', '24-v64', '436', 'S', 28500, 'canceled'),
  ('${DAY}', 'a4', '24-v64', '436', 'N', 32400, 'on_time'),
  ('${DAY}', 'b1', '105-v64', '460', 'N', 18600, 'on_time'),
  ('${DAY}', 'b2', '105-v64', '460', 'S', 22500, 'late'),
  ('${DAY}', 'x1', NULL, '999', 'E', 30000, 'on_time');
INSERT dbo.MonitoredMissedTrips (trip_id, service_date, status, validation_status, data_quality_status, detection_type, grace_deadline_at) VALUES
  ('a4', '${DAY}', 'escalated', 'confirmed', 'verified', 'silent_no_show', '2026-12-01T15:00:00'),
  ('b2', '${DAY}', 'escalated', 'unreviewed', 'verified', 'silent_no_show', '2026-12-01T13:00:00');
-- Block 24's first run pulls out at 05:20 CST; the relief run carries Avail's midnight placeholder.
INSERT dbo.FixedRouteDepartures (service_date, block, run, pullout_scheduled, operator_name, logon_id, vehicle_label) VALUES
  ('${DAY}', 24, 2402, '2026-12-01T06:00:00', 'Test Operator Relief', 9102, '4388'),
  ('${DAY}', 24, 2401, '2026-12-01T11:20:00', 'Test Operator A', 9101, '4421');
`;

const BEFORE_DEADLINE = new Date("2026-12-02T15:00:00Z");
const AFTER_DEADLINE = new Date("2026-12-03T09:00:00Z");

test("ridership against real SQL", { skip: !connectionString && "DECISION_MATRIX_TEST_SQL_CONNECTION_STRING not set" }, async (t) => {
  const pool = await ownDatabase(connectionString!);
  try {
    await pool.request().batch(PREREQUISITES);
    for (const file of ["migration-013-fixed-route-departures.sql", "migration-153-ridership-counting.sql", "migration-157-ridership-print-log.sql"]) {
      for (const b of batches(readFileSync(join(process.cwd(), "sql", file), "utf8"))) await pool.request().batch(b);
    }
    await pool.request().batch(FIXTURE);

    await t.test("Planning's garage rows apply from their service change", async () => {
      const result = await saveBlockGarages(pool, {
        effective_from: "2026-11-28", rows: [{ block: "24", garage: "Burnsville" }, { block: "105", garage: "Eagan" }],
      }, PLANNING, { from: DAY, to: DAY });
      assert.equal(result.kind, "saved");
      // A later service change moves 105; it does not apply to Dec 1.
      await saveBlockGarages(pool, { effective_from: "2026-12-05", rows: [{ block: "105", garage: "Burnsville" }] }, PLANNING, { from: DAY, to: DAY });
      const list = await listBlockGarages(pool, { from: DAY, to: DAY });
      assert.deepEqual(list.garages, ["Burnsville", "Eagan"]);
      assert.deepEqual(list.recent_blocks, ["024", "105"]);
      assert.equal(list.rows.length, 3);
    });

    await t.test("the worklist reads GTFS blocks as the sheet's, and excuses only what is confirmed", async () => {
      const worklist = await buildWorklist(pool, DAY, DAY, BEFORE_DEADLINE);
      assert.equal(worklist.trips_without_block, 1);
      const byBlock = new Map(worklist.sheets.map((s) => [s.block, s]));
      assert.deepEqual([...byBlock.keys()].sort(), ["024", "105"]);
      assert.equal(byBlock.get("024")!.garage, "Burnsville");
      assert.equal(byBlock.get("105")!.garage, "Eagan");
      assert.equal(byBlock.get("024")!.progress.required, 2, "a3 canceled and a4 confirmed missed");
      assert.equal(byBlock.get("105")!.progress.required, 2, "an unreviewed case excuses nothing");
      assert.equal(byBlock.get("024")!.state, "not_entered");
    });

    await t.test("the sheet pre-fills the first committed pull-out and hints the relief run", async () => {
      const sheet = await loadSheet(pool, DAY, "024", BEFORE_DEADLINE);
      assert.ok(sheet);
      assert.equal(sheet.pullout.prefill?.run, 2401);
      assert.equal(sheet.pullout.prefill?.operator_id, "9101");
      assert.deepEqual(sheet.pullout.other_runs.map((r) => r.run), [2402]);
      assert.equal(sheet.header, null);
      assert.equal(sheet.version, null);
      assert.deepEqual(sheet.trips.map((tr) => [tr.trip_id, tr.excused_reason]), [
        ["a1", null], ["a2", null], ["a3", "dispatch_log_canceled"], ["a4", "missed_trip_confirmed"],
      ]);
      assert.equal(await loadSheet(pool, DAY, "777", BEFORE_DEADLINE), null);
    });

    const firstSave = {
      version: null,
      operator_name: "Test Operator A", operator_id: "9101", bus: "4421", reconstructed: false,
      trips: [{ trip_id: "a1", count_status: "counted", boardings: 14 }, { trip_id: "a2", count_status: "not_counted" }],
      added_trips: [{ id: null, route_short_name: "436", direction_label: "S", scheduled_start_seconds: 61200, reason: "tripper", count_status: "counted", boardings: 31 }],
    };

    let version: string | null = null;
    let addedId = "";

    await t.test("a save missing a required trip is refused and writes nothing", async () => {
      const result = await saveSheet(pool, DAY, "024", { ...firstSave, trips: firstSave.trips.slice(0, 1) }, OCC, BEFORE_DEADLINE);
      assert.equal(result.kind, "invalid");
      const rows = await pool.request().query("SELECT COUNT(*) AS n FROM dbo.RidershipSheets");
      assert.equal(rows.recordset[0].n, 0);
    });

    await t.test("the first complete save enters the sheet and records every field it set", async () => {
      const result = await saveSheet(pool, DAY, "024", firstSave, OCC, BEFORE_DEADLINE);
      assert.equal(result.kind, "saved");
      if (result.kind !== "saved") return;
      const sheet = result.sheet;
      assert.equal(sheet.state, "entered");
      assert.equal(sheet.header?.entered_by, OCC);
      assert.equal(sheet.header?.prefill_run, 2401);
      assert.equal(sheet.header?.operator_overridden, false);
      assert.equal(sheet.progress.boardings, 45, "14 + the tripper's 31; not counted adds nothing");
      assert.equal(sheet.trips.find((tr) => tr.trip_id === "a2")?.entry?.boardings, null);
      assert.equal(sheet.added_trips.length, 1);
      addedId = sheet.added_trips[0].id;
      version = sheet.version;
      const fields = sheet.history.map((h) => `${h.subject}:${h.subject_ref ?? ""}:${h.field}`).sort();
      assert.ok(fields.includes("trip:a1:boardings"));
      assert.ok(fields.includes("trip:a2:count_status"));
      assert.ok(!fields.includes("trip:a2:boardings"), "a gap is not recorded as a value");
      assert.ok(fields.includes(`added_trip:${addedId}:boardings`));
      assert.ok(fields.includes("sheet::entered"));
      assert.ok(sheet.history.every((h) => h.changed_by === OCC));
    });

    await t.test("a stale editor is refused rather than overwriting", async () => {
      const stale = await saveSheet(pool, DAY, "024", { ...firstSave, trips: [{ trip_id: "a1", count_status: "counted", boardings: 99 }, firstSave.trips[1]] }, OCC, BEFORE_DEADLINE);
      assert.equal(stale.kind, "conflict");
      if (stale.kind === "conflict") assert.equal(stale.version, version);
    });

    await t.test("a correction after the deadline is history, and does not move entered_at", async () => {
      const result = await saveSheet(pool, DAY, "024", {
        ...firstSave,
        version,
        operator_name: "Test Operator Relief", operator_id: "9102", bus: "4388",
        trips: [{ trip_id: "a1", count_status: "counted", boardings: 16 }, firstSave.trips[1], { trip_id: "a3", count_status: "did_not_operate" }],
        added_trips: [],
      }, OCC, AFTER_DEADLINE);
      assert.equal(result.kind, "saved");
      if (result.kind !== "saved") return;
      assert.equal(result.sheet.state, "entered", "entered on time, corrected late");
      assert.equal(result.sheet.header?.operator_overridden, true, "the sheet named the relief operator");
      assert.equal(result.sheet.added_trips.length, 0);
      const correction = result.sheet.history.find((h) => h.subject_ref === "a1" && h.field === "boardings" && h.previous_value === "14");
      assert.equal(correction?.new_value, "16");
      assert.ok(result.sheet.history.some((h) => h.subject_ref === addedId && h.field === "removed"));
      const kept = await pool.request().query("SELECT removed_by FROM dbo.RidershipAddedTrips");
      assert.deepEqual(kept.recordset, [{ removed_by: OCC }], "the removed row stays in the table");
      version = result.sheet.version;
    });

    await t.test("saving what is already saved changes nothing", async () => {
      const before = (await pool.request().query("SELECT COUNT(*) AS n FROM dbo.RidershipCountHistory")).recordset[0].n;
      const sheet = await loadSheet(pool, DAY, "024", AFTER_DEADLINE);
      const result = await saveSheet(pool, DAY, "024", {
        version, operator_name: "Test Operator Relief", operator_id: "9102", bus: "4388", reconstructed: false,
        trips: sheet!.trips.filter((tr) => tr.entry).map((tr) => ({ trip_id: tr.trip_id, ...tr.entry })),
        added_trips: [],
      }, OCC, AFTER_DEADLINE);
      assert.equal(result.kind, "saved");
      if (result.kind === "saved") {
        assert.equal(result.changes, 0);
        assert.equal(result.sheet.version, version);
      }
      const after = (await pool.request().query("SELECT COUNT(*) AS n FROM dbo.RidershipCountHistory")).recordset[0].n;
      assert.equal(after, before);
    });

    await t.test("an unentered sheet is late after the deadline, and its garage shows it", async () => {
      const worklist = await buildWorklist(pool, DAY, DAY, AFTER_DEADLINE);
      assert.deepEqual(worklist.sheets.map((s) => [s.block, s.state]), [["105", "late"], ["024", "entered"]]);
      const eagan = worklist.garages.find((g) => g.garage === "Eagan");
      assert.equal(eagan?.late, 1);
      assert.equal(eagan?.missing_trips, 2);
      const late = await saveSheet(pool, DAY, "105", {
        version: null, operator_name: null, operator_id: null, bus: null, reconstructed: true,
        trips: [{ trip_id: "b1", count_status: "counted", boardings: 8 }, { trip_id: "b2", count_status: "counted", boardings: 3 }],
        added_trips: [],
      }, OCC, AFTER_DEADLINE);
      assert.equal(late.kind, "saved");
      if (late.kind === "saved") {
        assert.equal(late.sheet.state, "entered_late");
        assert.equal(late.sheet.header?.operator_overridden, false, "no pull-out, nothing overridden");
        assert.equal(late.sheet.header?.reconstructed, true);
      }
    });

    await t.test("a garage prints its stack, and a block changed since is flagged until reprinted", async () => {
      const PRINTED = new Date("2026-12-01T03:05:00Z");
      const before = await loadPrintStatus(pool, DAY, "Burnsville");
      assert.deepEqual(before.sheets.map((s) => [s.block, s.state]), [["024", "not_printed"]]);
      assert.equal(before.last_print, null);

      const stack = await printCountSheets(pool, { service_date: DAY, garage: "Burnsville", blank_backs: true, link_base: "https://console.example.test" }, PLANNING, PRINTED);
      assert.equal(stack.kind, "printed");
      if (stack.kind === "printed") {
        assert.equal(stack.pdf.subarray(0, 5).toString(), "%PDF-");
        assert.equal(stack.sheets, 1);
        assert.equal(stack.pages, 2, "one page and its blank back");
        assert.equal(stack.filename, "count-sheets-20261201-burnsville.pdf");
      }
      const printed = await loadPrintStatus(pool, DAY, "Burnsville");
      assert.deepEqual(printed.sheets.map((s) => [s.block, s.state, s.printed_by]), [["024", "printed", PLANNING]]);
      assert.equal(printed.last_print?.printed_at, PRINTED.toISOString());
      assert.equal((await loadPrintStatus(pool, DAY, "Eagan")).sheets[0].state, "not_printed", "another garage's stack is its own");

      // A late tripper lands on block 24 after the desk printed.
      await pool.request().query(`INSERT dbo.TripStartLog (service_date, trip_id, block_id, route_short_name, direction_label, scheduled_start_seconds, start_status)
        VALUES ('${DAY}', 'a5', '24-v64', '436', 'S', 36000, 'unknown')`);
      const changed = await loadPrintStatus(pool, DAY, "Burnsville");
      assert.equal(changed.changed, 1);
      assert.equal(changed.sheets[0].state, "changed");

      const reprint = await printCountSheets(pool, { service_date: DAY, garage: "Burnsville", blocks: ["024"], blank_backs: false, link_base: "https://console.example.test" }, PLANNING, new Date("2026-12-01T04:00:00Z"));
      assert.equal(reprint.kind, "printed");
      const after = await loadPrintStatus(pool, DAY, "Burnsville");
      assert.equal(after.sheets[0].state, "printed");
      assert.equal(after.last_print?.printed_at, PRINTED.toISOString(), "a reprint is not the garage's stack");
      assert.deepEqual(after.prints.map((p) => p.scope), ["blocks", "garage"]);

      const none = await printCountSheets(pool, { service_date: DAY, garage: null, blank_backs: false, link_base: "https://console.example.test" }, PLANNING);
      assert.equal(none.kind, "nothing", "no block is Unassigned on the day");

      // The block is withdrawn from the day after its sheet went out.
      await pool.request().query(`DELETE dbo.TripStartLog WHERE service_date = '${DAY}' AND block_id = '24-v64'`);
      const gone = await loadPrintStatus(pool, DAY, "Burnsville");
      assert.deepEqual(gone.dropped.map((d) => d.block), ["024"]);
      assert.equal(gone.sheets.length, 0);
    });
  } finally {
    await pool.close();
  }
});
