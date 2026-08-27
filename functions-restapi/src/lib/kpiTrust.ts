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
  | "spare_slots";

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
  on_demand: { required: [{ feedName: "spare_requests", staleAfterMinutes: 45 }], supporting: [{ feedName: "spare_slots", staleAfterMinutes: 45 }] },
  fixed_route_missed_trips: { required: [{ feedName: "gtfs_trip_updates", staleAfterMinutes: 15 }, { feedName: "gtfs_vehicle_positions", staleAfterMinutes: 15 }] },
  spare_missed_trips: { required: [{ feedName: "spare_requests", staleAfterMinutes: 45 }, { feedName: "spare_slots", staleAfterMinutes: 45 }] },
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
  const state = !lastSuccess || (staleAfterMinutes && !sourceTime)
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
