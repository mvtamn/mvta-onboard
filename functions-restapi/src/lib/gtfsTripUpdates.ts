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
  service_date: string | null;
  vehicle_id: string | null;
  next_stop_id: string | null;
  delay_seconds: number;
  predicted_max_departure_delay_seconds: number;
  first_threshold_stop_id: string | null;
  first_threshold_departure_at: Date | null;
  departure_predictions: DeparturePrediction[];
}

export interface DeparturePrediction {
  stop_sequence: number;
  stop_id: string | null;
  departure_delay_seconds: number;
  predicted_departure_at: string | null;
}

const DEPARTURE_RISK_THRESHOLD_SECONDS = 15 * 60;

export function mapTripUpdateEntity(entity: GtfsRtTripUpdateEntity): MappedTripDelay | null {
  const tripUpdate = entity.TripUpdate;
  if (!tripUpdate) return null;

  const updates = [...(tripUpdate.StopTimeUpdates ?? [])].sort(
    (a, b) => a.StopSequence - b.StopSequence,
  );
  const nextStop = updates[0];
  if (!nextStop) return null;

  // MVTA evaluates service performance using departures. Arrival remains a
  // fallback only when the producer omits Departure for a stop.
  const delay = nextStop.Departure?.Delay ?? nextStop.Arrival?.Delay;
  if (delay === undefined || delay === null) return null;

  const departurePredictions: DeparturePrediction[] = updates.flatMap((update) => {
    const departureDelay = update.Departure?.Delay ?? update.Arrival?.Delay;
    if (departureDelay === undefined || departureDelay === null) return [];
    const epochSeconds = update.Departure?.Time ?? update.Arrival?.Time;
    const predictedAt =
      epochSeconds && Number.isFinite(epochSeconds)
        ? new Date(epochSeconds * 1000).toISOString()
        : null;
    return [{
      stop_sequence: update.StopSequence,
      stop_id: update.StopId,
      departure_delay_seconds: departureDelay,
      predicted_departure_at: predictedAt,
    }];
  });

  const predictedMax = Math.max(...departurePredictions.map((p) => p.departure_delay_seconds));
  const firstThreshold = departurePredictions.find(
    (p) => p.departure_delay_seconds > DEPARTURE_RISK_THRESHOLD_SECONDS,
  );

  return {
    trip_id: tripUpdate.Trip.TripId,
    route_id: tripUpdate.Trip.RouteId,
    service_date: tripUpdate.Trip.StartDate || null,
    vehicle_id: tripUpdate.Vehicle?.Id ?? null,
    next_stop_id: nextStop.StopId,
    delay_seconds: delay,
    predicted_max_departure_delay_seconds: predictedMax,
    first_threshold_stop_id: firstThreshold?.stop_id ?? null,
    first_threshold_departure_at: firstThreshold?.predicted_departure_at
      ? new Date(firstThreshold.predicted_departure_at)
      : null,
    departure_predictions: departurePredictions,
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

export function buildDepartureRiskDraftText(
  routeId: string,
  delayMinutes: number,
  stopName: string | null,
): string {
  const stopPhrase = stopName ? ` beginning at ${stopName}` : "";
  return `Route ${routeId} is predicted to depart up to ${delayMinutes} minutes late${stopPhrase}.`;
}
