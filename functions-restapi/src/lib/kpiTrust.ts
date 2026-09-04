import { ON_DEMAND_DEGRADED_AFTER_MINUTES } from "./onDemandMonitoringHealth";

export type KpiTrustState = "current" | "stale" | "unavailable" | "current_but_empty";

export type KpiFeedName =
  | "gtfs_trip_updates"
  | "gtfs_static"
  | "gtfs_vehicle_positions"
  | "avail_avl"
  | "avail_pullout"
  | "avail_otp_monthly"
  | "avail_otp_daily"
  | "avail_missed_trips"
  | "spare_requests"
  | "spare_slots"
  | "spare_on_demand_reconciliation";

export interface KpiFeedHealth {
  feed_name: KpiFeedName;
  last_success_at: Date | null;
  last_entity_count: number | null;
  source_timestamp_at: Date | null;
  coverage_start_at?: Date | null;
  coverage_end_at?: Date | null;
  last_failure_at?: Date | null;
  last_failure_reason?: string | null;
}

export interface KpiTrustDependency {
  feed_name: KpiFeedName;
  required: boolean;
  state: "current" | "stale" | "unavailable";
  last_success_at: string | null;
  source_timestamp_at: string | null;
  coverage_start_at: string | null;
  coverage_end_at: string | null;
  stale_after_minutes: number | null;
  last_failure_at: string | null;
  last_failure_reason: string | null;
}

export interface KpiTrustStream {
  state: KpiTrustState;
  contract_pending: boolean;
  explanation: string;
  dependencies: KpiTrustDependency[];
}

type DependencyContract = { feedName: KpiFeedName; staleAfterMinutes?: number };
type Contract = { required: readonly DependencyContract[]; supporting?: readonly DependencyContract[] };

const CONTRACTS = {
  fixed_route_delay: { required: [{ feedName: "gtfs_trip_updates", staleAfterMinutes: 15 }, { feedName: "gtfs_static" }], supporting: [{ feedName: "gtfs_vehicle_positions", staleAfterMinutes: 15 }] },
  fixed_route_departures: { required: [{ feedName: "avail_pullout", staleAfterMinutes: 15 }] },
  otp: { required: [{ feedName: "avail_otp_monthly" }], supporting: [{ feedName: "avail_otp_daily" }] },
  event_avl: { required: [{ feedName: "avail_avl", staleAfterMinutes: 2 }] },
  // Only the hourly authoritative reconciliation can establish On-Demand
  // currency, and it runs independently of missed-trip activation. The Spare
  // ingestion feeds stay supporting evidence so SPARE_MISSED_TRIPS_ENABLED
  // cannot decide whether On-Demand risk is trustworthy.
  on_demand: {
    required: [{ feedName: "spare_on_demand_reconciliation", staleAfterMinutes: ON_DEMAND_DEGRADED_AFTER_MINUTES }],
    supporting: [{ feedName: "spare_requests", staleAfterMinutes: 45 }, { feedName: "spare_slots", staleAfterMinutes: 45 }],
  },
  // Avail Missed Trips is retrospective evidence for both missed-trip streams:
  // it explains reduced context without invalidating a current result, so it is
  // declared supporting rather than required.
  fixed_route_missed_trips: {
    required: [{ feedName: "gtfs_trip_updates", staleAfterMinutes: 15 }, { feedName: "gtfs_vehicle_positions", staleAfterMinutes: 15 }],
    supporting: [{ feedName: "avail_missed_trips" }],
  },
  spare_missed_trips: {
    required: [{ feedName: "spare_requests", staleAfterMinutes: 45 }, { feedName: "spare_slots", staleAfterMinutes: 45 }],
    supporting: [{ feedName: "avail_missed_trips" }],
  },
} as const satisfies Record<string, Contract>;

export type KpiTrust = { [K in keyof typeof CONTRACTS]: KpiTrustStream };

