import { test } from "node:test";
import assert from "node:assert";
import { reviewPredictionRisk, PREDICTION_RISK_CHECKS, type PredictionRiskFeed } from "./gtfsPredictionRisk";

// Stops laid out along a meridian: 0.01 degrees of latitude is about 1.1 km,
// so A-B-C are ordinary local stops and D is about 24 km (15 miles) on.
const STOPS =
  "stop_id,stop_name,stop_lat,stop_lon\n" +
  "A,A,44.70,-93.20\nB,B,44.71,-93.20\nC,C,44.72,-93.20\nD,D,44.92,-93.20\n";

function feed(over: Partial<PredictionRiskFeed>): PredictionRiskFeed {
  return {
    routesCsv: "route_id,route_short_name\nR1,401\nR2,402\n",
    stopsCsv: STOPS,
    tripsCsv: "route_id,service_id,trip_id,direction_id,block_id\nR1,S,T1,0,B1\n",
    stopTimesCsv:
      "trip_id,arrival_time,departure_time,stop_id,stop_sequence,timepoint\n" +
      "T1,6:00:00,6:00:00,A,1,1\nT1,6:03:00,6:03:00,B,2,0\nT1,6:06:00,6:06:00,C,3,1\n",
    feedInfoCsv: null,
    ...over,
  };
}

function route(review: ReturnType<typeof reviewPredictionRisk>, name: string) {
  const found = review.routes.find((r) => r.route_short_name === name);
  assert.ok(found, `route ${name} reviewed`);
  return found;
}

function check(review: ReturnType<typeof reviewPredictionRisk>, name: string, id: string) {
  const found = route(review, name).checks.find((c) => c.id === id);
  assert.ok(found, `check ${id} on ${name}`);
  return found;
}

test("a plain local schedule raises nothing", () => {
  const review = reviewPredictionRisk(feed({}));
  assert.strictEqual(route(review, "401").flag_count, 0);
  assert.deepStrictEqual(review.routes.map((r) => r.route_short_name), ["401"]);
});

test("a stop scheduled one second after the last, a block away, is a placeholder time", () => {
  const review = reviewPredictionRisk(feed({
    stopTimesCsv:
      "trip_id,arrival_time,departure_time,stop_id,stop_sequence,timepoint\n" +
      "T1,6:00:00,6:00:00,A,1,1\nT1,6:00:01,6:00:01,B,2,0\nT1,6:06:00,6:06:00,C,3,1\n",
  }));
  const c = check(review, "401", "placeholder_times");
  assert.strictEqual(c.value, 50);
  assert.strictEqual(c.flagged, true);
});

test("two stop_times at the same platform one second apart are not a placeholder time", () => {
  const review = reviewPredictionRisk(feed({
    stopTimesCsv:
      "trip_id,arrival_time,departure_time,stop_id,stop_sequence,timepoint\n" +
      "T1,6:00:00,6:00:00,A,1,1\nT1,6:00:01,6:00:01,A,2,0\nT1,6:06:00,6:06:00,C,3,1\n",
  }));
  assert.strictEqual(check(review, "401", "placeholder_times").value, 0);
});

test("an express run is flagged for its timepoint gap and its stop-free distance", () => {
  const review = reviewPredictionRisk(feed({
    stopTimesCsv:
      "trip_id,arrival_time,departure_time,stop_id,stop_sequence,timepoint\n" +
      "T1,6:00:00,6:00:00,A,1,1\nT1,6:40:00,6:40:00,D,2,1\n",
  }));
  const gap = check(review, "401", "timepoint_gap");
  assert.strictEqual(gap.value, 40);
  assert.strictEqual(gap.flagged, true);
  const hop = check(review, "401", "longest_hop");
  assert.strictEqual(hop.value, 15.2);
  assert.strictEqual(hop.flagged, true);
});

test("the timepoint gap counts only timepoints: interpolated stops in between do not shorten it", () => {
  const review = reviewPredictionRisk(feed({
    stopTimesCsv:
      "trip_id,arrival_time,departure_time,stop_id,stop_sequence,timepoint\n" +
      "T1,6:00:00,6:00:00,A,1,1\nT1,6:15:00,6:15:00,B,2,0\nT1,6:35:00,6:35:00,C,3,1\n",
  }));
  assert.strictEqual(check(review, "401", "timepoint_gap").value, 35);
});

test("a feed without a timepoint column treats every time as exact", () => {
  const review = reviewPredictionRisk(feed({
    stopTimesCsv:
      "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n" +
      "T1,6:00:00,6:00:00,A,1\nT1,6:15:00,6:15:00,B,2\nT1,6:35:00,6:35:00,C,3\n",
  }));
  assert.strictEqual(check(review, "401", "timepoint_gap").value, 20);
});

