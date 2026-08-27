import assert from "node:assert";
import { test } from "node:test";
import { resolveKpiTrust, type KpiFeedHealth } from "./kpiTrust";

const now = new Date("2026-08-27T18:00:00.000Z");

function health(feed_name: KpiFeedHealth["feed_name"], minutesAgo: number, count = 3): KpiFeedHealth {
  return {
    feed_name,
    last_success_at: new Date(now.getTime() - minutesAgo * 60_000),
    last_entity_count: count,
    source_timestamp_at: new Date(now.getTime() - minutesAgo * 60_000),
  };
}

test("reports a current fixed-route delay stream when its required GTFS feeds are fresh", () => {
  const trust = resolveKpiTrust([
    health("gtfs_trip_updates", 14),
    health("gtfs_static", 90),
    health("gtfs_vehicle_positions", 3),
  ], now);

  assert.strictEqual(trust.fixed_route_delay.state, "current");
  assert.strictEqual(trust.fixed_route_delay.dependencies[0].required, true);
  assert.strictEqual(trust.fixed_route_delay.dependencies[2].required, false);
});

test("keeps a compound missed-trip source stream current when the other stream is stale", () => {
  const trust = resolveKpiTrust([
    health("gtfs_trip_updates", 5),
    health("gtfs_vehicle_positions", 5),
    health("spare_requests", 50),
    health("spare_slots", 10),
  ], now);

  assert.strictEqual(trust.fixed_route_missed_trips.state, "current");
  assert.strictEqual(trust.spare_missed_trips.state, "stale");
});

test("reports a successful zero-record run as current but empty", () => {
  const trust = resolveKpiTrust([health("avail_pullout", 5, 0)], now);

  assert.strictEqual(trust.fixed_route_departures.state, "current_but_empty");
});

test("does not invent a stale deadline for periodic sources", () => {
  const trust = resolveKpiTrust([health("avail_otp_monthly", 60 * 24 * 45)], now);

  assert.strictEqual(trust.otp.state, "current");
  assert.strictEqual(trust.otp.contract_pending, true);
});
