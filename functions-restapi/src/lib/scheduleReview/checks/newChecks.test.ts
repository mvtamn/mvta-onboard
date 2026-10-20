import { test } from "node:test";
import assert from "node:assert";
import { reviewSchedule } from "../index";
import { at, feed, ST_HEADER } from "../fixture.test-support";

function check(review: ReturnType<typeof reviewSchedule>, name: string, id: string) {
  const route = review.details.find((r) => r.route_short_name === name);
  assert.ok(route, `route ${name}`);
  const found = route.checks.find((c) => c.id === id);
  assert.ok(found, `check ${id}`);
  return found;
}

/** One pattern A→C run at the given start hours with the given running times. */
function pattern(runs: { hour: number; minutes: number }[]) {
  const trips = runs.map((_, i) => `R1,S,T${i},0,`);
  const stopTimes = runs.map((run, i) =>
    `T${i},${at(run.hour * 60)},${at(run.hour * 60)},A,1,1\nT${i},${at(run.hour * 60 + run.minutes)},${at(run.hour * 60 + run.minutes)},C,2,1`);
  return feed({
    tripsCsv: "route_id,service_id,trip_id,direction_id,block_id\n" + trips.join("\n") + "\n",
    stopTimesCsv: ST_HEADER + stopTimes.join("\n") + "\n",
  });
}

test("one running time from the morning peak to the evening is flagged as the same running time all day", () => {
  const review = reviewSchedule(pattern([6, 7, 8, 10, 12, 14, 16, 17].map((hour) => ({ hour, minutes: 40 }))));
  const c = check(review, "401", "run_time_flat");
  assert.strictEqual(c.value, 100);
  assert.strictEqual(c.flagged, true);
  assert.deepStrictEqual(c.evidence.map((e) => [e.text, e.count, e.value]), [
    ["A → C (2 stops): 8 trips from 06:00 to 17:59, every one 40 min", 8, 40],
  ]);
});

test("a pattern whose peak trips are given more time is not flat", () => {
  const review = reviewSchedule(pattern([
    { hour: 6, minutes: 40 }, { hour: 7, minutes: 46 }, { hour: 8, minutes: 46 },
    { hour: 10, minutes: 40 }, { hour: 12, minutes: 40 }, { hour: 16, minutes: 48 },
  ]));
  const c = check(review, "401", "run_time_flat");
  assert.strictEqual(c.value, 0);
  assert.strictEqual(c.flagged, false);
  assert.deepStrictEqual(c.evidence, []);
});

test("a pattern that only runs in the peak has nothing to compare, so the check has no value", () => {
  const review = reviewSchedule(pattern([{ hour: 6, minutes: 40 }, { hour: 7, minutes: 40 }, { hour: 8, minutes: 40 }]));
  assert.strictEqual(check(review, "401", "run_time_flat").value, null);
});

test("timepoint density is the longest run of stops between two timepoints", () => {
  const review = reviewSchedule(feed({
    stopTimesCsv: ST_HEADER +
      "T1,6:00:00,6:00:00,A,1,1\nT1,6:03:00,6:03:00,B,2,0\nT1,6:06:00,6:06:00,C,3,0\nT1,6:30:00,6:30:00,D,4,1\n",
  }));
  const c = check(review, "401", "timepoint_density");
  assert.strictEqual(c.value, 2);
  assert.strictEqual(c.flagged, false);
  assert.deepStrictEqual(c.evidence.map((e) => [e.text, e.value, e.count, e.stop_ids]), [["A → D: 2 stops in between, 1 trip", 2, 1, ["A", "D"]]]);
});

test("a feed with no timepoint column holds every stop, so no run of stops is unheld", () => {
  const review = reviewSchedule(feed({
    stopTimesCsv: "trip_id,arrival_time,departure_time,stop_id,stop_sequence\nT1,6:00:00,6:00:00,A,1\nT1,6:03:00,6:03:00,B,2\nT1,6:06:00,6:06:00,C,3\n",
  }));
  assert.strictEqual(check(review, "401", "timepoint_density").value, 0);
});

