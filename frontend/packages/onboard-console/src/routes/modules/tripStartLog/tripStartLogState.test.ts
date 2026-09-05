import { describe, expect, it } from "vitest";
import type { TripStartLogTrip } from "@mvta/shared";
import {
  EMPTY_FILTERS,
  agencyTodayServiceDate,
  applyFilters,
  canVerify,
  initialsFromAccount,
  nextVerifyAction,
  hourMarks,
  needsDisposition,
  timelineLanes,
  timelineRange,
  timelineX,
  upNext,
  filtersActive,
  gtfsClock,
  inputToServiceDate,
  routeOptions,
  serviceDateToInput,
  sortTrips,
  startBucket,
  summarize,
} from "./tripStartLogState.js";

function trip(overrides: Partial<TripStartLogTrip> & { trip_id: string }): TripStartLogTrip {
  return {
    service_date: "20260908",
    block_id: "1",
    route_id: "444-2-A",
    route_short_name: "444",
    direction_id: 0,
    direction_label: "EB",
    origin_stop_id: "1",
    origin_stop_name: "Apple Valley Transit Station",
    scheduled_start_seconds: 5 * 3600,
    scheduled_start_at: "2026-09-08T10:00:00Z",
    in_rotation: false,
    rotation_day: "monday",
    actual_start_at: null,
    actual_start_source: null,
    start_delay_seconds: null,
    start_status: "unknown",
    predicted_start_at: null,
    verification: null,
    ...overrides,
  };
}

describe("start buckets", () => {
  it("splits late by the workbook's five-minute rule and keeps unknown out of every verdict", () => {
    expect(startBucket({ start_status: "on_time", start_delay_seconds: -30 })).toBe("on_time");
    expect(startBucket({ start_status: "late", start_delay_seconds: 300 })).toBe("left_late");
    expect(startBucket({ start_status: "late", start_delay_seconds: 301 })).toBe("late_over_5");
    expect(startBucket({ start_status: "late", start_delay_seconds: null })).toBe("late_over_5");
    expect(startBucket({ start_status: "missed", start_delay_seconds: null })).toBe("missed");
    expect(startBucket({ start_status: "canceled", start_delay_seconds: null })).toBe("canceled");
    expect(startBucket({ start_status: "unknown", start_delay_seconds: null })).toBe("no_actual");
  });
});

describe("summary", () => {
  it("counts start OTP over judged trips only and rotation trips still owing initials", () => {
    const summary = summarize([
      trip({ trip_id: "a", start_status: "on_time", start_delay_seconds: 0, in_rotation: true }),
      trip({ trip_id: "b", start_status: "late", start_delay_seconds: 120, in_rotation: true, verification: { observation: "observed_left_late", verified_by: "x", verified_initials: "JD", verified_at: "2026-09-08T10:05:00Z", note: null } }),
      trip({ trip_id: "c", start_status: "late", start_delay_seconds: 900 }),
      trip({ trip_id: "d", start_status: "missed" }),
      trip({ trip_id: "e", start_status: "unknown", in_rotation: true }),
      trip({ trip_id: "f", start_status: "canceled" }),
    ]);
    expect(summary.counts).toEqual({ on_time: 1, left_late: 1, late_over_5: 1, missed: 1, no_actual: 1, canceled: 1 });
    expect(summary.start_otp).toBe(0.5);
    expect(summary.awaiting_initials).toBe(2);
  });

  it("has no OTP to report when nothing has been judged", () => {
    expect(summarize([trip({ trip_id: "a" })]).start_otp).toBeNull();
  });
});

