import type { EventGeofence, EventLocation } from "@mvta/shared";

/**
 * The pure half of the Event Plan scope map. Azure Maps cannot run under
 * jsdom, so the decisions that are actually worth testing - what the map
 * paints as in-scope, and what a click on a feature means - live here rather
 * than inside the rendering component.
 */

export interface ScopeMapFeature {
  kind: "geofence" | "location";
  id: string;
  name: string;
  linked: boolean;
}

export function scopeMapFeatures(
  geofences: EventGeofence[],
  locations: EventLocation[],
  linkedGeofenceIds: string[],
  linkedLocationIds: string[],
): ScopeMapFeature[] {
  const linkedFences = new Set(linkedGeofenceIds);
  const linkedPoints = new Set(linkedLocationIds);
  return [
    ...geofences.map((fence) => ({ kind: "geofence" as const, id: fence.id, name: fence.name, linked: linkedFences.has(fence.id) })),
    ...locations.map((location) => ({ kind: "location" as const, id: location.id, name: location.name, linked: linkedPoints.has(location.id) })),
  ];
}

export type ScopeMapClick =
  | { action: "link"; kind: "geofences" | "locations"; id: string; name: string }
  | { action: "unlink"; kind: "geofences" | "locations"; id: string; name: string }
  | { action: "ignore" };

/**
 * Resolves a clicked map feature into the scope change it should produce.
 * Returns `ignore` when the plan cannot be edited, when the feature carries no
 * id, or when the id no longer matches a known resource - a stale click after
 * a resource was deactivated must not toggle an unrelated one.
 */
export function resolveScopeMapClick(
  properties: { kind?: string; id?: string; linked?: boolean } | undefined,
  geofences: EventGeofence[],
  locations: EventLocation[],
  disabled: boolean,
): ScopeMapClick {
  if (disabled || !properties?.id) return { action: "ignore" };
  const action = properties.linked ? "unlink" : "link";
  if (properties.kind === "geofence") {
    const fence = geofences.find((row) => row.id === properties.id);
    return fence ? { action, kind: "geofences", id: fence.id, name: fence.name } : { action: "ignore" };
  }
  if (properties.kind === "location") {
    const location = locations.find((row) => row.id === properties.id);
    return location ? { action, kind: "locations", id: location.id, name: location.name } : { action: "ignore" };
  }
  return { action: "ignore" };
}
