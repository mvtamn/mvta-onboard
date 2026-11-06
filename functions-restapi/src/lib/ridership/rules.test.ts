import assert from "node:assert/strict";
import test from "node:test";
import {
  changesBetween,
  checkSheetSave,
  excusedReason,
  garageOn,
  availTripNumber,
  guideRoute,
  isOperatorOverridden,
  normalizeBlock,
  orderPulloutRuns,
  parseBlockGarageSave,
  parseSheetSave,
  sheetDeadline,
  sheetProgress,
  sheetState,
} from "./rules";
import { completenessByGarage } from "./index";
import type { PulloutRun, WorklistSheet } from "./types";

// --- which trips need a count (spec §5) ----------------------------------------

test("a missed or canceled Dispatch Log trip, or a confirmed case, needs no count", () => {
  assert.equal(excusedReason({ start_status: "canceled" }, false), "dispatch_log_canceled");
  assert.equal(excusedReason({ start_status: "missed" }, false), "dispatch_log_missed");
  assert.equal(excusedReason({ start_status: "on_time" }, true), "missed_trip_confirmed");
});

test("a trip the feed could not see still needs a count", () => {
  assert.equal(excusedReason({ start_status: "unknown" }, false), null);
  assert.equal(excusedReason({ start_status: "late" }, false), null);
});

// --- the deadline, in Central time ----------------------------------------------

test("a sheet falls late at the end of the day after service, Central time", () => {
  // 2026-12-01 service -> late from midnight starting 2026-12-03 CST (06:00Z).
  assert.equal(sheetDeadline("20261201").toISOString(), "2026-12-03T06:00:00.000Z");
  // Daylight time: 2026-10-01 -> 2026-10-03 00:00 CDT is 05:00Z.
  assert.equal(sheetDeadline("20261001").toISOString(), "2026-10-03T05:00:00.000Z");
  // Across the fall-back night (2026-11-01): the deadline is local midnight, not +48h.
  assert.equal(sheetDeadline("20261031").toISOString(), "2026-11-02T06:00:00.000Z");
});

test("sheet state", () => {
  const deadline = new Date("2026-12-03T06:00:00Z");
  const before = new Date("2026-12-02T15:00:00Z");
  const after = new Date("2026-12-03T07:00:00Z");
  const state = (keyed: number, entered: string | null, now: Date, required = 4) =>
    sheetState({ required, keyed, entered_at: entered ? new Date(entered) : null, deadline, now });

  assert.equal(state(0, null, before), "not_entered");
  assert.equal(state(0, null, after), "late");
  assert.equal(state(4, "2026-12-02T14:00:00Z", after), "entered", "entered in time stays entered");
  assert.equal(state(4, "2026-12-03T08:00:00Z", after), "entered_late");
  // Entered, then a trip became required again: open until it is keyed.
  assert.equal(state(3, "2026-12-02T14:00:00Z", before), "in_progress");
  assert.equal(state(3, "2026-12-02T14:00:00Z", after), "late");
  // A sheet whose every trip is excused still has to be saved to be entered.
  assert.equal(state(0, null, before, 0), "not_entered");
  assert.equal(state(0, "2026-12-02T14:00:00Z", before, 0), "entered");
});

test("progress: not counted is a gap, never a zero", () => {
  const progress = sheetProgress(
    [
      { required: true, entry: { count_status: "counted", boardings: 12 } },
      { required: true, entry: { count_status: "not_counted", boardings: null } },
      { required: true, entry: null },
      { required: false, entry: { count_status: "did_not_operate", boardings: null } },
    ],
    [{ count_status: "counted", boardings: 5 }],
  );
  assert.deepEqual(progress, {
    trips: 4, required: 3, keyed: 2, counted: 2, not_counted: 1, did_not_operate: 1, added_trips: 1, boardings: 17,
  });
});

// --- pull-out pre-fill (decision 4) ---------------------------------------------

