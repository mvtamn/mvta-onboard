import { test } from "node:test";
import assert from "node:assert";
import { diffReviews, type ReviewSnapshot } from "./diff";
import type { PredictionRiskCheckId, PredictionRiskRoute } from "./types";

const ORDER: PredictionRiskCheckId[] = ["placeholder_times", "timepoint_gap", "longest_hop", "run_time_flat", "recovery_time"];

function route(route_id: string, checks: [PredictionRiskCheckId, number | null, boolean][]): PredictionRiskRoute {
  return {
    route_id, route_short_name: route_id, trip_count: 10,
    flag_count: checks.filter(([, , flagged]) => flagged).length,
    checks: checks.map(([id, value, flagged]) => ({ id, value, flagged })),
  };
}

function snapshot(review_id: number, version: string | null, routes: PredictionRiskRoute[]): ReviewSnapshot {
  return { review_id, reviewed_at: `2026-10-${String(review_id).padStart(2, "0")}T09:00:00Z`, feed: { version, start_date: null, end_date: null }, routes };
}

test("a new feed that fixes one flag and brings another reports both, with the values either side", () => {
  const before = snapshot(1, "20260909", [
    route("420", [["placeholder_times", 27, true], ["run_time_flat", 100, true]]),
    route("442", [["placeholder_times", 26, true], ["run_time_flat", 40, false]]),
  ]);
  const after = snapshot(2, "20261102", [
    route("442", [["placeholder_times", 26, true], ["run_time_flat", 100, true]]),
    route("420", [["placeholder_times", 27, true], ["run_time_flat", 0, false]]),
  ]);
  const diff = diffReviews(before, after, ORDER);
  assert.strictEqual(diff.cause, "feed");
  assert.deepStrictEqual(diff.gained, [{ route_id: "442", route_short_name: "442", check_id: "run_time_flat", from_value: 40, to_value: 100 }]);
  assert.deepStrictEqual(diff.lost, [{ route_id: "420", route_short_name: "420", check_id: "run_time_flat", from_value: 100, to_value: 0 }]);
  assert.deepStrictEqual(diff.flagged_routes, { from: 2, to: 2 });
  assert.deepStrictEqual(diff.from, { review_id: 1, reviewed_at: "2026-10-01T09:00:00Z", feed_version: "20260909" });
});

test("on the same feed the difference is the review's, and a check one side never ran is added, not gained", () => {
  // v1.5.319 ran seven checks with straight-line distance; v1.5.324 eleven, along the route.
  const before = snapshot(1, "20260909", [route("470", [["placeholder_times", 0, false], ["longest_hop", 9.6, false]])]);
  const after = snapshot(2, "20260909", [route("470", [["placeholder_times", 0, false], ["longest_hop", 16, true], ["recovery_time", 51, false], ["run_time_flat", 0, false]])]);
  const diff = diffReviews(before, after, ORDER);
  assert.strictEqual(diff.cause, "checks");
  assert.deepStrictEqual(diff.checks_added, ["run_time_flat", "recovery_time"]);
  assert.deepStrictEqual(diff.checks_removed, []);
  assert.deepStrictEqual(diff.gained.map((c) => [c.route_id, c.check_id, c.from_value, c.to_value]), [["470", "longest_hop", 9.6, 16]]);
  assert.deepStrictEqual(diff.lost, []);
});

test("a value that moves without crossing the threshold is not a change", () => {
  const before = snapshot(1, "A", [route("420", [["placeholder_times", 27, true]])]);
  const after = snapshot(2, "B", [route("420", [["placeholder_times", 19, true]])]);
  const diff = diffReviews(before, after, ORDER);
  assert.deepStrictEqual([diff.gained, diff.lost], [[], []]);
});

test("routes that appear or leave the feed are listed, not counted as flags gained or lost", () => {
  const before = snapshot(1, "A", [route("420", [["placeholder_times", 27, true]]), route("499", [["placeholder_times", 3, false]])]);
  const after = snapshot(2, "B", [route("420", [["placeholder_times", 27, true]]), route("510", [["placeholder_times", 12, true]])]);
  const diff = diffReviews(before, after, ORDER);
  assert.deepStrictEqual(diff.routes_added, [{ route_id: "510", route_short_name: "510", flag_count: 1 }]);
  assert.deepStrictEqual(diff.routes_removed, [{ route_id: "499", route_short_name: "499" }]);
  assert.deepStrictEqual([diff.gained, diff.lost], [[], []]);
  assert.deepStrictEqual(diff.flagged_routes, { from: 1, to: 2 });
});

test("changes are grouped by check in the review's order", () => {
  const before = snapshot(1, "A", [route("1", [["recovery_time", 9, false], ["placeholder_times", 5, false]]), route("2", [["recovery_time", 9, false]])]);
  const after = snapshot(2, "B", [route("1", [["recovery_time", 3, true], ["placeholder_times", 15, true]]), route("2", [["recovery_time", 4, true]])]);
  assert.deepStrictEqual(diffReviews(before, after, ORDER).gained.map((c) => `${c.check_id}:${c.route_id}`), [
    "placeholder_times:1", "recovery_time:1", "recovery_time:2",
  ]);
});

test("a feed with no version is never taken for the same feed", () => {
  const before = snapshot(1, null, [route("1", [["placeholder_times", 5, false]])]);
  const after = snapshot(2, null, [route("1", [["placeholder_times", 15, true]])]);
  assert.strictEqual(diffReviews(before, after, ORDER).cause, "feed");
});
