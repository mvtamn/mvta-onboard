import { test } from "node:test";
import assert from "node:assert";
import { FEED_POLL_INTERVAL_MINUTES, FEED_STALE_AFTER_MINUTES, GTFS_DELAYS_POLL_SCHEDULE } from "./feedFreshness";
import { resolveKpiTrust } from "./kpiTrust";
import {
  resolveTripDelayView,
  TRIP_DELAY_STALE_AFTER_MINUTES,
} from "./tripDelayDiagnostics";

const NOW = new Date("2026-07-27T15:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
const row = (id: string, minutes: number) => ({ trip_id: id, last_polled_at: minutesAgo(minutes) });

test("reports missing configuration before evaluating feed freshness", () => {
  const view = resolveTripDelayView({
    tripUpdatesConfigured: false,
    feedState: "current",
    rows: [row("a", 1)],
    now: NOW,
  });
  assert.strictEqual(view.state, "configuration_missing");
});

test("reports current data when the feed answered and trips were refreshed inside the limit", () => {
  const view = resolveTripDelayView({
    tripUpdatesConfigured: true,
    feedState: "current",
    rows: [row("a", 2), row("b", 4)],
    now: NOW,
  });
  assert.strictEqual(view.state, "current");
  assert.deepStrictEqual(view.delays.map((d) => d.trip_id), ["a", "b"]);
});

// The overnight case: the feed answers on schedule and reports nothing running.
test("reports no current trips only when the feed itself answered inside its contract", () => {
  const view = resolveTripDelayView({
    tripUpdatesConfigured: true,
    feedState: "current",
    rows: [],
    now: NOW,
  });
  assert.strictEqual(view.state, "no_current_trips");
});

// The masking case. The poller deletes rows after each successful fetch, so an
// empty table is not evidence the feed is healthy. It used to short-circuit to
// "no current trips" - which the console shows as a quiet, moving banner.
test("does not report a feed that stopped answering as a healthy empty feed", () => {
  for (const feedState of ["stale", "unavailable"] as const) {
    const view = resolveTripDelayView({
      tripUpdatesConfigured: true,
      feedState,
      rows: [],
      now: NOW,
    });
    assert.strictEqual(view.state, feedState, `empty table with a ${feedState} feed`);
  }
});

// A frozen vendor snapshot keeps being "delivered" and keeps refreshing rows,
// but KPI trust ages it by the feed's own header timestamp. The ledger wins.
test("reports the feed's state even when the rows look freshly polled", () => {
  const view = resolveTripDelayView({
    tripUpdatesConfigured: true,
    feedState: "stale",
    rows: [row("a", 1)],
    now: NOW,
  });
  assert.strictEqual(view.state, "stale");
});

// The nightly blip. Between the freshness limit and the next cleanup, the
// table still holds rows for trips the feed has stopped reporting. With a
// current feed those are not current trips, and must not be shown beside
// "no current trips".
test("leaves out rows past the limit while the feed is current, so the state and list agree", () => {
  const view = resolveTripDelayView({
    tripUpdatesConfigured: true,
    feedState: "current",
    rows: [row("finished", TRIP_DELAY_STALE_AFTER_MINUTES + 2)],
    now: NOW,
  });
  assert.strictEqual(view.state, "no_current_trips");
  assert.deepStrictEqual(view.delays, []);

  const mixed = resolveTripDelayView({
    tripUpdatesConfigured: true,
    feedState: "current",
    rows: [row("running", 3), row("finished", TRIP_DELAY_STALE_AFTER_MINUTES + 2)],
    now: NOW,
  });
  assert.strictEqual(mixed.state, "current");
  assert.deepStrictEqual(mixed.delays.map((d) => d.trip_id), ["running"]);
});

test("keeps the last known rows while the feed is not current, and still says when data last arrived", () => {
  const old = row("a", 40);
  const view = resolveTripDelayView({
    tripUpdatesConfigured: true,
    feedState: "stale",
    rows: [old],
    now: NOW,
  });
  assert.deepStrictEqual(view.delays, [old]);
  assert.strictEqual(view.lastTripUpdateAt?.getTime(), old.last_polled_at.getTime());
});

// B: one limit per feed. Service Risk, KPI trust and the poller's cleanup all
// judge the TripUpdate feed; they used to disagree (10, 15 and 15 minutes).
test("Service Risk, KPI trust and the cleanup share the TripUpdate feed's one limit", () => {
  const limit = FEED_STALE_AFTER_MINUTES.gtfs_trip_updates;
  assert.strictEqual(TRIP_DELAY_STALE_AFTER_MINUTES, limit);

  const trust = resolveKpiTrust([], NOW);
  const kpiLimit = trust.fixed_route_delay.dependencies
    .find((dependency) => dependency.feed_name === "gtfs_trip_updates")?.stale_after_minutes;
  assert.strictEqual(kpiLimit, limit);
});

// The console counts down to the next TripUpdate delivery and marks polls as
// missed on this cadence. If the schedule and the advertised interval drifted
// apart, every countdown would be a lie.
test("the TripUpdate poller runs on the cadence the console is told", () => {
  assert.strictEqual(GTFS_DELAYS_POLL_SCHEDULE, `0 */${FEED_POLL_INTERVAL_MINUTES.gtfs_trip_updates} * * * *`);
  assert.strictEqual(GTFS_DELAYS_POLL_SCHEDULE, "0 */5 * * * *");
  // A feed is not stale until it has missed more than one delivery.
  assert.ok(FEED_STALE_AFTER_MINUTES.gtfs_trip_updates >= 2 * FEED_POLL_INTERVAL_MINUTES.gtfs_trip_updates);
});

