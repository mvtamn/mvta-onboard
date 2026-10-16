import { test } from "node:test";
import assert from "node:assert";
import { BENCHMARK_BUCKETS, benchmark, bucketFor, combine, emptyTallies, scorePrediction, tally } from "./benchmark";

const T = 1_800_000_000; // sampling moment, epoch seconds

test("the four buckets and windows are the published ones", () => {
  assert.deepStrictEqual(
    BENCHMARK_BUCKETS.map((b) => [b.id, b.fromSeconds / 60, b.toSeconds / 60, b.earlySeconds, b.lateSeconds]),
    [["0-3", 0, 3, 30, 90], ["3-6", 3, 6, 60, 150], ["6-10", 6, 10, 60, 210], ["10-15", 10, 15, 90, 270]],
  );
});

test("a prediction is bucketed by when the bus actually arrived, start inclusive and end exclusive", () => {
  assert.strictEqual(bucketFor(0)?.id, "0-3");
  assert.strictEqual(bucketFor(179)?.id, "0-3");
  assert.strictEqual(bucketFor(180)?.id, "3-6");
  assert.strictEqual(bucketFor(899)?.id, "10-15");
  assert.strictEqual(bucketFor(900), null);
  assert.strictEqual(bucketFor(-1), null);
});

test("0-3 minutes away: the bus may come up to 30 s before or 90 s after the predicted time, limits included", () => {
  const actual = T + 120;
  assert.deepStrictEqual(scorePrediction(T, actual + 30, actual), { counted: true, bucket: "0-3", accurate: true, arrivedEarly: false, arrivedLate: false });
  assert.deepStrictEqual(scorePrediction(T, actual + 31, actual), { counted: true, bucket: "0-3", accurate: false, arrivedEarly: true, arrivedLate: false });
  assert.deepStrictEqual(scorePrediction(T, actual - 90, actual), { counted: true, bucket: "0-3", accurate: true, arrivedEarly: false, arrivedLate: false });
  assert.deepStrictEqual(scorePrediction(T, actual - 91, actual), { counted: true, bucket: "0-3", accurate: false, arrivedEarly: false, arrivedLate: true });
});

test("further out the windows widen, and an early bus is always held tighter than a late one", () => {
  // 12 minutes away: 1.5 min early or 4.5 min late is still accurate.
  const actual = T + 720;
  assert.strictEqual((scorePrediction(T, actual + 90, actual) as { accurate: boolean }).accurate, true);
  assert.strictEqual((scorePrediction(T, actual - 270, actual) as { accurate: boolean }).accurate, true);
  assert.strictEqual((scorePrediction(T, actual - 271, actual) as { accurate: boolean }).accurate, false);
  for (const b of BENCHMARK_BUCKETS) assert.ok(b.earlySeconds < b.lateSeconds, b.id);
});

test("a prediction for a bus that arrived 15 minutes or more later is not counted", () => {
  assert.deepStrictEqual(scorePrediction(T, T + 900, T + 900), { counted: false });
});

test("the overall figure is the straight average of the bucket shares, not the pooled share", () => {
  const t = emptyTallies();
  // 0-3: 9 of 10 accurate; the tenth bus came 2 min after its ETA (still 2.5 min away).
  for (let i = 0; i < 10; i++) tally(t, scorePrediction(T, T + 30, i === 0 ? T + 150 : T + 30));
  // 10-15: 1 of 100 accurate; the rest arrived 10 min after an ETA that said under 2.
  for (let i = 0; i < 100; i++) tally(t, scorePrediction(T, i === 0 ? T + 700 : T + 100, T + 700));
  t["3-6"] = { predictions: 4, accurate: 2, early: 1, late: 1 };
  t["6-10"] = { predictions: 4, accurate: 4, early: 0, late: 0 };
  const result = benchmark(t);
  assert.deepStrictEqual(result.buckets, { "0-3": 0.9, "3-6": 0.5, "6-10": 1, "10-15": 0.01 });
  assert.strictEqual(result.overall, (0.9 + 0.5 + 1 + 0.01) / 4);
  assert.deepStrictEqual(result.missingBuckets, []);
  assert.strictEqual(result.predictions, 118);
  assert.deepStrictEqual(t["0-3"], { predictions: 10, accurate: 9, early: 0, late: 1 });
});

test("a bucket with no predictions is left out of the average and named", () => {
  const t = emptyTallies();
  t["0-3"] = { predictions: 2, accurate: 2, early: 0, late: 0 };
  t["3-6"] = { predictions: 2, accurate: 0, early: 0, late: 2 };
  const result = benchmark(t);
  assert.strictEqual(result.overall, 0.5);
  assert.deepStrictEqual(result.missingBuckets, ["6-10", "10-15"]);
  assert.strictEqual(benchmark(emptyTallies()).overall, null);
});

test("the agency figure is the benchmark over everyone's tallies combined, not an average of routes", () => {
  const a = emptyTallies();
  const b = emptyTallies();
  for (const id of ["0-3", "3-6", "6-10", "10-15"] as const) {
    a[id] = { predictions: 100, accurate: 90, early: 5, late: 5 };
    b[id] = { predictions: 10, accurate: 1, early: 9, late: 0 };
  }
  const agency = benchmark(combine(a, b));
  assert.strictEqual(agency.overall, 91 / 110);
  assert.notStrictEqual(agency.overall, ((benchmark(a).overall ?? 0) + (benchmark(b).overall ?? 0)) / 2);
});
