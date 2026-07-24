// GTFS-Realtime Alert feed - fetch + transform into a SuggestedAlerts row.
//
// MVTA's InfoPoint (Avail/DoubleMap) feed serves the standard GTFS-RT Alert
// schema as plain JSON via a `debug=true` query param, instead of the usual
// protobuf binary. That's an internal/unofficial access path, not something
// to hand to vendors - if it ever becomes unreliable, only fetchAlertFeed's
// request + parsing needs to change to a protobuf client; everything below
// it (the mapped shape, the poller, the DB insert) stays the same.
//
// Alert entries aren't algorithmically detected - they're detour/service-
// change notices a dispatcher already typed into the CAD system. This module
// only reshapes that already-human-authored content; it doesn't infer or
// invent anything.
import type { Category, Severity } from "./types";

export interface GtfsRtTranslation {
  Text: string;
  Language: string;
}

export interface GtfsRtTranslatedString {
  Translations: GtfsRtTranslation[] | null;
}

export interface GtfsRtActivePeriod {
  Start: number;
  End: number;
}

export interface GtfsRtInformedEntity {
  AgencyId: string | null;
  RouteId: string | null;
  Trip: unknown;
}

export interface GtfsRtAlert {
  ActivePeriods: GtfsRtActivePeriod[] | null;
  InformedEntities: GtfsRtInformedEntity[] | null;
  cause: number;
  effect: number;
  Url: unknown;
  HeaderText: GtfsRtTranslatedString | null;
  DescriptionText: GtfsRtTranslatedString | null;
}

export interface GtfsRtEntity {
  Id: string;
  TripUpdate: unknown;
  Vehicle: unknown;
  Alert: GtfsRtAlert | null;
}

export interface GtfsRtFeedMessage {
  Header: { GtfsRealtimeVersion: string; incrementality: number; Timestamp: number };
  Entities: GtfsRtEntity[];
}

export async function fetchAlertFeed(url: string): Promise<GtfsRtFeedMessage> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GTFS-RT Alert feed request failed: ${res.status}`);
  }
  return (await res.json()) as GtfsRtFeedMessage;
}

export interface MappedSuggestedAlert {
  external_id: string;
  draft_text: string;
  category: Category;
  severity: Severity;
  routes_affected: string[];
  detail: Record<string, unknown>;
}

// GTFS-RT standard `effect` enum (a subset - only values MVTA's feed has been
// observed to use, plus the most common others). Anything unmapped falls
// back to "general" rather than guessing.
const EFFECT_TO_CATEGORY: Record<number, Category> = {
  1: "closure", // NO_SERVICE
  2: "general", // REDUCED_SERVICE
  3: "delay", // SIGNIFICANT_DELAYS
  4: "detour", // DETOUR
  5: "general", // ADDITIONAL_SERVICE
  6: "general", // MODIFIED_SERVICE
};

// Severity is fixed rather than inferred: GTFS-RT's cause/effect codes don't
// reliably imply urgency, and the human review step this feeds into is the
// right place to adjust it, not a heuristic here.
const DEFAULT_SEVERITY: Severity = "minor";

export function mapAlertEntity(entity: GtfsRtEntity): MappedSuggestedAlert | null {
  const alert = entity.Alert;
  if (!alert) return null;

  const translations = alert.HeaderText?.Translations ?? [];
  const text = translations.find((t) => t.Language === "en")?.Text ?? translations[0]?.Text;
  if (!text || !text.trim()) return null;

  const routes_affected = (alert.InformedEntities ?? [])
    .map((e) => e.RouteId)
    .filter((routeId): routeId is string => Boolean(routeId));

  return {
    external_id: entity.Id,
    draft_text: text.trim(),
    category: EFFECT_TO_CATEGORY[alert.effect] ?? "general",
    severity: DEFAULT_SEVERITY,
    routes_affected,
    detail: {
      external_id: entity.Id,
      cause: alert.cause,
      effect: alert.effect,
      active_period: alert.ActivePeriods?.[0] ?? null,
      url: alert.Url ?? null,
    },
  };
}
