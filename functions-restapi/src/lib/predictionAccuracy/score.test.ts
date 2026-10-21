import { test } from "node:test";
import assert from "node:assert";
import { scoreServiceDay, serviceDayOf, STALE_FEED_SECONDS } from "./score";
import { benchmark } from "./benchmark";
import type { CaptureRecord, StopTimeRecord, VehicleRecord } from "./captureFile";

const T0 = Date.UTC(2026, 9, 20, 17, 0, 0) / 1000; // 12:00 CDT on service day 20261020

const run = (runAt: number, tripUpdatesAt: number | null = runAt - 5): CaptureRecord => ({ kind: "R", runAt, tripUpdatesAt, vehiclesAt: runAt - 3 });
const stopTime = (kind: "P" | "B", sampledAt: number, at: number, stopSequence = 3600, tripId = "t1"): StopTimeRecord =>
  ({ kind, sampledAt, tripId, routeId: "420", startDate: "20261020", stopSequence, stopId: `S${stopSequence}`, at, vehicleId: "4128" });
const vehicle = (at: number, stopSequence: number, status: VehicleRecord["status"]): VehicleRecord =>
  ({ kind: "V", feedAt: at + 4, vehicleAt: at, vehicleId: "4128", tripId: "t1", routeId: "420", stopSequence, stopId: `S${stopSequence}`, status });

// The bus reaches stop 3600 after T0+30 and by T0+60.
const VEHICLES = [vehicle(T0, 3600, "in_transit"), vehicle(T0 + 30, 3600, "incoming"), vehicle(T0 + 60, 3600, "stopped"), vehicle(T0 + 90, 3840, "in_transit")];
const S = T0 - 60; // published a minute before

test("each prediction is scored against its arrival interval, and everything left out is counted with its reason", () => {
  const records: CaptureRecord[] = [
    ...VEHICLES,
    run(S + 5),
    stopTime("P", S, T0 + 45), //             within -30/+90 at both ends: accurate
    stopTime("P", S - 1, S + 1), //           +89 at one end, +119 at the other: indeterminate
    stopTime("B", S - 2, T0 - 100), //        an overdue ETA riders were shown: late at both ends
    stopTime("P", T0 - 1000, T0 + 40), //     bus came more than 15 minutes after sampling
    stopTime("P", S, T0 + 300, 3600, "t2"), // no vehicle ever reported trip t2
    run(S + 35, S + 35 - STALE_FEED_SECONDS - 1),
    stopTime("P", S + 20, T0 + 45), //        from a run whose TripUpdates were stale
    run(T0 + 75),
    stopTime("P", S, T0 + 45), //             the same sample captured again
    stopTime("B", T0 + 70, T0 + 55), //       Avail's kept time for the stop just reached
    stopTime("P", T0 + 24 * 3600, T0 + 24 * 3600 + 60), // the next service day
  ];
  const day = scoreServiceDay("20261020", records, new Map([["t1", 1]]));

  assert.strictEqual(day.runs, 3);
  assert.strictEqual(day.staleRuns, 1);
  assert.strictEqual(day.lastRunAt, T0 + 75);
  assert.strictEqual(day.samples, 8);
  assert.deepStrictEqual(
    { duplicate: day.duplicate, stale: day.stale, passed: day.passed, outOfRange: day.outOfRange, indeterminate: day.indeterminate, scored: day.scored },
    { duplicate: 1, stale: 1, passed: 1, outOfRange: 1, indeterminate: 1, scored: 2 },
  );
  assert.deepStrictEqual(day.noActual, { noVehicle: 1, unseen: 0, notReached: 0, gap: 0 });
  assert.deepStrictEqual(day.tallies["0-3"], { predictions: 2, accurate: 1, early: 0, late: 1 });
  assert.strictEqual(benchmark(day.tallies).overall, 0.5);
  assert.deepStrictEqual(day.crossCheck, { compared: 1, agreed: 1, medianOffsetSeconds: 10 });
  assert.deepStrictEqual(day.routeHours, [{ routeId: "420", directionId: 1, hour: 11, bucket: "0-3", predictions: 2, accurate: 1, early: 0, late: 1, indeterminate: 1 }]);
  assert.deepStrictEqual(day.stops, [{ routeId: "420", stopId: "S3600", bucket: "0-3", predictions: 2, accurate: 1, early: 0, late: 1, indeterminate: 1 }]);
});

test("a service day runs 03:00 to 03:00 Central, so a trip after midnight belongs to the day before", () => {
  const centralMidnightPlusOne = Date.UTC(2026, 9, 21, 6, 0, 0) / 1000; // 01:00 CDT on Oct 21
  assert.strictEqual(serviceDayOf(centralMidnightPlusOne), "20261020");
  assert.strictEqual(serviceDayOf(centralMidnightPlusOne + 2 * 3600), "20261021");
});

test("a trip not in the static feed is scored with no direction", () => {
  const day = scoreServiceDay("20261020", [...VEHICLES, run(S + 5), stopTime("P", S, T0 + 45)]);
  assert.strictEqual(day.routeHours[0].directionId, null);
  assert.strictEqual(day.scored, 1);
});
