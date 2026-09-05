import { describe, expect, it } from "vitest";
import type { TripStartLogTrip } from "@mvta/shared";
import {
  EMPTY_FILTERS,
  applyFilters,
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
