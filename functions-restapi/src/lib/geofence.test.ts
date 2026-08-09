import test from "node:test";
import assert from "node:assert/strict";
import { headingInRange, polygonContains } from "./geofence";

test("handles polygons and wrapped heading ranges", () => {
  assert.equal(polygonContains(JSON.stringify({ type: "Polygon", coordinates: [[[0,0],[10,0],[10,10],[0,10],[0,0]]] }), [5, 5]), true);
  assert.equal(headingInRange(355, 350, 10), true);
  assert.equal(headingInRange(180, 350, 10), false);
});
