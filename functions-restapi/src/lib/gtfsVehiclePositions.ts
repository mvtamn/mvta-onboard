// GTFS-Realtime VehiclePosition feed - fetch + transform into a live
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

export async function fetchVehiclePositionFeed(url: string): Promise<GtfsRtVehiclePositionFeedMessage> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GTFS-RT VehiclePosition feed request failed: ${res.status}`);
  }
  return (await res.json()) as GtfsRtVehiclePositionFeedMessage;
}

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
