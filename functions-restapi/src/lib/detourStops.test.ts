import { test } from "node:test";
import assert from "node:assert";
import { stopIdsForRecord, stopIdsFromText, stopsNearGeometry } from "./detourStops";

const index = [
  { stop_id: "S1", stop_name: "Cedar & 5th", stop_lat: 44.83, stop_lon: -93.25 },
  { stop_id: "S2", stop_name: "Cedar & 6th", stop_lat: 44.8305, stop_lon: -93.25 },   // ~55 m north of S1
  { stop_id: "S9", stop_name: "Far away", stop_lat: 44.9, stop_lon: -93.1 },
];

test("stop ids are read from #id markers in affected-stops text, once each", () => {
  assert.deepStrictEqual(stopIdsFromText("Cedar & 5th (#S1); Cedar & 6th (#S2); Cedar & 5th (#S1)"), ["S1", "S2"]);
  assert.deepStrictEqual(stopIdsFromText("no markers here"), []);
  assert.deepStrictEqual(stopIdsFromText(null), []);
});

test("stops near a shape use the match radius", () => {
  const point = { type: "Point" as const, coordinates: [-93.25, 44.83] as [number, number] };
  assert.deepStrictEqual(stopsNearGeometry(index, point).map((s) => s.stop_id), ["S1", "S2"]);
  assert.deepStrictEqual(stopsNearGeometry(index, point, 20).map((s) => s.stop_id), ["S1"]);
});

test("a record's stop ids combine text markers and drawn proximity", () => {
  const point = { type: "Point" as const, coordinates: [-93.25, 44.83] as [number, number] };
  assert.deepStrictEqual(stopIdsForRecord(index, point, "Far away (#S9)").sort(), ["S1", "S2", "S9"]);
  assert.deepStrictEqual(stopIdsForRecord(index, null, "(#S9)"), ["S9"]);
  assert.deepStrictEqual(stopIdsForRecord(index, null, null), []);
});
