import { describe, expect, it } from "vitest";
import type { RidershipSheet } from "@mvta/shared";
import {
  blocksToPrint,
  cellFromInput,
  centralDay,
  clock,
  draftFromSheet,
  dueLabel,
  garageChanges,
  garageFromValue,
  garagePercent,
  garageValue,
  isOverridden,
  normalizeBlock,
  parseClock,
  parseSheetScan,
  printedTime,
  rowInForce,
  saveFromDraft,
  sheetLinkBase,
} from "./ridership.js";

const sheet = (overrides: Partial<RidershipSheet> = {}): RidershipSheet => ({
  service_date: "20261201",
  block: "024",
  garage: "Burnsville",
  state: "not_entered",
  due_at: "2026-12-03T06:00:00.000Z",
  pullout: { prefill: { run: 1, operator_name: "Test Operator A", operator_id: "9001", bus: "4401" }, other_runs: [] },
  header: null,
  version: null,
  trips: [
    { trip_id: "t1", route_short_name: "460", direction_label: "N", scheduled_start_seconds: 21600, scheduled_end_seconds: 24000, start_status: "on_time", required: true, excused_reason: null, entry: null },
    { trip_id: "t2", route_short_name: "460", direction_label: "S", scheduled_start_seconds: 25200, scheduled_end_seconds: null, start_status: "unknown", required: true, excused_reason: null, entry: null },
    { trip_id: "t3", route_short_name: "460", direction_label: "N", scheduled_start_seconds: 28800, scheduled_end_seconds: null, start_status: "canceled", required: false, excused_reason: "dispatch_log_canceled", entry: null },
  ],
  added_trips: [],
  progress: { trips: 3, required: 2, keyed: 0, counted: 0, not_counted: 0, did_not_operate: 0, added_trips: 0, boardings: 0 },
  history: [],
  ...overrides,
});

describe("a trip's box", () => {
  it("holds a number, N or D, and a letter replaces what was there", () => {
    expect(cellFromInput("12")).toBe("12");
    expect(cellFromInput("12n")).toBe("N");
    expect(cellFromInput("Nd")).toBe("D");
    expect(cellFromInput("N5")).toBe("5");
    expect(cellFromInput("007")).toBe("7");
    expect(cellFromInput("0")).toBe("0");
    expect(cellFromInput("1234")).toBe("123");
    expect(cellFromInput("x")).toBe("");
  });

  it("refuses Did not operate for an unscheduled trip", () => {
    expect(cellFromInput("d", false)).toBe("");
    expect(cellFromInput("n", false)).toBe("N");
  });
});

describe("times and dates", () => {
  it("prints GTFS seconds as the sheet's clock and reads typed starts", () => {
    expect(clock(21600)).toBe("06:00");
    expect(clock(88_800)).toBe("00:40");
    expect(parseClock("7:30")).toBe(27000);
    expect(parseClock("0730")).toBe(27000);
    expect(parseClock("24:40")).toBe(88_800);
    expect(parseClock("7")).toBeNull();
    expect(parseClock("7:75")).toBeNull();
  });

  it("is due by the end of the day after service", () => {
    expect(dueLabel("20261201")).toBe("end of Wed, Dec 2");
    expect(dueLabel("20261231")).toBe("end of Fri, Jan 1");
  });
});

describe("the draft", () => {
  it("opens a new sheet with Avail's first pull-out", () => {
    const draft = draftFromSheet(sheet());
    expect(draft).toMatchObject({ operator_name: "Test Operator A", operator_id: "9001", bus: "4401", cells: { t1: "", t2: "", t3: "" } });
    expect(isOverridden(draft, sheet().pullout.prefill)).toBe(false);
    expect(isOverridden({ ...draft, bus: "4999" }, sheet().pullout.prefill)).toBe(true);
    expect(isOverridden({ ...draft, operator_name: "  test   operator a " }, sheet().pullout.prefill)).toBe(false);
  });

  it("opens a saved sheet with what was saved", () => {
    const saved = sheet({
      header: { operator_name: "Test Operator Relief", operator_id: "9002", bus: "4402", prefill_run: 1, operator_overridden: true, reconstructed: true, entered_at: null, entered_by: null, updated_at: null, updated_by: null },
      trips: sheet().trips.map((t) => (t.trip_id === "t1" ? { ...t, entry: { count_status: "counted", boardings: 0 } } : t.trip_id === "t2" ? { ...t, entry: { count_status: "not_counted", boardings: null } } : t)),
    });
    expect(draftFromSheet(saved)).toMatchObject({ operator_name: "Test Operator Relief", reconstructed: true, cells: { t1: "0", t2: "N", t3: "" } });
  });

  it("will not save while a required trip is blank, and points at the first", () => {
    const draft = { ...draftFromSheet(sheet()), cells: { t1: "", t2: "4", t3: "" } };
    const { save, problems } = saveFromDraft(sheet(), draft);
    expect(save).toBeNull();
    expect(problems).toEqual([{ target: "t1", message: expect.stringContaining("1 trip still blank") }]);
  });

  it("sends zero as a count, N as a gap, and leaves an excused trip out when blank", () => {
    const draft = { ...draftFromSheet(sheet()), cells: { t1: "0", t2: "N", t3: "" } };
    const { save } = saveFromDraft(sheet(), draft);
    expect(save?.trips).toEqual([
      { trip_id: "t1", count_status: "counted", boardings: 0 },
      { trip_id: "t2", count_status: "not_counted", boardings: null },
    ]);
    expect(save).toMatchObject({ version: null, operator_name: "Test Operator A", reconstructed: false, added_trips: [] });
  });

  it("checks an unscheduled trip's route, start and answer", () => {
    const draft = {
      ...draftFromSheet(sheet()),
      cells: { t1: "3", t2: "4", t3: "" },
      added: [
        { key: "a", id: null, route: "460", direction: "N", start: "7:30", reason: "tripper" as const, cell: "23" },
        { key: "b", id: null, route: " ", direction: "S", start: "late", reason: "other" as const, cell: "" },
      ],
    };
    const { save, problems } = saveFromDraft(sheet(), draft);
    expect(save).toBeNull();
    expect(problems.map((p) => p.target)).toEqual(["added:b", "added:b", "added:b"]);
    const ok = saveFromDraft(sheet(), { ...draft, added: [draft.added[0]] });
    expect(ok.save?.added_trips).toEqual([
      { id: null, route_short_name: "460", direction_label: "N", scheduled_start_seconds: 27000, reason: "tripper", count_status: "counted", boardings: 23 },
    ]);
  });
});

