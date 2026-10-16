import { test } from "node:test";
import assert from "node:assert";
import { reviewSchedule, reviewPredictionRisk, PREDICTION_RISK_CHECKS } from "./index";
import { feed, ST_HEADER } from "./fixture.test-support";

function detail(review: ReturnType<typeof reviewSchedule>, name: string) {
  const found = review.details.find((r) => r.route_short_name === name);
  assert.ok(found, `route ${name} detailed`);
  return found;
}

function check(review: ReturnType<typeof reviewSchedule>, name: string, id: string) {
  const found = detail(review, name).checks.find((c) => c.id === id);
  assert.ok(found, `check ${id} on ${name}`);
  return found;
}

test("the summary is the detail with the evidence left out, so the health page and the route view agree", () => {
  const review = reviewSchedule(feed({}));
  assert.deepStrictEqual(reviewPredictionRisk(feed({})), review.summary);
  const summaryRoute = review.summary.routes[0];
  const detailRoute = review.details[0];
  assert.strictEqual(summaryRoute.route_id, detailRoute.route_id);
  assert.deepStrictEqual(summaryRoute.checks, detailRoute.checks.map(({ id, value, flagged }) => ({ id, value, flagged })));
  assert.deepStrictEqual(detailRoute.checks.map((c) => c.id), PREDICTION_RISK_CHECKS.map((c) => c.id));
});

test("a route's detail counts its stops, timepoints and patterns", () => {
  const route = detail(reviewSchedule(feed({})), "401");
  assert.strictEqual(route.trip_count, 1);
  assert.strictEqual(route.stop_count, 3);
  assert.strictEqual(route.timepoint_count, 2);
  assert.strictEqual(route.pattern_count, 1);
});

test("placeholder evidence names the stop pairs, most frequent first, with the trips that carry them", () => {
  const review = reviewSchedule(feed({
    tripsCsv: "route_id,service_id,trip_id,direction_id,block_id\nR1,S,T1,0,\nR1,S,T2,0,\n",
    stopTimesCsv: ST_HEADER +
      "T1,6:00:00,6:00:00,A,1,1\nT1,6:00:01,6:00:01,B,2,0\nT1,6:00:02,6:00:02,C,3,0\nT1,6:20:00,6:20:00,D,4,1\n" +
      "T2,7:00:00,7:00:00,A,1,1\nT2,7:00:01,7:00:01,B,2,0\nT2,7:05:00,7:05:00,C,3,0\nT2,7:20:00,7:20:00,D,4,1\n",
  }));
  const c = check(review, "401", "placeholder_times");
  assert.strictEqual(c.value, 50);
  assert.deepStrictEqual(c.evidence.map((e) => [e.text, e.count, e.stop_ids, e.trip_ids]), [
    ["A → B: 2 trips", 2, ["A", "B"], ["T1", "T2"]],
    ["B → C: 1 trip", 1, ["B", "C"], ["T1"]],
  ]);
});

test("interlining evidence names the partner routes and how many trips come off each", () => {
  const review = reviewSchedule(feed({
    tripsCsv:
      "route_id,service_id,trip_id,direction_id,block_id\n" +
      "R1,S,T1,0,B1\nR2,S,T2,1,B1\nR2,S,T3,0,B1\n",
    stopTimesCsv: ST_HEADER +
      "T1,6:00:00,6:00:00,A,1,1\nT1,6:10:00,6:10:00,C,2,1\n" +
      "T2,6:12:00,6:12:00,C,1,1\nT2,6:22:00,6:22:00,A,2,1\n" +
      "T3,6:40:00,6:40:00,A,1,1\nT3,6:50:00,6:50:00,C,2,1\n",
  }));
  const c = check(review, "402", "interlined");
  assert.strictEqual(c.value, 50);
  assert.deepStrictEqual(c.evidence.map((e) => [e.text, e.count, e.trip_ids]), [["From route 401: 1 trip", 1, ["T2"]]]);
  const tight = check(review, "402", "tight_turnarounds");
  assert.strictEqual(tight.evidence.length, 1);
  assert.match(tight.evidence[0].text, /^06:12 from C: bus arrives 06:10 off route 401, 2 min to turn$/);
  assert.deepStrictEqual(tight.evidence[0].trip_ids, ["T1", "T2"]);
  assert.strictEqual(tight.evidence[0].count, 1);
});