const run = (n: number, pullout: string | null, operator = `Operator ${n}`): PulloutRun => ({
  run: n, operator_name: operator, operator_id: String(9000 + n), bus: String(4400 + n), pullout_scheduled: pullout ? new Date(pullout) : null,
});

test("the first committed pull-out pre-fills; Avail's midnight placeholder is a relief run", () => {
  const ordered = orderPulloutRuns([
    run(3, "2026-12-01T06:00:00Z"), // midnight CST: no committed pull-out
    run(2, "2026-12-01T20:15:00Z"),
    run(1, "2026-12-01T11:40:00Z"),
    run(4, null),
  ]);
  assert.deepEqual(ordered.map((r) => r.run), [1, 2, 3, 4]);
});

test("an override is a difference from the pre-filled run, ignoring case and spacing", () => {
  const prefill = run(1, "2026-12-01T11:40:00Z", "Test Operator A");
  assert.equal(isOperatorOverridden({ operator_name: " test operator a ", operator_id: "9001", bus: "4401" }, prefill), false);
  assert.equal(isOperatorOverridden({ operator_name: "Test Operator B", operator_id: "9001", bus: "4401" }, prefill), true);
  assert.equal(isOperatorOverridden({ operator_name: "Test Operator A", operator_id: "9001", bus: "4999" }, prefill), true);
  assert.equal(isOperatorOverridden({ operator_name: "Anyone", operator_id: null, bus: null }, null), false, "no pull-out, nothing to override");
});

// --- garages ---------------------------------------------------------------------

test("the garage in force is the latest row on or before the date; none is Unassigned", () => {
  const rows = [
    { block: "024", effective_from: "2026-08-22", garage: "Burnsville" },
    { block: "024", effective_from: "2026-12-05", garage: "Eagan" },
    { block: "105", effective_from: "2026-12-05", garage: null },
    { block: "105", effective_from: "2026-08-22", garage: "Eagan" },
  ];
  assert.equal(garageOn(rows, "024", "20261204"), "Burnsville");
  assert.equal(garageOn(rows, "024", "20261205"), "Eagan");
  assert.equal(garageOn(rows, "105", "20261210"), null, "deliberately Unassigned from the new service change");
  assert.equal(garageOn(rows, "001", "20261210"), null);
  assert.equal(garageOn(rows, "024", "20260801"), null);
});

test("completeness by garage counts missing trips and keeps Unassigned, last", () => {
  const sheet = (garage: string | null, state: WorklistSheet["state"], required: number, keyed: number, notCounted = 0): WorklistSheet => ({
    service_date: "20261201", block: "001", garage, state, due_at: "", first_start_seconds: 0,
    entered_at: null, entered_by: null, reconstructed: false,
    progress: { trips: required, required, keyed, counted: keyed - notCounted, not_counted: notCounted, did_not_operate: 0, added_trips: 0, boardings: 0 },
  });
  const rows = completenessByGarage([
    sheet(null, "late", 3, 0),
    sheet("Eagan", "entered", 4, 4, 1),
    sheet("Burnsville", "not_entered", 5, 0),
    sheet("Eagan", "entered_late", 2, 2),
  ]);
  assert.deepEqual(rows.map((r) => r.garage), ["Burnsville", "Eagan", null]);
  assert.deepEqual(rows[1], {
    garage: "Eagan", sheets: 2, entered: 1, entered_late: 1, late: 0, open: 0, required_trips: 6, missing_trips: 0, not_counted_trips: 1,
  });
  assert.equal(rows[2].missing_trips, 3);
});

// --- parsing a save ----------------------------------------------------------------

const validSave = () => ({
  version: null,
  operator_name: "Test Operator A",
  operator_id: "9001",
  bus: "4401",
  reconstructed: false,
  trips: [
    { trip_id: "t1", count_status: "counted", boardings: 0 },
    { trip_id: "t2", count_status: "not_counted" },
    { trip_id: "t3", count_status: "did_not_operate", boardings: null },
  ],
  added_trips: [
    { id: null, route_short_name: "460", direction_label: "n", scheduled_start_seconds: 27000, reason: "tripper", count_status: "counted", boardings: 23 },
  ],
});

