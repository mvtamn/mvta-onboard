import { test } from "node:test";
import assert from "node:assert";
import { parseCapture, splitCsvLine, vehicleStatus } from "./captureFile";
import { captureLines } from "./capture";
import type { GtfsRtTripUpdateFeedMessage } from "../gtfsTripUpdates";
import type { GtfsRtVehiclePositionFeedMessage } from "../gtfsVehiclePositions";

test("CSV fields come back as written, quoting and empty fields included", () => {
  assert.deepStrictEqual(splitCsvLine('P,1,"a,""b""",,x'), ["P", "1", 'a,"b"', "", "x"]);
  assert.deepStrictEqual(splitCsvLine("V,1,"), ["V", "1", ""]);
});

test("every line kind the capture writes reads back, and a torn line is counted, not thrown", () => {
  const runAt = new Date(Date.UTC(2026, 9, 20, 17, 0, 0));
  const written = captureLines(
    runAt,
    { Header: { Timestamp: 1792512000 }, Entities: [{ TripUpdate: { Trip: { TripId: "t1", RouteId: "420", StartDate: "20261020" }, Vehicle: { Id: "4128" },
      StopTimeUpdates: [{ StopSequence: 3600, StopId: "S2", Arrival: { Time: 1792512120 } }, { StopSequence: 3240, StopId: "S1", Departure: { Time: 1792511900 } }] } }] } as unknown as GtfsRtTripUpdateFeedMessage,
    { Header: { Timestamp: 1792512005 }, Entities: [{ Id: "e1", Vehicle: { Timestamp: 1792512001, Vehicle: { Id: "4128" }, Trip: { TripId: "t1", RouteId: "420" }, CurrentStopSequence: 3600, StopId: "S2", CurrentStatus: 2 } }] } as unknown as GtfsRtVehiclePositionFeedMessage,
  ).lines;
  const parsed = parseCapture([...written, "P,1792512000,t1", ""]);
  assert.strictEqual(parsed.unreadable, 1);
  assert.deepStrictEqual(parsed.records.map((r) => r.kind), ["R", "P", "B", "V"]);
  assert.deepStrictEqual(parsed.records[1], { kind: "P", sampledAt: 1792512000, tripId: "t1", routeId: "420", startDate: "20261020", stopSequence: 3600, stopId: "S2", at: 1792512120, vehicleId: "4128" });
  assert.deepStrictEqual(parsed.records[3], { kind: "V", feedAt: 1792512005, vehicleAt: 1792512001, vehicleId: "4128", tripId: "t1", routeId: "420", stopSequence: 3600, stopId: "S2", status: "in_transit" });
});

test("vehicle status is read from the number or the name, and defaults to in transit", () => {
  assert.strictEqual(vehicleStatus("1"), "stopped");
  assert.strictEqual(vehicleStatus("STOPPED_AT"), "stopped");
  assert.strictEqual(vehicleStatus("0"), "incoming");
  assert.strictEqual(vehicleStatus(""), "in_transit");
});
