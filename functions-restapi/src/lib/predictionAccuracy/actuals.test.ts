import { test } from "node:test";
import assert from "node:assert";
import { actualArrival, MAX_ACTUAL_WINDOW_SECONDS, tripTimeline, type VehicleSample } from "./actuals";

const at = (t: number, stopSequence: number, status: VehicleSample["status"]): VehicleSample => ({ at: t, stopSequence, status });

test("a stop is reached between the last sample heading to it and the first at or past it, with gapped sequences", () => {
  const timeline = tripTimeline([
    at(1000, 3600, "in_transit"),
    at(1030, 3600, "incoming"),
    at(1060, 3600, "stopped"),
    at(1090, 3840, "in_transit"),
  ]);
  assert.deepStrictEqual(actualArrival(timeline, 3600), { kind: "actual", from: 1030, to: 1060, timedBy: "arrival" });
  // A stop passed without stopping: reached when the bus is heading beyond it.
  assert.deepStrictEqual(actualArrival(timeline, 3700), { kind: "actual", from: 1060, to: 1090, timedBy: "arrival" });
});

test("a bus first seen standing at a stop is timed by when it leaves", () => {
  const timeline = tripTimeline([at(1000, 3240, "stopped"), at(1030, 3240, "stopped"), at(1060, 3600, "in_transit")]);
  assert.deepStrictEqual(actualArrival(timeline, 3240), { kind: "actual", from: 1030, to: 1060, timedBy: "departure" });
});

test("no actual when the bus was already past, never got there, or the samples are too far apart", () => {
  const timeline = tripTimeline([at(1000, 3600, "in_transit"), at(1030, 3600, "in_transit")]);
  assert.deepStrictEqual(actualArrival(timeline, 3240), { kind: "unseen" });
  assert.deepStrictEqual(actualArrival(timeline, 3600), { kind: "not_reached" });
  const gap = tripTimeline([at(1000, 3600, "in_transit"), at(1000 + MAX_ACTUAL_WINDOW_SECONDS + 1, 3840, "in_transit")]);
  assert.deepStrictEqual(actualArrival(gap, 3600), { kind: "gap", seconds: MAX_ACTUAL_WINDOW_SECONDS + 1 });
});

test("the timeline is in time order with one sample per timestamp", () => {
  const timeline = tripTimeline([at(1060, 3840, "in_transit"), at(1000, 3600, "in_transit"), at(1060, 3840, "in_transit")]);
  assert.deepStrictEqual(timeline.map((s) => s.at), [1000, 1060]);
});
