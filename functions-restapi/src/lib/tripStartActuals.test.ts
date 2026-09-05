import test from "node:test";
import assert from "node:assert/strict";
import type { GtfsRtTripUpdate } from "./gtfsTripUpdates";
import {
  LINGER_WINDOW_SECONDS,
  ON_TIME_TOLERANCE_SECONDS,
  planCapture,
  readFirstStop,
  startStatusFor,
  type TripStartRow,
} from "./tripStartActuals";

// Shaped like MVTA's live feed (sampled 2026-09-05): non-contiguous stop
// sequences, a first stop at sequence 0, Departure and Arrival both present.
const FEED_AT = new Date("2026-09-05T14:08:17Z");
const feedSeconds = Math.floor(FEED_AT.getTime() / 1000);
const SCHEDULED = new Date("2026-09-05T13:55:00Z");

function row(overrides: Partial<TripStartRow> = {}): TripStartRow {
  return {
    service_date: "20260905",
    trip_id: "t350-b1FA-sl1B-v63",
    origin_stop_id: "31837",
    first_stop_sequence: 0,
    scheduled_start_at: SCHEDULED,
    actual_start_at: null,
    actual_start_source: null,
    predicted_start_at: null,
    start_status: "unknown",
    first_underway_at: null,
    missed: false,
    ...overrides,
  };
}

function update(stops: Array<{ seq: number; stopId: string; dep: number }>, relationship = 0): GtfsRtTripUpdate {
  return {
    Trip: { TripId: "t350-b1FA-sl1B-v63", RouteId: "440", StartDate: "20260905", schedule_relationship: relationship },
    Vehicle: { Id: "4848", Label: "4848" },
    StopTimeUpdates: stops.map((s) => ({
      StopSequence: s.seq,
      StopId: s.stopId,
      Arrival: { Delay: 0, Time: s.dep - 20 },
      Departure: { Delay: 0, Time: s.dep },
      schedule_relationship: 0,
    })),
    Timestamp: feedSeconds - 8,
  };
}

test("a first stop still ahead of the feed clock is a prediction, behind it the actual", () => {
  const ahead = update([{ seq: 0, stopId: "31837", dep: feedSeconds + 300 }]);
  assert.deepEqual(readFirstStop(ahead, row(), feedSeconds), { kind: "predicted", at: new Date((feedSeconds + 300) * 1000) });
  const behind = update([{ seq: 0, stopId: "31837", dep: feedSeconds - 120 }]);
  assert.deepEqual(readFirstStop(behind, row(), feedSeconds), { kind: "realised", at: new Date((feedSeconds - 120) * 1000) });
  // Just behind the clock is still within the grace and reads as a prediction.
  const edge = update([{ seq: 0, stopId: "31837", dep: feedSeconds - 10 }]);
  assert.equal(readFirstStop(edge, row(), feedSeconds).kind, "predicted");
});

test("matches the first stop by stop id first, then by the schedule's sequence, never by 'sequence 1'", () => {
  const byId = update([{ seq: 4020, stopId: "31837", dep: feedSeconds - 100 }, { seq: 4260, stopId: "31838", dep: feedSeconds + 100 }]);
  assert.equal(readFirstStop(byId, row({ first_stop_sequence: 999 }), feedSeconds).kind, "realised");
  const bySeq = update([{ seq: 0, stopId: null as unknown as string, dep: feedSeconds - 100 }]);
  assert.equal(readFirstStop(bySeq, row({ origin_stop_id: "nope" }), feedSeconds).kind, "realised");
  const neither = update([{ seq: 1, stopId: "other", dep: feedSeconds - 100 }]);
  assert.equal(readFirstStop(neither, row(), feedSeconds).kind, "absent");
});

test("under a minute late is on time; a minute or more is late", () => {
  assert.equal(startStatusFor(-30), "on_time");
  assert.equal(startStatusFor(ON_TIME_TOLERANCE_SECONDS), "on_time");
  assert.equal(startStatusFor(ON_TIME_TOLERANCE_SECONDS + 1), "late");
});