describe("filters", () => {
  const trips = [
    trip({ trip_id: "a", route_short_name: "444", block_id: "1", in_rotation: true }),
    trip({ trip_id: "b", route_short_name: "Orange LINK", route_id: "425", block_id: "2", origin_stop_name: "Burnsville Transit Station", direction_label: "NB" }),
    trip({ trip_id: "c", route_short_name: "460", block_id: "3", start_status: "late", start_delay_seconds: 60 }),
  ];

  it("narrows by rotation, route, status and free text over the same rows", () => {
    expect(applyFilters(trips, { ...EMPTY_FILTERS, rotationOnly: true }).map((t) => t.trip_id)).toEqual(["a"]);
    expect(applyFilters(trips, { ...EMPTY_FILTERS, route: "Orange LINK" }).map((t) => t.trip_id)).toEqual(["b"]);
    expect(applyFilters(trips, { ...EMPTY_FILTERS, status: "left_late" }).map((t) => t.trip_id)).toEqual(["c"]);
    expect(applyFilters(trips, { ...EMPTY_FILTERS, search: "burnsville" }).map((t) => t.trip_id)).toEqual(["b"]);
    expect(applyFilters(trips, { ...EMPTY_FILTERS, search: "NB" }).map((t) => t.trip_id)).toEqual(["b"]);
  });

  it("reports whether any filter is set so Clear can appear only then", () => {
    expect(filtersActive(EMPTY_FILTERS)).toBe(false);
    expect(filtersActive({ ...EMPTY_FILTERS, search: " " })).toBe(false);
    expect(filtersActive({ ...EMPTY_FILTERS, rotationOnly: true })).toBe(true);
  });

  it("lists route signs the way a person reads them", () => {
    expect(routeOptions(trips)).toEqual(["444", "460", "Orange LINK"]);
  });
});

describe("sorting", () => {
  it("defaults to the workbook order, scheduled start ascending, and keeps missing values last", () => {
    const trips = [
      trip({ trip_id: "late", scheduled_start_seconds: 7 * 3600, block_id: null }),
      trip({ trip_id: "early", scheduled_start_seconds: 3 * 3600 + 20 * 60, block_id: "9" }),
      trip({ trip_id: "mid", scheduled_start_seconds: 5 * 3600, block_id: "10" }),
    ];
    expect(sortTrips(trips, "scheduled", "asc").map((t) => t.trip_id)).toEqual(["early", "mid", "late"]);
    expect(sortTrips(trips, "block", "asc").map((t) => t.trip_id)).toEqual(["early", "mid", "late"]);
    expect(sortTrips(trips, "block", "desc").map((t) => t.trip_id)).toEqual(["mid", "early", "late"]);
  });
});

describe("formatting", () => {
  it("prints GTFS clocks the way the schedule does, past midnight included", () => {
    expect(gtfsClock(3 * 3600 + 20 * 60)).toBe("03:20");
    expect(gtfsClock(25 * 3600 + 10 * 60)).toBe("25:10");
  });

  it("round-trips a service date through the date input", () => {
    expect(serviceDateToInput("20260908")).toBe("2026-09-08");
    expect(inputToServiceDate("2026-09-08")).toBe("20260908");
    expect(inputToServiceDate("")).toBeNull();
  });
});

describe("watch queue", () => {
  const now = new Date("2026-09-08T10:00:00Z");
  const trips = [
    trip({ trip_id: "soon", scheduled_start_at: "2026-09-08T10:10:00Z", in_rotation: true }),
    trip({ trip_id: "later", scheduled_start_at: "2026-09-08T11:20:00Z" }),
    trip({ trip_id: "too-late", scheduled_start_at: "2026-09-08T11:40:00Z" }),
    trip({ trip_id: "started", scheduled_start_at: "2026-09-08T10:05:00Z", actual_start_at: "2026-09-08T10:04:00Z", start_status: "on_time", start_delay_seconds: -60 }),
    trip({ trip_id: "canceled", scheduled_start_at: "2026-09-08T10:30:00Z", start_status: "canceled" }),
    trip({ trip_id: "gone", scheduled_start_at: "2026-09-08T09:50:00Z" }),
  ];

  it("lists what is due in the horizon, rotation or not, and drops what has started, been canceled, or passed", () => {
    expect(upNext(trips, now).map((t) => t.trip_id)).toEqual(["soon", "later"]);
  });

  it("orders dispositions by severity then by how long they have waited", () => {
    const items = needsDisposition([
      trip({ trip_id: "late", scheduled_start_at: "2026-09-08T09:00:00Z", start_status: "late", start_delay_seconds: 900 }),
      trip({ trip_id: "waiting-long", scheduled_start_at: "2026-09-08T09:30:00Z" }),
      trip({ trip_id: "waiting-short", scheduled_start_at: "2026-09-08T09:50:00Z" }),
      trip({ trip_id: "within-grace", scheduled_start_at: "2026-09-08T09:56:00Z" }),
      trip({ trip_id: "missed", scheduled_start_at: "2026-09-08T08:00:00Z", start_status: "missed" }),
      trip({ trip_id: "left-late", scheduled_start_at: "2026-09-08T09:00:00Z", start_status: "late", start_delay_seconds: 120 }),
    ], now);
    expect(items.map((i) => `${i.trip.trip_id}:${i.reason}`)).toEqual([
      "missed:missed", "late:late_over_5", "waiting-long:no_actual_past_due", "waiting-short:no_actual_past_due",
    ]);
    expect(items[2]?.minutesPastDue).toBe(30);
  });

  it("knows today's agency service date across the UTC midnight boundary", () => {
    expect(agencyTodayServiceDate(new Date("2026-09-08T03:30:00Z"))).toBe("20260907");
    expect(agencyTodayServiceDate(new Date("2026-09-08T12:00:00Z"))).toBe("20260908");
  });
});