/** Enough A→D trips (24 km apart) with shape distances in feet to calibrate the unit. */
function expressFeed(minutes: number) {
  const trips: string[] = [];
  const stopTimes: string[] = [];
  for (let i = 0; i < 25; i++) {
    trips.push(`R1,S,T${i},0,`);
    const start = 300 + i * 10;
    stopTimes.push(`T${i},${at(start)},${at(start)},A,1,1,0`);
    stopTimes.push(`T${i},${at(start + minutes)},${at(start + minutes)},D,2,1,96000`);
  }
  return feed({
    tripsCsv: "route_id,service_id,trip_id,direction_id,block_id\n" + trips.join("\n") + "\n",
    stopTimesCsv: "trip_id,arrival_time,departure_time,stop_id,stop_sequence,timepoint,shape_dist_traveled\n" + stopTimes.join("\n") + "\n",
  });
}

test("with shape distances in feet, a segment scheduled faster than a bus can drive is an implausible speed", () => {
  const review = reviewSchedule(expressFeed(10));
  assert.strictEqual(review.distance.unit, "feet");
  const c = check(review, "401", "implied_speed");
  assert.strictEqual(c.value, 1);
  assert.strictEqual(c.flagged, true);
  assert.strictEqual(c.evidence.length, 1);
  assert.match(c.evidence[0].text, /^A → D: 18\.2 mi in 10 min = 109 mph, 25 trips$/);
  // The longest hop reads along the route (18.2 mi), not as the crow flies (15.2).
  assert.strictEqual(check(review, "401", "longest_hop").value, 18.2);
});

test("the same segment at a speed a bus keeps is not flagged", () => {
  const c = check(reviewSchedule(expressFeed(40)), "401", "implied_speed");
  assert.strictEqual(c.value, 0);
  assert.strictEqual(c.flagged, false);
});

test("without a calibrated distance, implied speed is not measured rather than guessed from straight lines", () => {
  const c = check(reviewSchedule(feed({})), "401", "implied_speed");
  assert.strictEqual(c.value, null);
  assert.strictEqual(c.flagged, false);
});

test("recovery time is the median layover before a route's trips, flagged when it is a few minutes, with the spread as evidence", () => {
  const review = reviewSchedule(feed({
    tripsCsv:
      "route_id,service_id,trip_id,direction_id,block_id\n" +
      "R1,S,T1,0,B1\nR2,S,T2,1,B1\nR2,S,T3,0,B1\nR2,S,T4,1,B1\n",
    stopTimesCsv: ST_HEADER +
      "T1,6:00:00,6:00:00,A,1,1\nT1,6:10:00,6:10:00,C,2,1\n" +
      "T2,6:12:00,6:12:00,C,1,1\nT2,6:22:00,6:22:00,A,2,1\n" +
      "T3,6:40:00,6:40:00,A,1,1\nT3,6:50:00,6:50:00,C,2,1\n" +
      "T4,6:53:00,6:53:00,C,1,1\nT4,7:03:00,7:03:00,A,2,1\n",
  }));
  // Layovers before 402's trips: 2, 18 and 3 minutes.
  const c = check(review, "402", "recovery_time");
  assert.strictEqual(c.value, 3);
  assert.strictEqual(c.flagged, true);
  assert.deepStrictEqual(c.evidence.map((e) => [e.text, e.count]), [
    ["Under 3 min: 1 trip (33%)", 1],
    ["3–5 min: 1 trip (33%)", 1],
    ["6–10 min: 0 trips (0%)", 0],
    ["11–20 min: 1 trip (33%)", 1],
    ["Over 20 min: 0 trips (0%)", 0],
  ]);
  // The first trip of a block follows nothing.
  assert.strictEqual(check(review, "401", "recovery_time").value, null);
});

test("a check read the other way round flags at or below its threshold", () => {
  const review = reviewSchedule(feed({}));
  const definition = review.summary.checks.find((c) => c.id === "recovery_time");
  assert.strictEqual(definition?.comparison, "at_most");
  assert.ok(review.summary.checks.filter((c) => c.comparison === "at_least").length === review.summary.checks.length - 1);
});
