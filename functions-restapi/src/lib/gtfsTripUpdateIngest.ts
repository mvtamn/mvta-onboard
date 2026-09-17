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
import { runFeedIngestion, sqlFeedLedger, type FeedLedger } from "./feedRun";
import { fetchTripUpdateFeed, type GtfsRtTripUpdateFeedMessage } from "./gtfsTripUpdates";

export interface TripUpdateIngest {
  feed: GtfsRtTripUpdateFeedMessage;
  pool: sql.ConnectionPool;
}

// Injected so the ledger rule can be tested without a feed or a database, the
// same way spareMissedTripsIngest takes its slot fetcher.
export interface TripUpdateIngestDeps {
  fetchFeed: (url: string) => Promise<GtfsRtTripUpdateFeedMessage>;
  connect: () => Promise<sql.ConnectionPool>;
  ledger: FeedLedger;
}

const LIVE: TripUpdateIngestDeps = {
  fetchFeed: fetchTripUpdateFeed,
  connect: getPool,
  ledger: sqlFeedLedger,
};

// Fetches the feed and records the delivery, returning null when the fetch
// failed - the failure is already recorded, so callers just return.
export async function readTripUpdateFeed(
  feedUrl: string,
  context: { log: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void },
  deps: TripUpdateIngestDeps = LIVE,
): Promise<TripUpdateIngest | null> {
  let feed: GtfsRtTripUpdateFeedMessage | null = null;
  try {
    // Delivery, not storage: every entity handed over counts as received and
    // stored, so this row can never call a delivery failed for what one of its
    // two consumers went on to do with it.
    await runFeedIngestion("gtfs_trip_updates", context, async () => {
      feed = await deps.fetchFeed(feedUrl);
      return {
        kind: "stored",
        received: feed.Entities.length,
        stored: feed.Entities.length,
        sourceTimestampSeconds: feed.Header?.Timestamp ?? null,
      };
    }, deps.ledger);
  } catch {
    return null;
  }
  return feed ? { feed, pool: await deps.connect() } : null;
}
