import { test } from "node:test";
import assert from "node:assert";
import { calibrateShapeDistance, haversineMetres, hopMetres } from "./distance";

const A = { lat: 44.70, lon: -93.20 };
const B = { lat: 44.71, lon: -93.20 };

function samples(unitsPerMetre: number, curvature: number, n = 30) {
  return Array.from({ length: n }, (_, i) => {
    const straight = 600 + i * 50;
    return { straight, shape: straight * unitsPerMetre * curvature };
  });
}

test("shape distances a third of a metre apart calibrate as feet", () => {
  const calibration = calibrateShapeDistance(samples(1 / 0.3048, 1.15));
  assert.strictEqual(calibration.unit, "feet");
  assert.ok(Math.abs((calibration.factor_to_metres ?? 0) - 0.3048) < 1e-9);
  assert.strictEqual(calibration.samples, 30);
});

test("shape distances close to the straight-line distance calibrate as metres", () => {
  assert.strictEqual(calibrateShapeDistance(samples(1, 1.3)).unit, "metres");
});

test("too few hops, or a ratio no unit explains, leaves the unit unknown and the review on straight lines", () => {
  assert.strictEqual(calibrateShapeDistance(samples(1 / 0.3048, 1.15, 5)).unit, "unknown");
  assert.strictEqual(calibrateShapeDistance(samples(100, 1)).unit, "unknown");
  assert.strictEqual(calibrateShapeDistance(samples(100, 1)).factor_to_metres, null);
});

test("short hops do not take part in the calibration: a stop pair across the street says nothing about units", () => {
  const short = Array.from({ length: 30 }, () => ({ straight: 80, shape: 8000 }));
  assert.strictEqual(calibrateShapeDistance(short).samples, 0);
});

test("a hop reads along the shape when calibrated and falls back to straight-line when it cannot", () => {
  const feet = { unit: "feet" as const, factor_to_metres: 0.3048, samples: 30 };
  const unknown = { unit: "unknown" as const, factor_to_metres: null, samples: 0 };
  assert.strictEqual(hopMetres({ shapeDist: 0, position: A }, { shapeDist: 1000, position: B }, feet), 304.8);
  const straight = haversineMetres(A, B);
  assert.strictEqual(hopMetres({ shapeDist: 0, position: A }, { shapeDist: 1000, position: B }, unknown), straight);
  // A shape distance that does not increase is a feed error; the straight line is the safer answer.
  assert.strictEqual(hopMetres({ shapeDist: 1000, position: A }, { shapeDist: 1000, position: B }, feet), straight);
  assert.strictEqual(hopMetres({ shapeDist: null, position: null }, { shapeDist: null, position: B }, feet), null);
});
