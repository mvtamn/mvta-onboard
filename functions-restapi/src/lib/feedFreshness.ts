import type { KpiFeedName } from "./kpiTrust";
import { ON_DEMAND_DEGRADED_AFTER_MINUTES } from "./onDemandMonitoringHealth";

// How long each feed may go without a usable delivery before the data it
// supplies is stale. One number per feed, read by everything that judges that
// feed: the KPI trust contracts, the endpoints that report a feed's state to
// the console, and the pollers that clear out rows the feed stopped refreshing.
//
// These used to be separate literals, and they disagreed. Service Risk called
// fixed-route delays stale at 10 minutes, KPI trust at 15, and gtfsDelaysPoll
// deleted the rows at 15 - so every night, as the last trips finished, the
// banner read Stale for the five minutes between the first limit and the
// cleanup, then flipped to No current trips. A feed has one freshness contract;
// the places that enforce it must not be able to drift apart.
//
// A feed absent from this table has no staleness deadline (its contract is
// pending, or it is reference data such as zone geometry, where an old import
// is correct rather than stale). That is deliberate, not an omission.
//
// These are delivery windows, not position recency: the "vehicle reported in
// the last 3 minutes" filters in the AVL endpoints answer a different question
// and are not governed here.
export const FEED_STALE_AFTER_MINUTES = {
  // Five-minute pollers: three missed runs.
  gtfs_trip_updates: 15,
  gtfs_vehicle_positions: 15,
  avail_pullout: 15,
  // Fifteen-minute Spare ingests: three missed runs.
  spare_requests: 45,
  spare_slots: 45,
  spare_duties: 45,
  // The hourly authoritative reconciliation.
  spare_on_demand_reconciliation: ON_DEMAND_DEGRADED_AFTER_MINUTES,
  // Event AVL is polled every fifteen seconds and drives live maps.
  avail_avl: 2,
} as const satisfies Partial<Record<KpiFeedName, number>>;

// How often each polled feed is fetched, where the console needs to know it.
// The console counts down to the next delivery and marks a poll as missed when
// none arrives on this cadence, so the number it shows must be the number the
// poller actually runs on - which is why the schedule below is built from it
// rather than written out beside it.
export const FEED_POLL_INTERVAL_MINUTES = {
  gtfs_trip_updates: 5,
} as const satisfies Partial<Record<KpiFeedName, number>>;

export const GTFS_DELAYS_POLL_SCHEDULE = `0 */${FEED_POLL_INTERVAL_MINUTES.gtfs_trip_updates} * * * *`;

