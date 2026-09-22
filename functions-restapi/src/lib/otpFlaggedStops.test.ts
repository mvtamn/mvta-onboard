import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_EARLY_LATE_BIAS_THRESHOLD,
  flagStops,
  flaggableStopRowsSql,
  isFlaggedStop,
  stopBias,
  type FlaggableStopRow,
} from "./otpFlaggedStops";
import { thresholdOrDefault } from "./otpSettings";

const row = (over: Partial<FlaggableStopRow> = {}): FlaggableStopRow => ({
  route_id: 446,
  route_label: "446",
  stop_id: 30535,
  stop_name: "Example stop",
  day_of_week: "Monday",
  route_category: "FixedRoute",
  total: 120,
  pct_early: 0.05,
  pct_ontime: 0.8,
  pct_late: 0.1,
  pct_missed: 0.05,
  ...over,
});

test("a stop is flagged when either early or late running exceeds the threshold", () => {
  assert.equal(isFlaggedStop(row({ pct_early: 0.3, pct_late: 0.02 }), 0.15), true);
  assert.equal(isFlaggedStop(row({ pct_early: 0.02, pct_late: 0.3 }), 0.15), true);
  assert.equal(isFlaggedStop(row({ pct_early: 0.05, pct_late: 0.1 }), 0.15), false);
});

test("the threshold is exclusive, so a stop exactly at it is not flagged", () => {
  assert.equal(isFlaggedStop(row({ pct_early: 0.15, pct_late: 0 }), 0.15), false);
  assert.equal(isFlaggedStop(row({ pct_early: 0.1501, pct_late: 0 }), 0.15), true);
});

test("only fixed-route service is flagged - excluding the rest would move no figure", () => {
  const biased = { pct_early: 0.4, pct_late: 0.02 };
  assert.equal(isFlaggedStop(row({ ...biased, route_category: "FixedRoute" }), 0.15), true);
  assert.equal(isFlaggedStop(row({ ...biased, route_category: "SpecialEvent" }), 0.15), false);
  assert.equal(isFlaggedStop(row({ ...biased, route_category: "OnDemand" }), 0.15), false);
  assert.equal(isFlaggedStop(row({ ...biased, route_category: "NonRevenue" }), 0.15), false);
  // A route nobody has classified is fixed route, so a new route is reviewable
  // by default rather than silently escaping review.
  assert.equal(isFlaggedStop(row({ ...biased, route_category: null }), 0.15), true);
});

test("a missing share counts as zero rather than flagging the stop", () => {
  assert.equal(isFlaggedStop(row({ pct_early: null, pct_late: null }), 0.15), false);
  assert.equal(stopBias(row({ pct_early: null, pct_late: 0.2 })), 0.2);
});

test("moving the threshold changes who is flagged, and nothing else", () => {
  const rows = [
    row({ stop_id: 1, pct_early: 0.1, pct_late: 0.02 }),
    row({ stop_id: 2, pct_early: 0.25, pct_late: 0.02 }),
    row({ stop_id: 3, pct_early: 0.02, pct_late: 0.5 }),
  ];
  assert.deepEqual(flagStops(rows, 0.15).map((s) => s.stop_id), [3, 2]);
  assert.deepEqual(flagStops(rows, 0.05).map((s) => s.stop_id), [3, 2, 1]);
  assert.deepEqual(flagStops(rows, 0.6).map((s) => s.stop_id), []);
});

test("flagged stops come back worst lean first", () => {
  const rows = [
    row({ stop_id: 1, pct_early: 0.2, pct_late: 0 }),
    row({ stop_id: 2, pct_early: 0, pct_late: 0.9 }),
    row({ stop_id: 3, pct_early: 0.45, pct_late: 0 }),
  ];
  assert.deepEqual(flagStops(rows, 0.15).map((s) => s.stop_id), [2, 3, 1]);
});

test("a stop already excluded stays in front of the reviewer", () => {
  // Nothing in the rule looks at OtpStopExclusions. An approved exclusion must
  // remain visible so a past decision can be seen and reversed - re-reviewing
  // the same stop upserts in place (otpStopExclusions.ts).
  const flagged = flagStops([row({ pct_early: 0.4 })], 0.15);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0]?.stop_id, 30535);
});

test("a flagged stop carries what the queue shows and nothing the feed lacks", () => {
  const [flagged] = flagStops([row({ pct_early: 0.4, pct_ontime: 0.5, pct_late: 0.05, pct_missed: 0.05, total: 88 })], 0.15);
  assert.deepEqual(flagged, {
    route_id: 446,
    route_label: "446",
    stop_id: 30535,
    stop_name: "Example stop",
    day_of_week: "Monday",
    total: 88,
    pct_early: 0.4,
    pct_ontime: 0.5,
    pct_late: 0.05,
    pct_missed: 0.05,
  });
  // The monthly feed has no direction and no average-seconds variance; the
  // console rendered "—" and null for them for as long as it derived its own
  // list, so they do not travel.
  assert.equal("direction" in flagged!, false);
  assert.equal("avg_var" in flagged!, false);
});

test("a row with no departures is not flagged by empty shares", () => {
  const [flagged] = flagStops([row({ total: 0, pct_early: null, pct_ontime: null, pct_late: null, pct_missed: null })], 0.15);
  assert.equal(flagged, undefined);
});

test("the rows the rule answers over come from one month and carry the shared category", () => {
  const query = flaggableStopRowsSql();
  assert.match(query, /WHERE otp\.service_month = @month/);
  // The category expression is rules.ts's, the same one the measurement and
  // vw_OtpMonthlyRouteStop use - not a second spelling of it here.
  assert.match(query, /ISNULL\(classification\.route_category, N'FixedRoute'\)/);
  // Approved exclusions are deliberately not joined or filtered.
  assert.equal(/OtpStopExclusions/.test(query), false);
});

test("the code default answers only when the setting cannot", () => {
  assert.equal(thresholdOrDefault({ early_late_bias_threshold: 0.22 }), 0.22);
  assert.equal(thresholdOrDefault(undefined), DEFAULT_EARLY_LATE_BIAS_THRESHOLD);
  assert.equal(thresholdOrDefault(null), DEFAULT_EARLY_LATE_BIAS_THRESHOLD);
  // Values validation would have refused, had they reached the table another
  // way: a reviewer still gets a usable queue.
  assert.equal(thresholdOrDefault({ early_late_bias_threshold: 0 }), DEFAULT_EARLY_LATE_BIAS_THRESHOLD);
  assert.equal(thresholdOrDefault({ early_late_bias_threshold: 1 }), DEFAULT_EARLY_LATE_BIAS_THRESHOLD);
  assert.equal(thresholdOrDefault({ early_late_bias_threshold: Number.NaN }), DEFAULT_EARLY_LATE_BIAS_THRESHOLD);
});
