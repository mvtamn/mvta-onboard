import { describe, expect, it, vi } from "vitest";
import { removeMapLayersIfPresent } from "./mapLayerCleanup.js";

describe("removeMapLayersIfPresent", () => {
  it("removes only layers that are still attached to the map", () => {
    const attachedLayer = {};
    const alreadyRemovedLayer = {};
    const remove = vi.fn();
    const map = { layers: { getLayers: () => [attachedLayer], remove } };

    removeMapLayersIfPresent(map, [attachedLayer, alreadyRemovedLayer]);

    expect(remove).toHaveBeenCalledWith([attachedLayer]);
  });

  it("does not throw when the map has already been disposed", () => {
    const map = {
      layers: {
        getLayers: () => { throw new Error("map disposed"); },
        remove: vi.fn(),
      },
    };

    expect(() => removeMapLayersIfPresent(map, [{}])).not.toThrow();
  });
});