test("the same tight hand-over on two service days is one evidence row with a count, not two", () => {
  const review = reviewSchedule(feed({
    tripsCsv:
      "route_id,service_id,trip_id,direction_id,block_id\n" +
      "R1,WK,T1,0,B1\nR2,WK,T2,1,B1\nR1,SA,T3,0,B1\nR2,SA,T4,1,B1\n",
    stopTimesCsv: ST_HEADER +
      "T1,6:00:00,6:00:00,A,1,1\nT1,6:10:00,6:10:00,C,2,1\nT2,6:12:00,6:12:00,C,1,1\nT2,6:22:00,6:22:00,A,2,1\n" +
      "T3,6:00:00,6:00:00,A,1,1\nT3,6:10:00,6:10:00,C,2,1\nT4,6:12:00,6:12:00,C,1,1\nT4,6:22:00,6:22:00,A,2,1\n",
  }));
  const tight = check(review, "402", "tight_turnarounds");
  assert.strictEqual(tight.value, 100);
  assert.deepStrictEqual(tight.evidence.map((e) => [e.text, e.count, e.trip_ids]), [
    ["06:12 from C: bus arrives 06:10 off route 401, 2 min to turn (2 service days)", 2, ["T1", "T2", "T3", "T4"]],
  ]);
});

test("the timepoint gap's evidence is the segment behind it, with the trips that run it", () => {
  const review = reviewSchedule(feed({
    stopTimesCsv: ST_HEADER + "T1,6:00:00,6:00:00,A,1,1\nT1,6:15:00,6:15:00,B,2,0\nT1,6:35:00,6:35:00,C,3,1\n",
  }));
  const c = check(review, "401", "timepoint_gap");
  assert.strictEqual(c.value, 35);
  assert.deepStrictEqual(c.evidence.map((e) => [e.text, e.value, e.stop_ids]), [["A → C: up to 35 min, 1 trip", 35, ["A", "C"]]]);
});

test("timepoint segments carry the scheduled minutes per start hour, so a flat day is visible as a row", () => {
  const trips = ["T1,6:00:00,6:00:00,A,1,1\nT1,6:06:00,6:06:00,C,2,1", "T2,12:00:00,12:00:00,A,1,1\nT2,12:06:00,12:06:00,C,2,1", "T3,12:30:00,12:30:00,A,1,1\nT3,12:38:00,12:38:00,C,2,1"];
  const review = reviewSchedule(feed({
    tripsCsv: "route_id,service_id,trip_id,direction_id,block_id\nR1,S,T1,0,\nR1,S,T2,0,\nR1,S,T3,0,\n",
    stopTimesCsv: ST_HEADER + trips.join("\n") + "\n",
  }));
  const [segment] = detail(review, "401").segments;
  assert.strictEqual(segment.from_stop_name, "A");
  assert.strictEqual(segment.to_stop_name, "C");
  assert.strictEqual(segment.miles, 1.4);
  assert.deepStrictEqual(segment.hours, [
    { hour: 6, trips: 1, min_minutes: 6, max_minutes: 6 },
    { hour: 12, trips: 2, min_minutes: 6, max_minutes: 8 },
  ]);
});

test("trips past midnight fold into the early hours for grouping", () => {
  const review = reviewSchedule(feed({
    stopTimesCsv: ST_HEADER + "T1,25:10:00,25:10:00,A,1,1\nT1,25:16:00,25:16:00,C,2,1\n",
  }));
  assert.deepStrictEqual(detail(review, "401").segments[0].hours.map((h) => h.hour), [1]);
});

test("a feed without shape distances is reviewed on straight lines and says so", () => {
  assert.deepStrictEqual(reviewSchedule(feed({})).distance, { unit: "unknown", factor_to_metres: null, samples: 0 });
});

