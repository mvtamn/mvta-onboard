import { describe, expect, it } from "vitest";
import type { FlaggedStop, OtpStopExclusion } from "@mvta/shared";
import { queueRow } from "./otpFigures.js";
import { decidedSummary, matchesFilter, previousSummary, queueGroups, weekdayIndex } from "./otpQueueGroups.js";

const stop = (over: Partial<FlaggedStop> = {}): FlaggedStop => ({
  route_id: 475, route_label: "475", stop_id: 41243, stop_name: "Oak St SE at University Av SE SE corner",
  day_of_week: "Mon", total: 24, pct_early: 0, pct_ontime: 0.125, pct_late: 0.875, pct_missed: 0, ...over,
});

const previous = (over: Partial<OtpStopExclusion> = {}): OtpStopExclusion => ({
  id: "x", service_month: "202609", route_id: 475, stop_id: 41243, day_of_week: "Mon",
  status: "approved", reason_code: "RECOVERY", notes: null, decided_by: null, decided_at: "2026-09-20T15:00:00Z", ...over,
} as OtpStopExclusion);

const label = (code: string) => ({ RECOVERY: "Recovery point", HOLD: "Terminal hold" })[code] ?? code;

// October 2026 as the server sent it: the same stop on three routes, five
// weekdays each, 348 rows for 96 route/stop pairs, ordered by worst lean.
const october: FlaggedStop[] = [
  stop({ day_of_week: "Wed", pct_late: 0.9 }),
  stop({ route_id: 477, route_label: "477", stop_id: 53431, stop_name: "Apple Valley Transit Station SB", day_of_week: "Wed", total: 20, pct_late: 0.85 }),
  stop({ day_of_week: "Mon", pct_late: 0.8 }),
  stop({ route_id: 490, route_label: "490", day_of_week: "Tues", total: 20, pct_late: 0.7 }),
  stop({ day_of_week: "Fri", pct_late: 0.6, pct_early: 0.2 }),
];
const pending = () => "pending" as const;
const none = () => undefined;

describe("grouping the queue by stop", () => {
  it("folds one stop's weekdays into one group, in the order the server put the stop", () => {
    const groups = queueGroups(october, october.map(queueRow), pending, none);
    expect(groups.map((g) => `${g.routeLabel}/${g.stopId}`)).toEqual(["475/41243", "477/53431", "490/41243"]);
    expect(groups[0]!.days.map((d) => d.dayLabel)).toEqual(["Mon", "Wed", "Fri"]);
    expect(groups[0]!.sampled).toBe(72);
  });

  it("names the other routes a stop is flagged on, for the reviewer who knows it as one place", () => {
    const groups = queueGroups(october, october.map(queueRow), pending, none);
    expect(groups[0]!.otherRoutes).toEqual(["490"]);
    expect(groups[1]!.otherRoutes).toEqual([]);
  });

  it("reads the feed's weekday spellings into Monday-first order", () => {
    expect(["Mon", "Tues", "Wed", "Thur", "Fri", "Sat", "Sun"].map(weekdayIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(weekdayIndex("Monday")).toBe(0);
    expect(weekdayIndex("??")).toBe(7);
  });

  it("counts the group's decisions and says when its lean is not one way", () => {
    const statusOf = (s: FlaggedStop) => (s.day_of_week === "Mon" ? "approved" : s.day_of_week === "Fri" ? "rejected" : "pending");
    const mixed = [...october, stop({ day_of_week: "Sat", pct_early: 0.5, pct_late: 0.1 })];
    const [oak] = queueGroups(mixed, mixed.map(queueRow), statusOf, none);
    expect(oak).toMatchObject({ pending: 2, approved: 1, rejected: 1, biasLabel: "Early some days, late others" });
  });

  it("weights the group's adherence by each day's departures", () => {
    const rows = [stop({ total: 30, pct_late: 1, pct_ontime: 0 }), stop({ day_of_week: "Tues", total: 10, pct_late: 0, pct_ontime: 1 })];
    const [g] = queueGroups(rows, rows.map(queueRow), pending, none);
    expect(g!.latePct).toBe(75);
    expect(g!.ontimePct).toBe(25);
  });
});

describe("filtering groups", () => {
  const [oak] = queueGroups(october, october.map(queueRow), pending, none);
  it("matches a stop by name or number, on route, and on whether anything is still pending", () => {
    expect(matchesFilter(oak!, { route: "", status: "pending", search: "oak st" })).toBe(true);
    expect(matchesFilter(oak!, { route: "", status: "pending", search: "41243" })).toBe(true);
    expect(matchesFilter(oak!, { route: "490", status: "pending", search: "" })).toBe(false);
    expect(matchesFilter(oak!, { route: "", status: "resolved", search: "" })).toBe(false);
    expect(matchesFilter(oak!, { route: "", status: "all", search: "" })).toBe(true);
  });
});

describe("one line for what was already decided", () => {
  it("says what last month did, with the reason when the week shared one", () => {
    const rows = [stop(), stop({ day_of_week: "Tues" })];
    const [g] = queueGroups(rows, rows.map(queueRow), pending, (s) => previous({ day_of_week: s.day_of_week }));
    expect(previousSummary(g!.days, label)).toBe("Last month: excluded — Recovery point");
  });

  it("drops the reason when last month's reasons differed, and counts a split week", () => {
    const rows = [stop(), stop({ day_of_week: "Tues" }), stop({ day_of_week: "Wed" })];
    const split = (s: FlaggedStop) =>
      s.day_of_week === "Wed" ? previous({ status: "rejected", reason_code: null }) : previous({ reason_code: s.day_of_week === "Mon" ? "HOLD" : "RECOVERY" });
    const [g] = queueGroups(rows, rows.map(queueRow), pending, split);
    expect(previousSummary(g!.days, label)).toBe("Last month: 2 excluded, 1 kept");
    const [h] = queueGroups(rows.slice(0, 2), rows.slice(0, 2).map(queueRow), pending, split);
    expect(previousSummary(h!.days, label)).toBe("Last month: excluded");
    expect(previousSummary(queueGroups(rows, rows.map(queueRow), pending, none)[0]!.days, label)).toBeNull();
  });

  it("summarises a decided group as excluded, kept, or a count of each", () => {
    const rows = [stop(), stop({ day_of_week: "Tues" })];
    const allExcluded = queueGroups(rows, rows.map(queueRow), () => "approved", none)[0]!;
    expect(decidedSummary(allExcluded, () => "RECOVERY", label)).toBe("Excluded — Recovery point");
    const allKept = queueGroups(rows, rows.map(queueRow), () => "rejected", none)[0]!;
    expect(decidedSummary(allKept, () => "", label)).toBe("Kept in OTP calc");
    const half = queueGroups(rows, rows.map(queueRow), (s) => (s.day_of_week === "Mon" ? "approved" : "rejected"), none)[0]!;
    expect(decidedSummary(half, () => "RECOVERY", label)).toBe("1 of 2 days excluded");
  });
});
