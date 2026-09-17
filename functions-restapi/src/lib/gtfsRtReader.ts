// The one module that fetches MVTA's GTFS-Realtime feeds.
//
// Three feeds (TripUpdate, VehiclePosition, Alert) were fetched by four copies
// of the same bare `fetch(url)`: no timeout, so a hung InfoPoint response held
// the Function App's worker for as long as it cared to; no check that the body
// was a feed at all, so an HTML error page with a 200 became a thrown
// "Entities is not iterable" deep inside a poller; and a fifth copy in
// /feed-checks that tested connectivity by a different path from the polls.
//
// The feeds are served as JSON through InfoPoint's `debug=true` access path,
// an internal/unofficial route rather than a vendor protobuf endpoint. If that
// changes, this is the only module that parses a response.
//
// What a delivery means on the ledger is decided per feed, and only the
// TripUpdate feed is recorded here:
//
// - gtfs_trip_updates records DELIVERY, through readTripUpdateDelivery, for
//   the two five-minute consumers (gtfsDelaysPoll, gtfsMissedTripsPoll). They
//   write different tables, so no single stored count could describe both, and
//   per-consumer processing failures belong in that consumer's diagnostics.
//   The one-minute trip-start poll fetches with fetchGtfsRtFeed and records
//   nothing: Service Risk's live indicator reads each new last_success_at as a
//   delivery on the five-minute poll grid, and a one-minute writer would make
//   it announce data the delays poll had not yet written.
// - gtfs_vehicle_positions records the underway EVIDENCE its poll stored, which
//   the silent-no-show detector relies on, so that poll records its own stored
//   count and uses this module only to fetch.
// - gtfs_alerts records what reached the review queue, likewise.
import { runFeedIngestion, sqlFeedLedger, type FeedLedger, type FeedRunLog } from "./feedRun";
import type { FeedCheck } from "./feedCheckResponse";
import type { GtfsRtFeedMessage } from "./gtfsRealtime";
import type { GtfsRtTripUpdateFeedMessage } from "./gtfsTripUpdates";
import type { GtfsRtVehiclePositionFeedMessage } from "./gtfsVehiclePositions";

export type GtfsRtFeed = "trip_updates" | "vehicle_positions" | "alerts";

export interface GtfsRtMessages {
  trip_updates: GtfsRtTripUpdateFeedMessage;
  vehicle_positions: GtfsRtVehiclePositionFeedMessage;
  alerts: GtfsRtFeedMessage;
}

export interface GtfsRtTransport {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

// Well under the five-minute cadence of three of the four readers, and long
// enough for the largest TripUpdate body on a slow afternoon. The one-minute
// reader is allowed the same: a response that takes longer than its minute
// fails that run rather than overlapping the next one indefinitely.
const DEFAULT_TIMEOUT_MS = 30_000;

const FEEDS: { [F in GtfsRtFeed]: { label: string; checkName: string; urlSetting: string } } = {
  trip_updates: { label: "GTFS-RT TripUpdate", checkName: "GTFS TripUpdates", urlSetting: "GTFS_RT_TRIPUPDATE_URL" },
  vehicle_positions: { label: "GTFS-RT VehiclePosition", checkName: "GTFS VehiclePositions", urlSetting: "GTFS_RT_VEHICLE_URL" },
  alerts: { label: "GTFS-RT Alert", checkName: "GTFS Alerts", urlSetting: "GTFS_RT_ALERT_URL" },
};

export function gtfsRtFeedUrl(feed: GtfsRtFeed, env: NodeJS.ProcessEnv = process.env): string | null {
  return env[FEEDS[feed].urlSetting]?.trim() || null;
}

export function gtfsRtUrlSetting(feed: GtfsRtFeed): string {
  return FEEDS[feed].urlSetting;
}

export async function fetchGtfsRtFeed<F extends GtfsRtFeed>(
  feed: F,
  url: string,
  transport: GtfsRtTransport = {},
): Promise<GtfsRtMessages[F]> {
  const label = FEEDS[feed].label;
  const response = await (transport.fetch ?? fetch)(url, {
    signal: AbortSignal.timeout(transport.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${label} feed request failed: ${response.status}`);
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    // Never echo the body: an unexpected page says nothing useful and may be
    // large. Its first characters are enough to tell HTML from truncation.
    throw new Error(`${label} feed returned a body that is not JSON (starts ${JSON.stringify(text.slice(0, 40))}).`);
  }
  const entities = (body as { Entities?: unknown } | null)?.Entities;
  if (!Array.isArray(entities)) {
    throw new Error(`${label} feed returned JSON without an Entities array.`);
  }
  return body as GtfsRtMessages[F];
}

export interface TripUpdateDelivery {
  feed: GtfsRtTripUpdateFeedMessage;
}

// Injected so the delivery rule can be tested without a feed or a database.
export interface TripUpdateDeliveryDeps {
  fetchFeed: (url: string) => Promise<GtfsRtTripUpdateFeedMessage>;
  ledger: FeedLedger;
}

const LIVE: TripUpdateDeliveryDeps = {
  fetchFeed: (url) => fetchGtfsRtFeed("trip_updates", url),
  ledger: sqlFeedLedger,
};

// Fetches the TripUpdate feed and records the delivery on gtfs_trip_updates.
// Returns null when the fetch failed; the failure is already recorded, so the
// consumer just returns.
export async function readTripUpdateDelivery(
  feedUrl: string,
  log: FeedRunLog,
  deps: TripUpdateDeliveryDeps = LIVE,
): Promise<TripUpdateDelivery | null> {
  let feed: GtfsRtTripUpdateFeedMessage | null = null;
  try {
    await runFeedIngestion("gtfs_trip_updates", log, async () => {
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
  return feed ? { feed } : null;
}

// The /feed-checks connection test: the same setting, timeout and body checks
// the polls use.
export async function probeGtfsRtFeed(
  feed: GtfsRtFeed,
  transport: GtfsRtTransport = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<FeedCheck> {
  const name = FEEDS[feed].checkName;
  const url = gtfsRtFeedUrl(feed, env);
  if (!url) return { name, configured: false };
  try {
    const message = await fetchGtfsRtFeed(feed, url, transport);
    return { name, configured: true, status: 200, records: message.Entities.length };
  } catch (error) {
    return { name, configured: true, error: error instanceof Error ? error.message : "Request failed" };
  }
}