test("a well-formed save parses, and zero is a count", () => {
  const { save, problems } = parseSheetSave(validSave());
  assert.deepEqual(problems, []);
  assert.equal(save!.trips[0].boardings, 0);
  assert.equal(save!.trips[1].boardings, null);
  assert.equal(save!.added_trips[0].direction_label, "N");
});

test("a number only when counted, and no more than the sheet's three boxes", () => {
  const body = validSave();
  body.trips[1] = { trip_id: "t2", count_status: "not_counted", boardings: 0 } as never;
  body.trips[0] = { trip_id: "t1", count_status: "counted", boardings: 1000 };
  const { save, problems } = parseSheetSave(body);
  assert.equal(save, null);
  assert.deepEqual(problems.map((p) => p.field), ["trips[0].boardings", "trips[1].boardings"]);
});

test("an unscheduled trip cannot be did-not-operate, and needs a route", () => {
  const body = validSave();
  body.added_trips[0] = { ...body.added_trips[0], count_status: "did_not_operate", route_short_name: " " };
  const { problems } = parseSheetSave(body);
  assert.deepEqual(problems.map((p) => p.field), ["added_trips[0].route_short_name", "added_trips[0].count_status"]);
});

test("a duplicated trip and a bad status are refused", () => {
  const body = validSave();
  body.trips.push({ trip_id: "t1", count_status: "zero" } as never);
  const { problems } = parseSheetSave(body);
  assert.deepEqual(problems.map((p) => p.field), ["trips[3].trip_id", "trips[3].count_status"]);
});

test("every required trip needs an entry; excused trips may be keyed or left", () => {
  const save = parseSheetSave(validSave()).save!;
  const trips = [
    { trip_id: "t1", required: true },
    { trip_id: "t2", required: true },
    { trip_id: "t3", required: false },
    { trip_id: "t4", required: true },
    { trip_id: "t5", required: false },
  ];
  assert.deepEqual(checkSheetSave(save, trips, new Set()).map((p) => p.message), ["t4 needs a count, Not counted or Did not operate"]);
  assert.deepEqual(checkSheetSave(save, trips.slice(0, 3), new Set()), []);
});

test("a trip from another sheet, or an unknown unscheduled row, is refused", () => {
  const save = parseSheetSave({ ...validSave(), added_trips: [{ ...validSave().added_trips[0], id: "0b9c0a51-7c37-4e0e-9a43-2f4c0de1a111" }] }).save!;
  const problems = checkSheetSave(save, [{ trip_id: "t1", required: true }, { trip_id: "t2", required: true }], new Set());
  assert.deepEqual(problems.map((p) => p.message), [
    "t3 is not on this sheet",
    "0b9c0a51-7c37-4e0e-9a43-2f4c0de1a111 is not an unscheduled trip on this sheet",
  ]);
});

test("a relief or bus change names its trip and who or what took over; a bus-only swap is enough", () => {
  assert.equal(parseSheetSave(validSave()).save!.change, null, "absent is no change");
  const bus = parseSheetSave({ ...validSave(), change: { from_trip_id: "t2", operator_name: " ", operator_id: null, bus: " 4402 " } });
  assert.deepEqual(bus.problems, []);
  assert.deepEqual(bus.save!.change, { from_trip_id: "t2", operator_name: null, operator_id: null, bus: "4402" });

  const empty = parseSheetSave({ ...validSave(), change: { from_trip_id: "", operator_name: null, operator_id: null, bus: null } });
  assert.equal(empty.save, null);
  assert.deepEqual(empty.problems.map((p) => p.field), ["change.from_trip_id", "change"]);
  const long = parseSheetSave({ ...validSave(), change: { from_trip_id: "t2", operator_id: "123456789012345678901" } });
  assert.deepEqual(long.problems.map((p) => p.field), ["change.operator_id"]);
});

