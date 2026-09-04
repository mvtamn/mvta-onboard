import assert from "node:assert";
import { test } from "node:test";
import { missedTripFeedDependencies, resolveKpiTrust, type KpiFeedHealth } from "./kpiTrust";

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

test("does not call a recently delivered but old source record current", () => {
  const record = health("gtfs_trip_updates", 1);
  record.source_timestamp_at = new Date(now.getTime() - 30 * 60_000);
  const trust = resolveKpiTrust([record, health("gtfs_static", 1)], now);

  assert.strictEqual(trust.fixed_route_delay.state, "stale");
  assert.strictEqual(trust.fixed_route_delay.dependencies[0].stale_after_minutes, 15);
});

test("establishes on-demand trust from the authoritative reconciliation alone", () => {
  const trust = resolveKpiTrust([health("spare_on_demand_reconciliation", 30)], now);

  assert.strictEqual(trust.on_demand.state, "current");
  assert.strictEqual(trust.on_demand.dependencies[0].feed_name, "spare_on_demand_reconciliation");
  assert.strictEqual(trust.on_demand.dependencies[1].required, false);
});

test("keeps on-demand trust current when only the missed-trip Spare feeds are stale", () => {
  const trust = resolveKpiTrust([
    health("spare_on_demand_reconciliation", 30),
    health("spare_requests", 50),
    health("spare_slots", 50),
  ], now);

  assert.strictEqual(trust.on_demand.state, "current");
  assert.strictEqual(trust.spare_missed_trips.state, "stale");
});

test("reports on-demand as unavailable when no reconciliation has succeeded", () => {
  const trust = resolveKpiTrust([health("spare_requests", 5), health("spare_slots", 5)], now);

  assert.strictEqual(trust.on_demand.state, "unavailable");
});

test("reports a zero-active reconciliation as current but empty", () => {
  const trust = resolveKpiTrust([health("spare_on_demand_reconciliation", 30, 0)], now);

  assert.strictEqual(trust.on_demand.state, "current_but_empty");
});

test("surfaces Avail missed-trip evidence on both missed-trip streams without gating them", () => {
  const trust = resolveKpiTrust([
    health("gtfs_trip_updates", 5),
    health("gtfs_vehicle_positions", 5),
    health("spare_requests", 5),
    health("spare_slots", 5),
  ], now);

  for (const stream of [trust.fixed_route_missed_trips, trust.spare_missed_trips]) {
    const evidence = stream.dependencies.find((item) => item.feed_name === "avail_missed_trips");
    assert.strictEqual(evidence?.required, false);
    // No successful ingestion recorded, yet the stream stays current.
    assert.strictEqual(evidence?.state, "unavailable");
    assert.strictEqual(stream.state, "current");
  }
});

test("does not call a successful zero-record real-time run unavailable", () => {
  // A poll that ingested nothing has no source timestamp to report; the
  // delivery is the evidence, so the dependency is covered.
  const empty = { ...health("gtfs_trip_updates", 5, 0), source_timestamp_at: null };
  const trust = resolveKpiTrust([empty, health("gtfs_static", 90)], now);

  assert.strictEqual(trust.fixed_route_delay.dependencies[0].state, "current");
  assert.strictEqual(trust.fixed_route_delay.state, "current");
});

test("reports a stream whose required feeds all ran empty as current but empty", () => {
  const trust = resolveKpiTrust([
    { ...health("gtfs_trip_updates", 5, 0), source_timestamp_at: null },
    { ...health("gtfs_vehicle_positions", 5, 0), source_timestamp_at: null },
  ], now);

  assert.strictEqual(trust.fixed_route_missed_trips.state, "current_but_empty");
});

test("ages a zero-record run against its contract from the delivery time", () => {
  const empty = { ...health("gtfs_trip_updates", 30, 0), source_timestamp_at: null };
  const trust = resolveKpiTrust([empty, health("gtfs_static", 90)], now);

  assert.strictEqual(trust.fixed_route_delay.state, "stale");
});

test("still reports a non-empty delivery of unknown vintage as unavailable", () => {
  const unknown = { ...health("gtfs_trip_updates", 5, 3), source_timestamp_at: null };
  const trust = resolveKpiTrust([unknown, health("gtfs_static", 90)], now);

  assert.strictEqual(trust.fixed_route_delay.state, "unavailable");
});

test("missed-trip feed dependencies exclude feeds that detection does not depend on", () => {
  const dependencies = missedTripFeedDependencies([
    health("gtfs_trip_updates", 5),
    health("gtfs_vehicle_positions", 5),
    health("spare_requests", 5),
    health("spare_slots", 5),
    // All stale under the old flat rule, none a missed-trip dependency.
    health("avail_otp_daily", 900),
    health("avail_otp_monthly", 900),
    health("avail_pullout", 900),
    health("gtfs_static", 900),
  ], now);

  assert.deepStrictEqual(
    dependencies.map((dependency) => dependency.feed_name),
    ["avail_missed_trips", "gtfs_trip_updates", "gtfs_vehicle_positions", "spare_requests", "spare_slots"],
  );
});

test("a daily missed-trip feed with no approved deadline is never reported stale", () => {
  // avail_missed_trips polls once a day, so 17 hours is a healthy run. The old
  // flat 15-minute rule called it stale on essentially every request.
  const dependencies = missedTripFeedDependencies([health("avail_missed_trips", 17 * 60)], now);
  const availMissedTrips = dependencies.find((dependency) => dependency.feed_name === "avail_missed_trips");

  assert.strictEqual(availMissedTrips?.state, "current");
  assert.strictEqual(availMissedTrips?.required, false);
  assert.strictEqual(availMissedTrips?.stale_after_minutes, null);
});

test("a required missed-trip feed past its own contract is reported stale", () => {
  const dependencies = missedTripFeedDependencies([
    health("gtfs_trip_updates", 5),
    health("gtfs_vehicle_positions", 5),
    // Spare ingestion runs every 15 minutes; 12 hours without one is a real
    // outage, and its 45-minute contract catches it where 15 would misjudge
    // the daily feeds alongside it.
    { ...health("spare_requests", 12 * 60, 0), source_timestamp_at: null },
    { ...health("spare_slots", 12 * 60, 0), source_timestamp_at: null },
  ], now);
  const stale = dependencies.filter((dependency) => dependency.state === "stale");

  assert.deepStrictEqual(stale.map((dependency) => dependency.feed_name), ["spare_requests", "spare_slots"]);
  assert.strictEqual(stale.every((dependency) => dependency.required), true);
  assert.strictEqual(stale[0].stale_after_minutes, 45);
});

test("a feed required by one missed-trip stream stays required after deduplication", () => {
  const dependencies = missedTripFeedDependencies([health("spare_requests", 5), health("gtfs_trip_updates", 5)], now);

  assert.strictEqual(dependencies.find((d) => d.feed_name === "spare_requests")?.required, true);
  assert.strictEqual(dependencies.find((d) => d.feed_name === "gtfs_trip_updates")?.required, true);
});
