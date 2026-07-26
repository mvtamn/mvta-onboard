import { test } from "node:test";
import assert from "node:assert";
import {
  mapTripUpdateEntity,
  severityForDelayMinutes,
  buildDelayDraftText,
  buildDepartureRiskDraftText,
  type GtfsRtTripUpdateEntity,
} from "./gtfsTripUpdates";

// Fixture shaped like MVTA's live feed (sampled 2026-07-24, mid-service).
const RUNNING_LATE: GtfsRtTripUpdateEntity = {
  Id: "t388-b5-sl2B-v62",
  TripUpdate: {
    Trip: { TripId: "t388-b5-sl2B-v62", RouteId: "444", StartDate: "20260724", schedule_relationship: 0 },
    Vehicle: { Id: "4136", Label: "4136" },
    StopTimeUpdates: [
      {
        StopSequence: 1980,
        StopId: "31462",
        Arrival: { Delay: 76, Time: 1784903896 },
        Departure: { Delay: 93, Time: 1784903913 },
        schedule_relationship: 0,
      },
      {
        StopSequence: 2040,
        StopId: "31463",
        Arrival: { Delay: 65, Time: 1784903945 },
        Departure: { Delay: 86, Time: 1784903966 },
        schedule_relationship: 0,
      },
    ],
    Timestamp: 1784904788,
  },
  Vehicle: null,
  Alert: null,
};

test("maps a delayed trip using the first stop's departure delay", () => {
  const mapped = mapTripUpdateEntity(RUNNING_LATE);
  assert.ok(mapped);
  assert.strictEqual(mapped!.trip_id, "t388-b5-sl2B-v62");
  assert.strictEqual(mapped!.route_id, "444");
  assert.strictEqual(mapped!.service_date, "20260724");
  assert.strictEqual(mapped!.vehicle_id, "4136");
  assert.strictEqual(mapped!.next_stop_id, "31462");
  assert.strictEqual(mapped!.delay_seconds, 93);
});

test("retains departure predictions beyond the first stop", () => {
  const mapped = mapTripUpdateEntity(RUNNING_LATE);
  assert.strictEqual(mapped!.departure_predictions.length, 2);
  assert.strictEqual(mapped!.departure_predictions[1].departure_delay_seconds, 86);
  assert.strictEqual(mapped!.predicted_max_departure_delay_seconds, 93);
});

test("falls back to Arrival.Delay when Departure is null", () => {
  const entity: GtfsRtTripUpdateEntity = {
    ...RUNNING_LATE,
    TripUpdate: {
      ...RUNNING_LATE.TripUpdate!,
      StopTimeUpdates: [
        { StopSequence: 1980, StopId: "31462", Arrival: { Delay: 40, Time: 0 }, Departure: null, schedule_relationship: 0 },
      ],
    },
  };
  const mapped = mapTripUpdateEntity(entity);
  assert.strictEqual(mapped!.delay_seconds, 40);
});

test("returns null vehicle_id when no vehicle is assigned to the trip", () => {
  const entity: GtfsRtTripUpdateEntity = {
    ...RUNNING_LATE,
    TripUpdate: { ...RUNNING_LATE.TripUpdate!, Vehicle: null },
  };
  const mapped = mapTripUpdateEntity(entity);
  assert.strictEqual(mapped!.vehicle_id, null);
});

test("returns null when TripUpdate is missing", () => {
  const entity: GtfsRtTripUpdateEntity = { Id: "x", TripUpdate: null, Vehicle: null, Alert: null };
  assert.strictEqual(mapTripUpdateEntity(entity), null);
});

test("returns null when there are no stop time updates", () => {
  const entity: GtfsRtTripUpdateEntity = {
    ...RUNNING_LATE,
    TripUpdate: { ...RUNNING_LATE.TripUpdate!, StopTimeUpdates: [] },
  };
  assert.strictEqual(mapTripUpdateEntity(entity), null);
});

test("handles a nearly-on-time trip (small/negative delay)", () => {
  const entity: GtfsRtTripUpdateEntity = {
    ...RUNNING_LATE,
    TripUpdate: {
      ...RUNNING_LATE.TripUpdate!,
      StopTimeUpdates: [
        { StopSequence: 3900, StopId: "56878", Arrival: { Delay: -24, Time: 0 }, Departure: { Delay: 63, Time: 0 }, schedule_relationship: 0 },
      ],
    },
  };
  const mapped = mapTripUpdateEntity(entity);
  assert.strictEqual(mapped!.delay_seconds, 63);
});

test("finds the first future departure projected over 15 minutes", () => {
  const entity: GtfsRtTripUpdateEntity = {
    ...RUNNING_LATE,
    TripUpdate: {
      ...RUNNING_LATE.TripUpdate!,
      StopTimeUpdates: [
        { StopSequence: 1, StopId: "A", Arrival: null, Departure: { Delay: 600, Time: 1784903913 }, schedule_relationship: 0 },
        { StopSequence: 2, StopId: "B", Arrival: null, Departure: { Delay: 960, Time: 1784904513 }, schedule_relationship: 0 },
        { StopSequence: 3, StopId: "C", Arrival: null, Departure: { Delay: 1100, Time: 1784905113 }, schedule_relationship: 0 },
      ],
    },
  };
  const mapped = mapTripUpdateEntity(entity);
  assert.ok(mapped);
  assert.strictEqual(mapped.first_threshold_stop_id, "B");
  assert.strictEqual(mapped.predicted_max_departure_delay_seconds, 1100);
  assert.ok(mapped.first_threshold_departure_at instanceof Date);
});

test("severityForDelayMinutes: 15-30 min is minor", () => {
  assert.strictEqual(severityForDelayMinutes(15), "minor");
  assert.strictEqual(severityForDelayMinutes(29), "minor");
});

test("severityForDelayMinutes: 30-60 min is major", () => {
  assert.strictEqual(severityForDelayMinutes(30), "major");
  assert.strictEqual(severityForDelayMinutes(59), "major");
});

test("severityForDelayMinutes: 60+ min is critical", () => {
  assert.strictEqual(severityForDelayMinutes(60), "critical");
  assert.strictEqual(severityForDelayMinutes(120), "critical");
});

test("buildDelayDraftText includes the stop name when known", () => {
  const text = buildDelayDraftText("444", 18, "5th St & Main Ave");
  assert.strictEqual(text, "Route 444 is running approximately 18 minutes late near 5th St & Main Ave.");
});

test("buildDelayDraftText omits the stop phrase when the stop name is unknown", () => {
  const text = buildDelayDraftText("444", 18, null);
  assert.strictEqual(text, "Route 444 is running approximately 18 minutes late.");
});

test("buildDepartureRiskDraftText uses departure-focused language", () => {
  const text = buildDepartureRiskDraftText("444", 18, "Burnsville Transit Station");
  assert.strictEqual(
    text,
    "Route 444 is predicted to depart up to 18 minutes late beginning at Burnsville Transit Station.",
  );
});
