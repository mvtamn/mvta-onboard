// The one place that reads the GTFS-RT TripUpdate feed and says what the
// shared gtfs_trip_updates ledger row means.
//
// gtfsDelaysPoll and gtfsMissedTripsPoll both fetch GTFS_RT_TRIPUPDATE_URL, on
// the same five-minute schedule, and both used to write this row themselves.
// Two consumers of one source is what the trust contract intends -
// fixed_route_delay and fixed_route_missed_trips each declare gtfs_trip_updates
// required - and the row is named for the feed, not for a poller. What the
// design cannot survive is the two pollers describing the same delivery
// differently, because whichever ran last silently won.
//
// They agreed only by coincidence: both passed Entities.length and the feed
// header timestamp. Nothing held them there, and the stored-count rule now
// applied across the other pollers is a standing invitation to make each count
// its own table - MonitoredTripDelays in one, missed-trip candidates in the
// other - at which point the row would alternate between two incompatible
// numbers every five minutes. Routing both through here means there is one
// definition to change, and changing it moves both.
//
// The row records DELIVERY, not what either poller went on to store. That is
// forced by the sharing: the two write different tables, so no single stored
// count could describe both, and a row that tried would be wrong for whichever
// consumer did not write it. Per-poller processing failures therefore belong in
// that poller's own diagnostics, never here.
import { getPool, type sql } from "./db";
import { fetchTripUpdateFeed, type GtfsRtTripUpdateFeedMessage } from "./gtfsTripUpdates";
import { recordFeedFailure, recordFeedHealth } from "./kpiFeedHealth";

export interface TripUpdateIngest {
  feed: GtfsRtTripUpdateFeedMessage;
  pool: sql.ConnectionPool;
}

// Injected so the ledger rule can be tested without a feed or a database, the
// same way spareMissedTripsIngest takes its slot fetcher.
export interface TripUpdateIngestDeps {
  fetchFeed: (url: string) => Promise<GtfsRtTripUpdateFeedMessage>;
  connect: () => Promise<sql.ConnectionPool>;
  recordHealth: typeof recordFeedHealth;
  recordFailure: typeof recordFeedFailure;
}

const LIVE: TripUpdateIngestDeps = {
  fetchFeed: fetchTripUpdateFeed,
  connect: getPool,
  recordHealth: recordFeedHealth,
  recordFailure: recordFeedFailure,
};

// Fetches the feed and records the delivery, returning null when the fetch
// failed - the failure is already recorded, so callers just return.
export async function readTripUpdateFeed(
  feedUrl: string,
  context: { error: (...args: unknown[]) => void },
  deps: TripUpdateIngestDeps = LIVE,
): Promise<TripUpdateIngest | null> {
  let feed: GtfsRtTripUpdateFeedMessage;
  try {
    feed = await deps.fetchFeed(feedUrl);
  } catch (err) {
    context.error("Failed to fetch GTFS-RT TripUpdate feed:", err);
    try {
      await deps.recordFailure(await deps.connect(), "gtfs_trip_updates", err);
    } catch (healthError) {
      context.error("Failed to record TripUpdate feed failure:", healthError);
    }
    return null;
  }

  const pool = await deps.connect();
  try {
    await deps.recordHealth(pool, "gtfs_trip_updates", feed.Entities.length, feed.Header?.Timestamp ?? null);
  } catch (err) {
    // A ledger write must not cost us the delivery. Both pollers have work to
    // do with this feed whether or not its trust row could be updated.
    context.error("Failed to update TripUpdate feed health:", err);
  }
  return { feed, pool };
}