test("a change starts after the first trip, from a trip on this sheet", () => {
  const trips = [{ trip_id: "t1", required: true }, { trip_id: "t2", required: true }, { trip_id: "t3", required: false }];
  const at = (from: string) => checkSheetSave(parseSheetSave({ ...validSave(), change: { from_trip_id: from, operator_id: "9002" } }).save!, trips, new Set());
  assert.deepEqual(at("t2"), []);
  assert.deepEqual(at("t1").map((p) => p.field), ["change.from_trip_id"], "the first trip is the header");
  assert.deepEqual(at("t9").map((p) => p.message), ["t9 is not on this sheet"]);
});

// --- block garages ------------------------------------------------------------------

test("block -> garage rows: blocks padded, blank garage is Unassigned, duplicates refused", () => {
  const ok = parseBlockGarageSave({ effective_from: "2026-12-05", rows: [{ block: "24", garage: " Burnsville " }, { block: "105", garage: "" }] });
  assert.deepEqual(ok.save, { effective_from: "2026-12-05", rows: [{ block: "024", garage: "Burnsville" }, { block: "105", garage: null }] });
  const bad = parseBlockGarageSave({ effective_from: "2026-02-30", rows: [{ block: "24" }, { block: "024" }, { block: "1234" }] });
  assert.deepEqual(bad.problems.map((p) => p.field), ["effective_from", "rows[1].block", "rows[2].block"]);
});

test("a block is up to three digits, padded as the sheet prints it", () => {
  assert.equal(normalizeBlock("1"), "001");
  assert.equal(normalizeBlock(" 024 "), "024");
  assert.equal(normalizeBlock("1234"), null);
  assert.equal(normalizeBlock("A1"), null);
});

// --- history -------------------------------------------------------------------------

test("history records only what changed, and a first save records what it sets", () => {
  assert.deepEqual(
    changesBetween("trip", "t1", { count_status: "counted", boardings: 12 }, { count_status: "counted", boardings: 14 }),
    [{ subject: "trip", subject_ref: "t1", field: "boardings", previous_value: "12", new_value: "14" }],
  );
  assert.deepEqual(
    changesBetween("trip", "t2", null, { count_status: "not_counted", boardings: null }),
    [{ subject: "trip", subject_ref: "t2", field: "count_status", previous_value: null, new_value: "not_counted" }],
  );
  assert.deepEqual(changesBetween("sheet", null, { reconstructed: false }, { reconstructed: false }), []);
});

// --- the route as the guide names it -----------------------------------------------

test("a trip prints as Avail numbers it: the GTFS id's first part, read as hexadecimal, and the direction", () => {
  assert.equal(availTripNumber("t140-b1F5-sl1B-v64", "EB"), "320-E", "block 501's 3:20 AM trip");
  assert.equal(availTripNumber("t20E-b9-sl1C-v65", "NB"), "526-N");
  assert.equal(availTripNumber("t4D3-b12D-sl1C-v65", "N"), "1235-N");
  assert.equal(availTripNumber("t140-b1F5-sl1B-v64", null), "320", "no direction, no letter");
  assert.equal(availTripNumber("t140-b1F5-sl1B-v64", "Loop"), "320");
  assert.equal(availTripNumber("1436999", "EB"), null, "not MVTA's form: the sheet prints the id");
  assert.equal(availTripNumber("105-1", "N"), null);
});

test("a route prints as its number: Orange LINK is route 425", () => {
  assert.equal(guideRoute("460", "460"), "460");
  assert.equal(guideRoute("Orange LINK", "425"), "425");
  assert.equal(guideRoute("Orange LINK", "ORANGE"), "Orange LINK", "no number to fall back on");
  assert.equal(guideRoute(null, "425"), "425");
  assert.equal(guideRoute(null, null), null);
});
