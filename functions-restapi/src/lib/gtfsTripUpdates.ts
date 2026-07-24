// GTFS-Realtime TripUpdate feed - fetch + transform into a delay reading.
//
// Unlike Alert (gtfsRealtime.ts), this is genuine algorithmic detection: each
// entity is one active trip, carrying an array of StopTimeUpdates (one per
// upcoming stop). This module only extracts the soonest upcoming stop's
// delay - the most immediate, actionable signal for "is this bus currently
// running late" - not an aggregate across the whole remaining trip.
import type { GtfsRtFeedMessage } from "./gtfsRealtime";
import type { Severity } from "./types";

export interface GtfsRtStopTimeEvent {
  Delay: number;
  Time: number;
}

export interface GtfsRtStopTimeUpdate {
  StopSequence: number;
  StopId: string | null;
  Arrival: GtfsRtStopTimeEvent | null;
  Departure: GtfsRtStopTimeEvent | null;
  schedule_relationship: number;
}

export interface GtfsRtTrip {
  TripId: string;
  RouteId: string;
  StartDate: string;
  schedule_relationship: number;
}

export interface GtfsRtVehicleDescriptor {
  Id: string;
  Label: string | null;
}

export interface GtfsRtTripUpdate {
  Trip: GtfsRtTrip;
  Vehicle: GtfsRtVehicleDescriptor | null;
  StopTimeUpdates: GtfsRtStopTimeUpdate[] | null;
  Timestamp: number;
}

export interface GtfsRtTripUpdateEntity {
  Id: string;
  TripUpdate: GtfsRtTripUpdate | null;
  Vehicle: unknown;
  Alert: unknown;
}

export type GtfsRtTripUpdateFeedMessage = Omit<GtfsRtFeedMessage, "Entities"> & {
  Entities: GtfsRtTripUpdateEntity[];
};

export async function fetchTripUpdateFeed(url: string): Promise<GtfsRtTripUpdateFeedMessage> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GTFS-RT TripUpdate feed request failed: ${res.status}`);
  }
  return (await res.json()) as GtfsRtTripUpdateFeedMessage;
}

export interface MappedTripDelay {
  trip_id: string;
  route_id: string;
  vehicle_id: string | null;
  next_stop_id: string | null;
  delay_seconds: number;
}

export function mapTripUpdateEntity(entity: GtfsRtTripUpdateEntity): MappedTripDelay | null {
  const tripUpdate = entity.TripUpdate;
  if (!tripUpdate) return null;

  const nextStop = (tripUpdate.StopTimeUpdates ?? [])[0];
  if (!nextStop) return null;

  const delay = nextStop.Arrival?.Delay ?? nextStop.Departure?.Delay;
  if (delay === undefined || delay === null) return null;

  return {
    trip_id: tripUpdate.Trip.TripId,
    route_id: tripUpdate.Trip.RouteId,
    vehicle_id: tripUpdate.Vehicle?.Id ?? null,
    next_stop_id: nextStop.StopId,
    delay_seconds: delay,
  };
}

// Fixed severity bands rather than a finer heuristic - defensible, explainable
// thresholds a rider-alert reviewer can reason about at a glance.
export function severityForDelayMinutes(minutes: number): Severity {
  if (minutes >= 60) return "critical";
  if (minutes >= 30) return "major";
  return "minor";
}

export function buildDelayDraftText(routeId: string, delayMinutes: number, stopName: string | null): string {
  const stopPhrase = stopName ? ` near ${stopName}` : "";
  return `Route ${routeId} is running approximately ${delayMinutes} minutes late${stopPhrase}.`;
}