function dependency(
  feedName: KpiFeedName,
  required: boolean,
  health: KpiFeedHealth | undefined,
  staleAfterMinutes: number | undefined,
  now: Date,
): KpiTrustDependency {
  const lastSuccess = health?.last_success_at ?? null;
  // A successful delivery of old data is not current coverage. When a source
  // timestamp is supplied, it is the limiting freshness signal.
  const sourceTime = health?.source_timestamp_at ?? health?.coverage_end_at ?? null;
  const freshestUsableAt = sourceTime && lastSuccess
    ? new Date(Math.min(sourceTime.getTime(), lastSuccess.getTime()))
    : lastSuccess;
  // ADR 0027: a successful run with no qualifying records is Current-but-empty,
  // not Stale. Such a run has nothing to timestamp, so the delivery itself is
  // the freshness signal and still ages against the contract. A non-empty
  // delivery of unknown vintage stays unavailable - its coverage is unproven.
  const emptySuccess = health?.last_entity_count === 0;
  const state = !lastSuccess || (staleAfterMinutes && !sourceTime && !emptySuccess)
    ? "unavailable"
    : staleAfterMinutes && freshestUsableAt && now.getTime() - freshestUsableAt.getTime() > staleAfterMinutes * 60_000
      ? "stale"
      : "current";
  return {
    feed_name: feedName,
    required,
    state,
    last_success_at: lastSuccess?.toISOString() ?? null,
    source_timestamp_at: health?.source_timestamp_at?.toISOString() ?? null,
    coverage_start_at: health?.coverage_start_at?.toISOString() ?? null,
    coverage_end_at: health?.coverage_end_at?.toISOString() ?? null,
    stale_after_minutes: staleAfterMinutes ?? null,
    last_failure_at: health?.last_failure_at?.toISOString() ?? null,
    last_failure_reason: health?.last_failure_reason ?? null,
  };
}

function stream(contract: Contract, healthByFeed: Map<KpiFeedName, KpiFeedHealth>, now: Date): KpiTrustStream {
  const dependencies = [
    ...contract.required.map((item) => dependency(item.feedName, true, healthByFeed.get(item.feedName), item.staleAfterMinutes, now)),
    ...(contract.supporting ?? []).map((item) => dependency(item.feedName, false, healthByFeed.get(item.feedName), item.staleAfterMinutes, now)),
  ];
  const required = dependencies.filter((item) => item.required);
  const unavailable = required.some((item) => item.state === "unavailable");
  const stale = required.some((item) => item.state === "stale");
  const contractPending = contract.required.some((item) => !item.staleAfterMinutes);
  const successfulCounts = contract.required.map((item) => healthByFeed.get(item.feedName)?.last_entity_count);
  const currentButEmpty = !unavailable && !stale && successfulCounts.length > 0 && successfulCounts.every((count) => count === 0);
  const state: KpiTrustState = unavailable ? "unavailable" : stale ? "stale" : currentButEmpty ? "current_but_empty" : "current";
  return {
    state,
    contract_pending: contractPending,
    explanation: contractPending
      ? "Delivery is recorded; the periodic stale deadline is pending Operations approval."
      : state === "current_but_empty"
        ? "Required feeds completed successfully with no qualifying records."
        : state === "current"
          ? "Required feed dependencies are current."
          : state === "stale"
            ? "A required feed dependency is beyond its freshness contract."
            : "A required feed dependency has not recorded a successful ingestion.",
    dependencies,
  };
}

export function resolveKpiTrust(records: readonly KpiFeedHealth[], now = new Date()): KpiTrust {
  const healthByFeed = new Map(records.map((record) => [record.feed_name, record]));
  return Object.fromEntries(
    Object.entries(CONTRACTS).map(([name, contract]) => [name, stream(contract, healthByFeed, now)]),
  ) as KpiTrust;
}

// The feed dependencies the two missed-trip streams declare, deduplicated and
// resolved against the same contracts the KPI trust summary uses, so the
// Missed Trips module and the trust banner above it cannot disagree about the
// same feed.
//
// Missed Trips previously derived this itself from every row in the health
// table, against a flat "stale after 15 minutes (35 for spare_)" rule. That
// reported four daily feeds (gtfs_static, avail_missed_trips, avail_otp_daily,
// avail_otp_monthly) as stale on essentially every request - they cannot pass a
// 15-minute deadline - and warned about OTP and pullout feeds that say nothing
// about whether an absent trip may be read as a no-show. A permanently-lit
// warning is one staff learn to scroll past, which is exactly when a real
// outage stops being visible. Feeds with no approved deadline are deliberately
// never called stale here; see the contract_pending explanation above.
export function missedTripFeedDependencies(
  records: readonly KpiFeedHealth[],
  now = new Date(),
): KpiTrustDependency[] {
  const trust = resolveKpiTrust(records, now);
  const merged = new Map<KpiFeedName, KpiTrustDependency>();
  for (const dependency of [
    ...trust.fixed_route_missed_trips.dependencies,
    ...trust.spare_missed_trips.dependencies,
  ]) {
    // Required in either stream wins: a feed that gates one of the two
    // detection paths is required as far as this module is concerned.
    const existing = merged.get(dependency.feed_name);
    if (!existing?.required) merged.set(dependency.feed_name, dependency);
  }
  return [...merged.values()].sort((a, b) => a.feed_name.localeCompare(b.feed_name));
}
