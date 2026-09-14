import { FEED_STALE_AFTER_MINUTES } from "./feedFreshness";

export type TripDelayDataState =
  | "current"
  | "no_current_trips"
  // The feed is answering, but no trip is being monitored during hours when
  // fixed-route trips are always running (lib/serviceHours.ts).
  | "no_trips_in_service"
  | "stale"
  | "unavailable"
  | "configuration_missing";

// The TripUpdate feed's own state, as KPI trust resolves it from the feed
// health ledger - the only evidence of whether the feed actually answered.
export type TripUpdateFeedState = "current" | "stale" | "unavailable";

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
  // When the TripUpdate feed last delivered successfully, from the feed ledger.
  // It moves on every successful poll - including an empty one overnight - so
  // it is the console's clock for "data arrived", where the trip rows are not.
  feed_last_success_at: string | null;
  // The poller's cadence, so the console counts down to a real delivery.
  poll_interval_minutes: number;
  // How many TripUpdate entities the feed's last successful delivery carried,
  // from the ledger - before mapping to monitored trips. Lets the console say
  // whether an empty page means the feed sent nothing or sent trips that were
  // not monitored.
  feed_entity_count: number | null;
  // Whether fixed-route trips are expected to be running now, and the
  // agency-local window that decides it.
  trips_expected_now: boolean;
  trips_expected_window: { from: string; until: string; time_zone: string };
}

export const TRIP_DELAY_STALE_AFTER_MINUTES = FEED_STALE_AFTER_MINUTES.gtfs_trip_updates;

export interface TripDelayViewInput<Row extends { last_polled_at: Date }> {
  tripUpdatesConfigured: boolean;
  feedState: TripUpdateFeedState;
  rows: readonly Row[];
  // Whether fixed-route trips are expected to be running now. Omitted, an
  // empty feed is never treated as suspicious.
  tripsExpected?: boolean;
  now?: Date;
}

export interface TripDelayView<Row> {
  state: TripDelayDataState;
  // The rows the console should show for this state.
  delays: Row[];
  // Newest poll across every row, including ones past the limit, so a stale
  // banner can still say when data last arrived.
  lastTripUpdateAt: Date | null;
}

// Decides what Service Risk reports, from two separate pieces of evidence: the
// feed ledger (did the feed answer?) and the monitored rows (what did it say?).
//
// This used to read the rows alone, and an empty table short-circuited to
// "no current trips" before any freshness check. But gtfsDelaysPoll deletes
// rows after every successful fetch, so an empty table cannot tell "the feed
// answered and nothing is running" from "the rows were cleared and the feed
// has not answered since". The second read as a healthy empty feed, which the
// console shows with a moving, quiet banner - a dead feed dressed as a calm
// night. Now "no current trips" requires the ledger to show the feed answered
// inside its contract, and a feed the ledger cannot vouch for is reported as
// stale or unavailable whatever the table holds.
//
// While the feed is current, rows older than the limit are left out: they
// belong to trips the feed has stopped reporting and are waiting for the next
// cleanup, and showing them beside "no current trips" contradicts it. While the
// feed is not current, every row stays - the last known picture is worth
// seeing, and the banner already says not to act on it.
//
// An empty result is judged against service hours. Overnight, a feed that
// answers with no trips is a quiet night. During the hours fixed-route trips
// are always running, the same answer is a problem to check - the vendor
// sending nothing, or trips arriving that are not being monitored - and it
// used to look exactly like a quiet night. The feed's state still wins: a
// stale or unavailable feed is reported as that, whatever the hour.
export function resolveTripDelayView<Row extends { last_polled_at: Date }>(
  input: TripDelayViewInput<Row>,
): TripDelayView<Row> {
  const lastTripUpdateAt = input.rows.reduce<Date | null>(
    (latest, row) => (!latest || row.last_polled_at > latest ? row.last_polled_at : latest),
    null,
  );
  const all = [...input.rows];

  if (!input.tripUpdatesConfigured) return { state: "configuration_missing", delays: all, lastTripUpdateAt };
  if (input.feedState === "unavailable") return { state: "unavailable", delays: all, lastTripUpdateAt };
  if (input.feedState === "stale") return { state: "stale", delays: all, lastTripUpdateAt };

  const now = input.now ?? new Date();
  const limitMs = TRIP_DELAY_STALE_AFTER_MINUTES * 60_000;
  const fresh = all.filter((row) => now.getTime() - row.last_polled_at.getTime() <= limitMs);
  if (fresh.length > 0) return { state: "current", delays: fresh, lastTripUpdateAt };
  return input.tripsExpected
    ? { state: "no_trips_in_service", delays: [], lastTripUpdateAt }
    : { state: "no_current_trips", delays: [], lastTripUpdateAt };
}
