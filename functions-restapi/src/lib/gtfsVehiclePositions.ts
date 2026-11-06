// GTFS-Realtime VehiclePosition feed - transform into a live
// position/occupancy reading. The third and final official GTFS-RT feed
// type (Alert: gtfsRealtime.ts, TripUpdate: gtfsTripUpdates.ts). Purely
// monitoring data - no alerting concept here, nothing ever escalates into
// SuggestedAlerts from this feed.
import type { GtfsRtFeedMessage } from "./gtfsRealtime";

export interface GtfsRtVehiclePositionTrip {
  TripId: string;
  RouteId: string;
  StartDate?: string;
  schedule_relationship: number;
}

export interface GtfsRtVehicleDescriptor {
  Id: string;
  Label: string | null;
}

export interface GtfsRtPosition {
  Latitude: number;
  Longitude: number;
  Bearing: number | null;
  Speed: number | null;
}

export interface GtfsRtVehiclePosition {
  Trip: GtfsRtVehiclePositionTrip | null;
  Vehicle: GtfsRtVehicleDescriptor | null;
  Position: GtfsRtPosition | null;
  CurrentStopSequence: number | null;
  StopId: string | null;
  CurrentStatus: number | null;
  Timestamp: number;
  congestion_level: number | null;
  occupancy_status: number | null;
}

export interface GtfsRtVehiclePositionEntity {
  Id: string;
  TripUpdate: unknown;
  Vehicle: GtfsRtVehiclePosition | null;
  Alert: unknown;
}

export type GtfsRtVehiclePositionFeedMessage = Omit<GtfsRtFeedMessage, "Entities"> & {
  Entities: GtfsRtVehiclePositionEntity[];
};

export interface MappedVehiclePosition {
  trip_id: string;
  route_id: string;
  service_date: string | null;
  vehicle_id: string | null;
  latitude: number;
  longitude: number;
  bearing: number | null;
  speed_mps: number | null;
  occupancy_status: number | null;
  current_status: number | null;
  current_stop_sequence: number | null;
  current_stop_id: string | null;
  source_timestamp_at: Date | null;
}

export function mapVehiclePositionEntity(entity: GtfsRtVehiclePositionEntity): MappedVehiclePosition | null {
  const vehicle = entity.Vehicle;
  if (!vehicle || !vehicle.Trip || !vehicle.Position) return null;

  return {
    trip_id: vehicle.Trip.TripId,
    route_id: vehicle.Trip.RouteId,
    service_date: vehicle.Trip.StartDate || null,
    vehicle_id: vehicle.Vehicle?.Id ?? null,
    latitude: vehicle.Position.Latitude,
    longitude: vehicle.Position.Longitude,
    bearing: vehicle.Position.Bearing ?? null,
    speed_mps: vehicle.Position.Speed ?? null,
    occupancy_status: vehicle.occupancy_status ?? null,
    current_status: vehicle.CurrentStatus ?? null,
    current_stop_sequence: vehicle.CurrentStopSequence ?? null,
    current_stop_id: vehicle.StopId ?? null,
    source_timestamp_at:
      Number.isFinite(vehicle.Timestamp) && vehicle.Timestamp > 0
        ? new Date(vehicle.Timestamp * 1000)
        : null,
  };
}

/**
 * How far ahead of our fetch a vehicle's own timestamp may run before its
 * clock is wrong rather than a little fast.
 */
export const VEHICLE_CLOCK_TOLERANCE_SECONDS = 120;

/**
 * When a position was observed: the vehicle's own timestamp, unless it claims
 * a time after we fetched it.
 *
 * A reading cannot have happened after the poll that received it, so a stamp
 * in the future is a wrong clock on the bus. When daylight saving ended on
 * 2026-11-01, units still on CDT stamped positions an hour ahead (22 vehicles
 * on 11-01, 54 on 11-02, 3 on 11-03). The poller stored those stamps as
 * first_underway_at, so buses that left on time looked an hour late to the
 * missed-trip detector. The fetch time is never more than a poll's latency
 * after the real observation, so it stands in. A stamp in the past is left
 * alone: a stale position is a real thing the feed can carry, and an hour-
 * behind clock (spring forward) cannot be told apart from one.
 */
export function vehicleObservedAt(sourceTimestampAt: Date | null, fetchedAt: Date): { at: Date; futureStamped: boolean } {
  if (!sourceTimestampAt) return { at: fetchedAt, futureStamped: false };
  if (sourceTimestampAt.getTime() > fetchedAt.getTime() + VEHICLE_CLOCK_TOLERANCE_SECONDS * 1000) {
    return { at: fetchedAt, futureStamped: true };
  }
  return { at: sourceTimestampAt, futureStamped: false };
}