test("a realised first stop becomes the actual, with delay and status against the schedule", () => {
  const dep = Math.floor(SCHEDULED.getTime() / 1000) + 150;
  const plan = planCapture(row(), update([{ seq: 0, stopId: "31837", dep }]), FEED_AT);
  assert.deepEqual(plan, {
    actual_start_at: new Date(dep * 1000),
    actual_start_source: "trip_update",
    start_delay_seconds: 150,
    start_status: "late",
    predicted_start_at: null,
  });
});

test("a prediction is remembered but never promoted to an actual on its own", () => {
  const dep = feedSeconds + 240;
  const plan = planCapture(row(), update([{ seq: 0, stopId: "31837", dep }]), FEED_AT);
  assert.equal(plan?.actual_start_at, null);
  assert.equal(plan?.start_status, "unknown");
  assert.deepEqual(plan?.predicted_start_at, new Date(dep * 1000));
  // Seeing the same prediction again writes nothing.
  assert.equal(planCapture(row({ predicted_start_at: new Date(dep * 1000) }), update([{ seq: 0, stopId: "31837", dep }]), FEED_AT), null);
});

test("a realised time revised while it lingers replaces the earlier actual; an unchanged one writes nothing", () => {
  const first = new Date((feedSeconds - 600) * 1000);
  const have = row({ actual_start_at: first, actual_start_source: "trip_update", start_status: "late" });
  assert.equal(planCapture(have, update([{ seq: 0, stopId: "31837", dep: feedSeconds - 600 }]), FEED_AT), null);
  const revised = planCapture(have, update([{ seq: 0, stopId: "31837", dep: feedSeconds - 960 }]), FEED_AT);
  assert.deepEqual(revised?.actual_start_at, new Date((feedSeconds - 960) * 1000));
});

test("when the first stop has dropped before a realised time was seen, the last prediction stands in", () => {
  const predicted = new Date((feedSeconds - 900) * 1000);
  const plan = planCapture(row({ predicted_start_at: predicted }), update([{ seq: 4260, stopId: "31838", dep: feedSeconds + 60 }]), FEED_AT);
  assert.equal(plan?.actual_start_source, "trip_update");
  assert.deepEqual(plan?.actual_start_at, predicted);
});

test("with no prediction either, vehicle evidence is the fallback and is named as such", () => {
  const underway = new Date((feedSeconds - 700) * 1000);
  const plan = planCapture(row({ first_underway_at: underway }), update([{ seq: 4260, stopId: "31838", dep: feedSeconds + 60 }]), FEED_AT);
  assert.equal(plan?.actual_start_source, "vehicle_position");
  assert.deepEqual(plan?.actual_start_at, underway);
});

test("a trip absent from the feed waits out the linger window before falling back to vehicle evidence", () => {
  const underway = new Date(SCHEDULED.getTime() + 4 * 60_000);
  const early = new Date(SCHEDULED.getTime() + (LINGER_WINDOW_SECONDS - 60) * 1000);
  assert.equal(planCapture(row({ first_underway_at: underway }), null, early), null);
  const late = new Date(SCHEDULED.getTime() + (LINGER_WINDOW_SECONDS + 60) * 1000);
  assert.equal(planCapture(row({ first_underway_at: underway }), null, late)?.actual_start_source, "vehicle_position");
});

test("missed and canceled are statuses without an actual, and never overwrite one", () => {
  assert.equal(planCapture(row({ missed: true }), null, FEED_AT)?.start_status, "missed");
  assert.equal(planCapture(row({ missed: true, start_status: "missed" }), null, FEED_AT), null);
  const canceled = update([], 3);
  assert.equal(planCapture(row(), canceled, FEED_AT)?.start_status, "canceled");
  const started = row({ actual_start_at: new Date(SCHEDULED.getTime() + 30_000), actual_start_source: "trip_update", start_status: "on_time" });
  assert.equal(planCapture(started, canceled, FEED_AT), null);
  assert.equal(planCapture({ ...started, missed: true }, null, FEED_AT), null);
});