test("the evidence behind a check is capped so a route's detail stays small", () => {
  // 40 distinct placeholder pairs on one trip need 41 stops; lay them out 150 m apart.
  const stops = ["stop_id,stop_name,stop_lat,stop_lon"];
  const stopTimes = [ST_HEADER.trim()];
  for (let i = 0; i <= 40; i++) {
    stops.push(`S${i},Stop ${i},${(44.7 + i * 0.0015).toFixed(4)},-93.20`);
    stopTimes.push(`T1,6:00:${String(i).padStart(2, "0")},6:00:${String(i).padStart(2, "0")},S${i},${i + 1},${i === 0 || i === 40 ? 1 : 0}`);
  }
  const review = reviewSchedule(feed({ stopsCsv: stops.join("\n") + "\n", stopTimesCsv: stopTimes.join("\n") + "\n" }));
  const c = check(review, "401", "placeholder_times");
  assert.strictEqual(c.value, 100);
  assert.strictEqual(c.evidence.length, 25);
  assert.strictEqual(c.evidence[24].text, "16 more stop pairs not shown");
});

test("a segment carries the direction its trips' headsigns name, so it can be matched to Avail's", () => {
  const review = reviewSchedule(feed({
    tripsCsv:
      "route_id,service_id,trip_id,trip_headsign,direction_id,block_id\n" +
      "R1,S,T1,West to Apple Valley TS,0,\nR1,S,T2,Apple Valley TS,0,\nR1,S,T3,East to Rosemount,1,\n",
    stopTimesCsv: ST_HEADER +
      "T1,6:00:00,6:00:00,A,1,1\nT1,6:06:00,6:06:00,C,2,1\n" +
      // T2's headsign names no direction: it takes the one its direction_id's other trips carry.
      "T2,7:00:00,7:00:00,A,1,1\nT2,7:06:00,7:06:00,C,2,1\n" +
      "T3,8:00:00,8:00:00,C,1,1\nT3,8:06:00,8:06:00,A,2,1\n",
  }));
  const route = review.details.find((r) => r.route_short_name === "401");
  assert.deepStrictEqual(route?.segments.map((s) => [s.from_stop_id, s.to_stop_id, s.direction]), [["A", "C", "W"], ["C", "A", "E"]]);
});

test("a segment whose trips disagree on direction, or name none, has no direction", () => {
  const review = reviewSchedule(feed({
    tripsCsv: "route_id,service_id,trip_id,trip_headsign,direction_id,block_id\nR1,S,T1,North,0,\nR1,S,T2,South,1,\nR1,S,T3,Downtown,2,\n",
    stopTimesCsv: ST_HEADER +
      "T1,6:00:00,6:00:00,A,1,1\nT1,6:06:00,6:06:00,C,2,1\nT2,7:00:00,7:00:00,A,1,1\nT2,7:06:00,7:06:00,C,2,1\n" +
      "T3,8:00:00,8:00:00,C,1,1\nT3,8:06:00,8:06:00,D,2,1\n",
  }));
  const route = review.details.find((r) => r.route_short_name === "401");
  assert.deepStrictEqual(route?.segments.map((s) => s.direction), [null, null]);
});

test("a segment's minutes are filed under the hour the bus leaves its first timepoint, not the hour the trip started", () => {
  // The trip starts at 6:50 but reaches C, the segment C->D's first timepoint, at 7:05.
  const review = reviewSchedule(feed({
    stopTimesCsv: ST_HEADER + "T1,6:50:00,6:50:00,A,1,1\nT1,7:05:00,7:05:00,C,2,1\nT1,7:30:00,7:30:00,D,3,1\n",
  }));
  const route = review.details.find((r) => r.route_short_name === "401");
  assert.deepStrictEqual(route?.segments.map((s) => [s.from_stop_id, s.to_stop_id, s.hours.map((h) => h.hour)]), [["A", "C", [6]], ["C", "D", [7]]]);
});

test("a segment says whether it is scheduled the same all day, by the same rule the readings use", () => {
  const trips = [6, 7, 10, 12, 16].map((h, i) => `T${i},${h}:00:00,${h}:00:00,A,1,1\nT${i},${h}:06:00,${h}:06:00,C,2,1`);
  const flat = reviewSchedule(feed({
    tripsCsv: "route_id,service_id,trip_id,direction_id,block_id\n" + trips.map((_, i) => `R1,S,T${i},0,`).join("\n") + "\n",
    stopTimesCsv: ST_HEADER + trips.join("\n") + "\n",
  }));
  assert.strictEqual(flat.details[0].segments[0].flat_all_day, true);
  assert.strictEqual(reviewSchedule(feed({})).details[0].segments[0].flat_all_day, false);
});
