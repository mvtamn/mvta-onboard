export type TripDelayDataState =
  | "current"
  | "no_current_trips"
  | "stale"
  | "configuration_missing";

export interface TripDelayDiagnosticInput {
  tripUpdatesConfigured: boolean;
  activeTripCount: number;
  thresholdRiskCount: number;
  lastTripUpdateAt: Date | null;
  staticStopCount: number;
  directionReferenceCount: number;
  now?: Date;
}

export interface TripDelayDiagnostics {
  state: TripDelayDataState;
  trip_updates_configured: boolean;
  vehicle_positions_configured: boolean;
  static_gtfs_configured: boolean;
  active_trip_count: number;
  threshold_risk_count: number;
  last_trip_update_at: string | null;
  route_reference_count: number;
  static_stop_count: number;
  direction_reference_count: number;
  stale_after_minutes: number;
}

export const TRIP_DELAY_STALE_AFTER_MINUTES = 10;

export function determineTripDelayState(
  input: TripDelayDiagnosticInput,
): TripDelayDataState {
  if (!input.tripUpdatesConfigured) return "configuration_missing";
  if (input.activeTripCount === 0) return "no_current_trips";
  if (!input.lastTripUpdateAt) return "stale";

  const now = input.now ?? new Date();
  const ageMs = now.getTime() - input.lastTripUpdateAt.getTime();
  return ageMs > TRIP_DELAY_STALE_AFTER_MINUTES * 60_000 ? "stale" : "current";
}
