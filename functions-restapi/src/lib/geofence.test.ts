import test from "node:test";
import assert from "node:assert/strict";
import { headingInRange, polygonContains, validatePolygon } from "./geofence";

test("handles polygons and wrapped heading ranges", () => {
  assert.equal(polygonContains(JSON.stringify({ type: "Polygon", coordinates: [[[0,0],[10,0],[10,10],[0,10],[0,0]]] }), [5, 5]), true);
  assert.equal(headingInRange(355, 350, 10), true);
  assert.equal(headingInRange(180, 350, 10), false);
});

test("treats polygon boundaries as inside and holes as outside", () => {
  const polygon = JSON.stringify({ type: "Polygon", coordinates: [
    [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
    [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
  ] });
  assert.equal(polygonContains(polygon, [0, 5]), true);
  assert.equal(polygonContains(polygon, [5, 5]), false);
  assert.equal(validatePolygon(polygon), null);
});

test("rejects an open polygon ring", () => {
  assert.equal(validatePolygon(JSON.stringify({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1]]] })), "polygon rings must be closed and contain at least four positions");
});

test("rejects a self-intersecting polygon", () => {
  assert.equal(validatePolygon(JSON.stringify({ type: "Polygon", coordinates: [[[0, 0], [10, 10], [0, 10], [10, 0], [0, 0]]] })), "polygon rings must not self-intersect");
});