describe("worklist and setup", () => {
  it("reads a Count Sheet QR link, an overflow page, or a typed block", () => {
    expect(parseSheetScan("https://operator.onboard.example/r/20261201/024")).toEqual({ serviceDate: "20261201", block: "024" });
    expect(parseSheetScan("https://operator.onboard.example/r/20261201/024?p=2")).toEqual({ serviceDate: "20261201", block: "024" });
    expect(parseSheetScan(" 24 ")).toEqual({ serviceDate: null, block: "024" });
    expect(parseSheetScan("hello")).toBeNull();
  });

  it("counts a garage's keyed trips as a percent, rounding down so 99.5% is not 100%", () => {
    const g = { garage: "Eagan", sheets: 1, entered: 0, entered_late: 0, late: 0, open: 1, required_trips: 200, missing_trips: 1, not_counted_trips: 0 };
    expect(garagePercent(g)).toBe(99);
    expect(garagePercent({ ...g, required_trips: 0, missing_trips: 0 })).toBe(100);
  });

  it("sends only the blocks whose garage changes on the service change's first day", () => {
    const rows = [
      { block: "024", effective_from: "2026-08-22", garage: "Burnsville" },
      { block: "105", effective_from: "2026-08-22", garage: "Eagan" },
    ];
    expect(rowInForce(rows, "024", "2026-12-05")?.garage).toBe("Burnsville");
    expect(rowInForce(rows, "024", "2026-08-01")).toBeNull();
    expect(garageChanges(rows, { "024": "Burnsville", "105": "", "212": "Eagan", "330": "" }, "2026-12-05")).toEqual([
      { block: "105", garage: null },
      { block: "212", garage: "Eagan" },
    ]);
  });
});

describe("printing", () => {
  it("tomorrow is the Central day after today, even late in the evening", () => {
    // 22:30 CST on Dec 1 is already Dec 2 in UTC.
    expect(centralDay(1, new Date("2026-12-02T04:30:00Z"))).toBe("2026-12-02");
    expect(centralDay(0, new Date("2026-12-02T04:30:00Z"))).toBe("2026-12-01");
  });

  it("lists the blocks still to print: never printed or changed since", () => {
    const row = (block: string, state: "not_printed" | "printed" | "changed") => ({ block, garage: "Burnsville", order: 1, first_start_seconds: 0, trips: 1, pages: 1, state, printed_at: null, printed_by: null });
    expect(blocksToPrint([row("024", "printed"), row("105", "changed"), row("212", "not_printed")])).toEqual(["105", "212"]);
  });

  it("points the QR link at this console until the operator app has an address", () => {
    expect(sheetLinkBase("https://ops.example.test", "/console/")).toBe("https://ops.example.test/console");
    expect(sheetLinkBase("http://localhost:5173", "/")).toBe("http://localhost:5173");
  });

  it("shows the print time in Central", () => {
    expect(printedTime("2026-12-02T03:05:00Z")).toBe("Tue, Dec 1 21:05");
  });

  it("reads a block as the sheet prints it", () => {
    expect(normalizeBlock("24")).toBe("024");
    expect(normalizeBlock("1234")).toBeNull();
  });

  it("gives Unassigned a select value of its own", () => {
    expect(garageFromValue(garageValue(null))).toBeNull();
    expect(garageFromValue(garageValue("Eagan"))).toBe("Eagan");
  });
});
