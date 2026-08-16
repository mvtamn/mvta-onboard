import { describe, expect, it } from "vitest";
import { validateDrawnPolygon } from "./geofenceGeometry.js";

describe("validateDrawnPolygon", () => {
  it("rejects a self-intersecting ring before it can be saved", () => {
    expect(validateDrawnPolygon(JSON.stringify({
      type: "Polygon",
      coordinates: [[[0, 0], [10, 10], [0, 10], [10, 0], [0, 0]]],
    }))).toBe("polygon rings must not self-intersect");
  });
});
