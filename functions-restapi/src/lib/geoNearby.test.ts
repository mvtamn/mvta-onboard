import { test } from "node:test";
import assert from "node:assert";
import { boundingBox, distanceToGeometry, geometryDistance, parseGeometryJson, validateDetourGeometry } from "./geoNearby";

const MAIN: [number, number] = [-93.25, 44.83];

test("distance to a point is haversine-close", () => {
  // ~111 m per 0.001 deg latitude
  const d = distanceToGeometry([-93.25, 44.831], { type: "Point", coordinates: MAIN });
  assert.ok(d > 105 && d < 117, `got ${d}`);
});

test("distance to a line is the perpendicular distance, not the vertex distance", () => {
  const line = { type: "LineString" as const, coordinates: [[-93.26, 44.83], [-93.24, 44.83]] as [number, number][] };
  const d = distanceToGeometry([-93.25, 44.8305], line);
  assert.ok(d > 50 && d < 62, `got ${d}`);
  const beyondEnd = distanceToGeometry([-93.235, 44.83], line);
  assert.ok(beyondEnd > 380 && beyondEnd < 410, `got ${beyondEnd}`);
});

test("a point inside a polygon is at distance zero; outside measures to the edge", () => {
  const poly = { type: "Polygon" as const, coordinates: [[[-93.26, 44.82], [-93.24, 44.82], [-93.24, 44.84], [-93.26, 44.84], [-93.26, 44.82]]] as [number, number][][] };
  assert.equal(distanceToGeometry(MAIN, poly), 0);
  const outside = distanceToGeometry([-93.25, 44.841], poly);
  assert.ok(outside > 105 && outside < 117, `got ${outside}`);
});

test("geometry validation accepts the three drawable types and rejects the rest", () => {
  assert.ok("geometry" in validateDetourGeometry({ type: "Point", coordinates: MAIN }));
  assert.ok("geometry" in validateDetourGeometry({ type: "LineString", coordinates: [MAIN, [-93.24, 44.83]] }));
  assert.ok("error" in validateDetourGeometry({ type: "LineString", coordinates: [MAIN] }));
  assert.ok("error" in validateDetourGeometry({ type: "MultiPolygon", coordinates: [] }));
  assert.ok("error" in validateDetourGeometry({ type: "Point", coordinates: [200, 0] }));
});

test("bounding box pads by metres in both axes", () => {
  const box = boundingBox({ type: "Point", coordinates: MAIN }, 100);
  assert.ok(box.maxLat - MAIN[1] > 0.0008 && box.maxLat - MAIN[1] < 0.001);
  assert.ok(box.maxLon - MAIN[0] > 0.0011 && box.maxLon - MAIN[0] < 0.0014);
});

test("geometry distance is zero for touching or containing shapes and vertex-based otherwise", () => {
  const poly = { type: "Polygon" as const, coordinates: [[[-93.26, 44.82], [-93.24, 44.82], [-93.24, 44.84], [-93.26, 44.84], [-93.26, 44.82]]] as [number, number][][] };
  const inside = { type: "Point" as const, coordinates: MAIN };
  assert.equal(geometryDistance(poly, inside), 0);
  assert.equal(geometryDistance(inside, poly), 0);
  const lineA = { type: "LineString" as const, coordinates: [[-93.26, 44.83], [-93.24, 44.83]] as [number, number][] };
  const lineB = { type: "LineString" as const, coordinates: [[-93.25, 44.831], [-93.25, 44.84]] as [number, number][] };
  const d = geometryDistance(lineA, lineB);
  assert.ok(d > 105 && d < 117, `got ${d}`);
});

test("parseGeometryJson tolerates null, junk, and invalid shapes", () => {
  assert.equal(parseGeometryJson(null), null);
  assert.equal(parseGeometryJson("{not json"), null);
  assert.equal(parseGeometryJson(JSON.stringify({ type: "MultiPoint", coordinates: [] })), null);
  assert.deepStrictEqual(parseGeometryJson(JSON.stringify({ type: "Point", coordinates: MAIN })), { type: "Point", coordinates: MAIN });
});