describe("timeline", () => {
  const trips = [
    trip({ trip_id: "b2-early", block_id: "2", scheduled_start_at: "2026-09-08T10:20:00Z" }),
    trip({ trip_id: "b10", block_id: "10", scheduled_start_at: "2026-09-08T09:40:00Z", actual_start_at: "2026-09-08T09:52:00Z" }),
    trip({ trip_id: "b2-late", block_id: "2", scheduled_start_at: "2026-09-08T09:10:00Z" }),
    trip({ trip_id: "none", block_id: null, scheduled_start_at: "2026-09-08T12:05:00Z" }),
  ];

  it("makes one lane per block in natural order with trips by scheduled start", () => {
    const lanes = timelineLanes(trips);
    expect(lanes.map((l) => l.block)).toEqual(["2", "10", "—"]);
    expect(lanes[0]?.trips.map((t) => t.trip_id)).toEqual(["b2-late", "b2-early"]);
  });

  it("spans whole hours around every scheduled and actual start", () => {
    const range = timelineRange(trips)!;
    expect(new Date(range.start).toISOString()).toBe("2026-09-08T08:00:00.000Z");
    expect(new Date(range.end).toISOString()).toBe("2026-09-08T13:00:00.000Z");
    expect(hourMarks(range)).toHaveLength(6);
    expect(timelineX(new Date("2026-09-08T09:30:00Z").getTime(), range, 100)).toBe(150);
    expect(timelineRange([])).toBeNull();
  });
});

describe("verification", () => {
  it("cycles the cell the way the workbook does and clears anything else", () => {
    const v = (observation: "observed_on_time" | "observed_left_late" | "not_observed") => ({ verification: { observation, verified_by: "x", verified_initials: "JD", verified_at: "2026-09-08T08:21:00Z", note: null } });
    expect(nextVerifyAction({ verification: null })).toBe("observed_on_time");
    expect(nextVerifyAction(v("observed_on_time"))).toBe("observed_left_late");
    expect(nextVerifyAction(v("observed_left_late"))).toBe("clear");
    expect(nextVerifyAction(v("not_observed"))).toBe("clear");
  });

  it("lets the SST desk role and Admin record, and no one else", () => {
    expect(canVerify(["OCC.TripStartVerify"])).toBe(true);
    expect(canVerify(["OCC.Admin"])).toBe(true);
    expect(canVerify(["OCC.Viewer", "OCC.Compliance", "OCC.Publisher"])).toBe(false);
  });

  it("derives workbook initials from the account", () => {
    expect(initialsFromAccount("Tyre Fant", "tyre.fant@mvta.com")).toBe("TF");
    expect(initialsFromAccount("Doe, Jane", "x@y")).toBe("JD");
    expect(initialsFromAccount(undefined, "jane.doe@sst.example")).toBe("JD");
    expect(initialsFromAccount(undefined, undefined)).toBe("?");
  });
});