test("a follow-on trip that leaves within three minutes is a tight turnaround, and on another route is interlined", () => {
  const review = reviewPredictionRisk(feed({
    tripsCsv:
      "route_id,service_id,trip_id,direction_id,block_id\n" +
      "R1,S,T1,0,B1\nR2,S,T2,1,B1\nR2,S,T3,0,B1\n",
    stopTimesCsv:
      "trip_id,arrival_time,departure_time,stop_id,stop_sequence,timepoint\n" +
      "T1,6:00:00,6:00:00,A,1,1\nT1,6:10:00,6:10:00,C,2,1\n" +
      "T2,6:12:00,6:12:00,C,1,1\nT2,6:22:00,6:22:00,A,2,1\n" +
      "T3,6:40:00,6:40:00,A,1,1\nT3,6:50:00,6:50:00,C,2,1\n",
  }));
  // T2 follows T1 two minutes later from another route; T3 follows T2 after 18.
  const tight = check(review, "402", "tight_turnarounds");
  assert.strictEqual(tight.value, 50);
  assert.strictEqual(tight.flagged, true);
  assert.strictEqual(check(review, "402", "interlined").value, 50);
  assert.strictEqual(check(review, "402", "interlined").flagged, true);
  // The first trip of a block follows nothing, so it is not counted at all.
  assert.strictEqual(check(review, "401", "tight_turnarounds").value, null);
});

test("blocks are separate per service day: the same block id on another service is not a follow-on", () => {
  const review = reviewPredictionRisk(feed({
    tripsCsv: "route_id,service_id,trip_id,direction_id,block_id\nR1,WK,T1,0,B1\nR1,SA,T2,0,B1\n",
    stopTimesCsv:
      "trip_id,arrival_time,departure_time,stop_id,stop_sequence,timepoint\n" +
      "T1,6:00:00,6:00:00,A,1,1\nT1,6:10:00,6:10:00,C,2,1\n" +
      "T2,6:11:00,6:11:00,A,1,1\nT2,6:21:00,6:21:00,C,2,1\n",
  }));
  assert.strictEqual(check(review, "401", "tight_turnarounds").value, null);
});

test("a trip scheduled to start before the previous one on its block ends is an impossible block", () => {
  const review = reviewPredictionRisk(feed({
    tripsCsv: "route_id,service_id,trip_id,direction_id,block_id\nR1,S,T1,0,B1\nR1,S,T2,1,B1\n",
    stopTimesCsv:
      "trip_id,arrival_time,departure_time,stop_id,stop_sequence,timepoint\n" +
      "T1,6:00:00,6:00:00,A,1,1\nT1,6:10:00,6:10:00,C,2,1\n" +
      "T2,6:08:00,6:08:00,C,1,1\nT2,6:18:00,6:18:00,A,2,1\n",
  }));
  const overlap = check(review, "401", "block_overlaps");
  assert.strictEqual(overlap.value, 1);
  assert.strictEqual(overlap.flagged, true);
});

test("the same stop pattern scheduled for very different run times is flagged as run-time spread", () => {
  const review = reviewPredictionRisk(feed({
    tripsCsv: "route_id,service_id,trip_id,direction_id,block_id\nR1,S,T1,0,\nR1,S,T2,0,\n",
    stopTimesCsv:
      "trip_id,arrival_time,departure_time,stop_id,stop_sequence,timepoint\n" +
      "T1,6:00:00,6:00:00,A,1,1\nT1,6:30:00,6:30:00,D,2,1\n" +
      "T2,16:00:00,16:00:00,A,1,1\nT2,16:50:00,16:50:00,D,2,1\n",
  }));
  const spread = check(review, "401", "run_time_spread");
  assert.strictEqual(spread.value, 20);
  assert.strictEqual(spread.flagged, true);
});

test("routes needing the most attention come first, then in route order", () => {
  const review = reviewPredictionRisk(feed({
    tripsCsv: "route_id,service_id,trip_id,direction_id,block_id\nR1,S,T1,0,\nR2,S,T2,0,\n",
    stopTimesCsv:
      "trip_id,arrival_time,departure_time,stop_id,stop_sequence,timepoint\n" +
      "T1,6:00:00,6:00:00,A,1,1\nT1,6:06:00,6:06:00,C,2,1\n" +
      "T2,6:00:00,6:00:00,A,1,1\nT2,6:45:00,6:45:00,D,2,1\n",
  }));
  assert.deepStrictEqual(review.routes.map((r) => r.route_short_name), ["402", "401"]);
});

test("the feed's own version and dates are carried, and a feed without feed_info.txt is still reviewed", () => {
  const withInfo = reviewPredictionRisk(feed({
    feedInfoCsv: "feed_publisher_name,feed_start_date,feed_end_date,feed_version\nMVTA,20260909,20261101,20260909\n",
  }));
  assert.deepStrictEqual(withInfo.feed, { version: "20260909", start_date: "20260909", end_date: "20261101" });
  assert.deepStrictEqual(reviewPredictionRisk(feed({})).feed, { version: null, start_date: null, end_date: null });
});

test("every route reports every check, in the declared order", () => {
  const review = reviewPredictionRisk(feed({}));
  assert.deepStrictEqual(route(review, "401").checks.map((c) => c.id), PREDICTION_RISK_CHECKS.map((c) => c.id));
});

test("trips past midnight (25:10:00) are timed on the uncapped GTFS clock", () => {
  const review = reviewPredictionRisk(feed({
    stopTimesCsv:
      "trip_id,arrival_time,departure_time,stop_id,stop_sequence,timepoint\n" +
      "T1,23:50:00,23:50:00,A,1,1\nT1,24:30:00,24:30:00,C,2,1\n",
  }));
  assert.strictEqual(check(review, "401", "timepoint_gap").value, 40);
});
