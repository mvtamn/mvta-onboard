import { test } from "node:test";
import assert from "node:assert";
import { CAPTURE_AHEAD_SECONDS, CAPTURE_PAST_SECONDS, captureBlobName, captureLines, readsTripUpdates } from "./capture";
import type { GtfsRtTripUpdateFeedMessage } from "../gtfsTripUpdates";
import type { GtfsRtVehiclePositionFeedMessage } from "../gtfsVehiclePositions";

const H = 1_792_168_048; // a feed timestamp, 2026-10-16 16:27:28 UTC

function tripUpdates(stops: { seq: number; stop: string; at: number }[], vehicle: string | null = "4142"): GtfsRtTripUpdateFeedMessage {
  return {
    Header: { GtfsRealtimeVersion: "2.0", incrementality: 0, Timestamp: H },
    Entities: [{
      Id: "t1",
      TripUpdate: {
        Trip: { TripId: "t1", RouteId: "425", StartDate: "20261016", schedule_relationship: 0 },
        Vehicle: vehicle ? { Id: vehicle, Label: vehicle } : null,
        StopTimeUpdates: stops.map((s) => ({ StopSequence: s.seq, StopId: s.stop, Arrival: { Delay: 60, Time: s.at }, Departure: null, schedule_relationship: 0 })),
        Timestamp: H - 4,
      },
      Vehicle: null,
      Alert: null,
    }],
  };
}

const VP: GtfsRtVehiclePositionFeedMessage = {
  Header: { GtfsRealtimeVersion: "2.0", incrementality: 0, Timestamp: H + 2 },
  Entities: [{
    Id: "4142",
    TripUpdate: null,
    Vehicle: {
      Trip: { TripId: "t1", RouteId: "425", schedule_relationship: 0 },
      Vehicle: { Id: "4142", Label: "4142" },
      Position: { Latitude: 44.7, Longitude: -93.2, Bearing: null, Speed: null },
      CurrentStopSequence: 3240,
      StopId: "53469",
      CurrentStatus: 1,
      Timestamp: H - 5,
      congestion_level: null,
      occupancy_status: null,
    },
    Alert: null,
  }],
};

const RUN = new Date((H + 3) * 1000);

test("a run writes itself, each prediction within 30 minutes, recent times behind the feed, and each vehicle", () => {
  const out = captureLines(RUN, tripUpdates([
    { seq: 3060, stop: "41000", at: H - CAPTURE_PAST_SECONDS - 1 }, // too old: dropped
    { seq: 3120, stop: "41001", at: H - 162 },                       // behind the feed: B
    { seq: 3240, stop: "53469", at: H + 24 },                        // P
    { seq: 3300, stop: "53470", at: H + CAPTURE_AHEAD_SECONDS },     // P, the limit
    { seq: 3360, stop: "53471", at: H + CAPTURE_AHEAD_SECONDS + 1 }, // too far: dropped
  ]), VP);
  assert.deepStrictEqual(out.lines, [
    `R,${H + 3},${H},${H + 2}`,
    `B,${H},t1,425,20261016,3120,41001,${H - 162},4142`,
    `P,${H},t1,425,20261016,3240,53469,${H + 24},4142`,
    `P,${H},t1,425,20261016,3300,53470,${H + CAPTURE_AHEAD_SECONDS},4142`,
    `V,${H + 2},${H - 5},4142,t1,425,,3240,53469,1`,
  ]);
  assert.deepStrictEqual([out.predictions, out.behind, out.vehicles], [2, 1, 1]);
});

test("a prediction is stamped with the feed's own timestamp, not the moment we fetched it", () => {
  const [, p] = captureLines(new Date((H + 25) * 1000), tripUpdates([{ seq: 1, stop: "1", at: H + 60 }]), null).lines;
  assert.ok(p.startsWith(`P,${H},`));
});

test("a run without TripUpdates (the :50 run) still writes itself and the vehicles", () => {
  const out = captureLines(RUN, null, VP);
  assert.deepStrictEqual(out.lines.map((l) => l[0]), ["R", "V"]);
  assert.strictEqual(out.lines[0], `R,${H + 3},,${H + 2}`);
});

test("a trip with no vehicle yet is captured with an empty vehicle field, and a field with a comma is quoted", () => {
  const feed = tripUpdates([{ seq: 1, stop: 'Stop "A", north', at: H + 60 }], null);
  assert.strictEqual(captureLines(RUN, feed, null).lines[1], `P,${H},t1,425,20261016,1,"Stop ""A"", north",${H + 60},`);
});

test("TripUpdates are read on the :20 run and not the :50 one", () => {
  assert.strictEqual(readsTripUpdates(new Date("2026-10-16T16:27:20.400Z")), true);
  assert.strictEqual(readsTripUpdates(new Date("2026-10-16T16:27:50.200Z")), false);
});

test("the daily file is named by the Central calendar date, so 11:30pm and 12:30am land in different files", () => {
  assert.strictEqual(captureBlobName(new Date("2026-10-17T04:30:00Z")), "20261016/capture.csv.gz"); // 11:30pm CDT
  assert.strictEqual(captureBlobName(new Date("2026-10-17T05:30:00Z")), "20261017/capture.csv.gz"); // 12:30am CDT
});
