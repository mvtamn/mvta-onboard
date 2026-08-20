import { describe, expect, it } from "vitest";
import type { EventGeofence, EventLocation } from "@mvta/shared";
import { resolveScopeMapClick, scopeMapFeatures } from "./eventScopeMapFeatures.js";

const fence = (id: string, name: string): EventGeofence => ({
  id, name, polygon: "", purpose: "other", is_active: true, updated_by: null, updated_at: "2026-01-01T00:00:00.000Z", rules: [],
});
const location = (id: string, name: string): EventLocation => ({
  id, name, category: "venue", latitude: 44.8, longitude: -93.2, notes: null, is_active: true,
});

describe("scopeMapFeatures", () => {
  it("marks only the linked resources as in scope", () => {
    const features = scopeMapFeatures([fence("g1", "Gate"), fence("g2", "Lot")], [location("l1", "Depot")], ["g2"], []);
    expect(features).toEqual([
      { kind: "geofence", id: "g1", name: "Gate", linked: false },
      { kind: "geofence", id: "g2", name: "Lot", linked: true },
      { kind: "location", id: "l1", name: "Depot", linked: false },
    ]);
  });
});

describe("resolveScopeMapClick", () => {
  const fences = [fence("g1", "Gate")];
  const locations = [location("l1", "Depot")];

  it("links an available geofence and unlinks one already in scope", () => {
    expect(resolveScopeMapClick({ kind: "geofence", id: "g1", linked: false }, fences, locations, false))
      .toEqual({ action: "link", kind: "geofences", id: "g1", name: "Gate" });
    expect(resolveScopeMapClick({ kind: "geofence", id: "g1", linked: true }, fences, locations, false))
      .toEqual({ action: "unlink", kind: "geofences", id: "g1", name: "Gate" });
  });

  it("resolves locations to the locations kind", () => {
    expect(resolveScopeMapClick({ kind: "location", id: "l1", linked: false }, fences, locations, false))
      .toEqual({ action: "link", kind: "locations", id: "l1", name: "Depot" });
  });

  it("ignores clicks when the Event Plan cannot be edited", () => {
    expect(resolveScopeMapClick({ kind: "geofence", id: "g1", linked: false }, fences, locations, true)).toEqual({ action: "ignore" });
  });

  it("ignores a feature whose resource no longer exists", () => {
    // A boundary deactivated in Event Administration between render and click
    // must not toggle some other resource.
    expect(resolveScopeMapClick({ kind: "geofence", id: "gone", linked: false }, fences, locations, false)).toEqual({ action: "ignore" });
    expect(resolveScopeMapClick(undefined, fences, locations, false)).toEqual({ action: "ignore" });
  });
});
