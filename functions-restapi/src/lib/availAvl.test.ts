import { test } from "node:test";
import assert from "node:assert";
import { mapAvlReport, type AvailAvlReport } from "./availAvl";

// Fixture shaped like the sample Avail360 AVL Reports payload.
const SAMPLE: AvailAvlReport = {
  Vehicle: 302,
  Timestamp: "2024-08-21T08:00:00Z",
  Route: 40,
  Block: 14002,
  Run: 4002,
  Trip: 742,
  Latitude: 33.557958,
  Longitude: -86.823507,
  Heading: 130,
  Direction: "O",
};

test("maps a well-formed AVL report", () => {
  const mapped = mapAvlReport(SAMPLE);
  assert.ok(mapped);
  assert.strictEqual(mapped!.vehicle_id, 302);
  assert.strictEqual(mapped!.route, 40);
  assert.strictEqual(mapped!.block, 14002);
  assert.strictEqual(mapped!.run, 4002);
  assert.strictEqual(mapped!.trip, 742);
  assert.strictEqual(mapped!.latitude, 33.557958);
  assert.strictEqual(mapped!.longitude, -86.823507);
  assert.strictEqual(mapped!.heading, 130);
  assert.strictEqual(mapped!.direction, "O");
  assert.strictEqual(mapped!.report_timestamp.toISOString(), "2024-08-21T08:00:00.000Z");
});

test("returns null when Vehicle is missing or non-numeric", () => {
  const report = { ...SAMPLE, Vehicle: undefined as unknown as number };
  assert.strictEqual(mapAvlReport(report), null);
});

test("returns null when Latitude/Longitude are missing", () => {
  assert.strictEqual(mapAvlReport({ ...SAMPLE, Latitude: undefined as unknown as number }), null);
  assert.strictEqual(mapAvlReport({ ...SAMPLE, Longitude: undefined as unknown as number }), null);
});

test("returns null for an unparseable Timestamp", () => {
  assert.strictEqual(mapAvlReport({ ...SAMPLE, Timestamp: "not-a-date" }), null);
});

test("treats optional fields as null when absent", () => {
  const mapped = mapAvlReport({ ...SAMPLE, Route: null, Block: null, Run: null, Trip: null, Heading: null, Direction: null });
  assert.ok(mapped);
  assert.strictEqual(mapped!.route, null);
  assert.strictEqual(mapped!.heading, null);
  assert.strictEqual(mapped!.direction, null);
});
