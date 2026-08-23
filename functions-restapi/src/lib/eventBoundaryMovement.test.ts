import test from "node:test";
import assert from "node:assert/strict";
import { detectQualifiedBoundaryMovements } from "./eventBoundaryMovement";

const square = JSON.stringify({ type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] });

test("records enter and exit when a qualified path passes completely through a Monitoring Area", () => {
  const movements = detectQualifiedBoundaryMovements(square, {
    previous: { longitude: -1, latitude: 5, report_timestamp: "2026-08-22T12:00:00Z" },
    current: { longitude: 11, latitude: 5, report_timestamp: "2026-08-22T12:00:15Z" },
    pollIntervalSeconds: 15,
  });

  assert.deepEqual(movements.map((movement) => movement.transition), ["enter", "exit"]);
  assert.equal(movements[0]?.detection_method, "path_interpolated");
  assert.equal(movements[0]?.detected_at, "2026-08-22T12:00:15.000Z");
});

test("treats a Monitoring Area hole as outside", () => {
  const withHole = JSON.stringify({ type: "Polygon", coordinates: [
    [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
    [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
  ] });

  const movements = detectQualifiedBoundaryMovements(withHole, {
    previous: { longitude: 1, latitude: 5, report_timestamp: "2026-08-22T12:00:00Z" },
    current: { longitude: 9, latitude: 5, report_timestamp: "2026-08-22T12:00:15Z" },
    pollIntervalSeconds: 15,
  });

  assert.deepEqual(movements.map((movement) => movement.transition), ["exit", "enter"]);
});

test("does not interpolate short movements or late reports", () => {
  assert.deepEqual(detectQualifiedBoundaryMovements(square, {
    previous: { longitude: -0.0001, latitude: 5, report_timestamp: "2026-08-22T12:00:00Z" },
    current: { longitude: 0.0001, latitude: 5, report_timestamp: "2026-08-22T12:00:15Z" },
    pollIntervalSeconds: 15,
  }), []);
  assert.deepEqual(detectQualifiedBoundaryMovements(square, {
    previous: { longitude: -1, latitude: 5, report_timestamp: "2026-08-22T12:00:00Z" },
    current: { longitude: 11, latitude: 5, report_timestamp: "2026-08-22T12:00:31Z" },
    pollIntervalSeconds: 15,
  }), []);
});
