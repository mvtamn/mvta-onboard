import { resolveKpiTrust, type KpiFeedHealth, type KpiFeedName, type KpiTrustDependency } from "./kpiTrust";
import { FEED_STALE_AFTER_MINUTES } from "./feedFreshness";

export type FeedResponseSummary = { records: number; keys?: string[] };

export function summarizeFeedResponse(body: unknown): FeedResponseSummary {
  if (!body || typeof body !== "object") return { records: 0 };
  const value = body as Record<string, unknown>;
  if (Array.isArray(value.Entities)) return { records: value.Entities.length };
  if (Array.isArray(value.data)) {
    const total = typeof value.total === "number" && Number.isInteger(value.total) && value.total >= 0
      ? value.total
      : value.data.length;
    const first = value.data[0];
    return { records: total, keys: first && typeof first === "object" ? Object.keys(first) : undefined };
  }
  const result = value.result && typeof value.result === "object" ? value.result as Record<string, unknown> : {};
  const array = Object.values(result).find(Array.isArray);
  return { records: Array.isArray(array) ? array.length : 0, keys: Object.keys(result) };
}

export type FeedCheck = {
  name: string;
  configured: boolean;
  status?: number;
  records?: number;
  keys?: string[];
  error?: string;
  freshness?: "current" | "stale";
  last_success_at?: string;
};

// The ledger-backed rows on the Integrations & Data Health page, taken from the
// same KPI trust dependencies the trust cards above them show.
//
// These rows used to read KpiFeedHealth with their own query and call Spare
// stale after 35 minutes, while the freshness contract says 45. For the ten
// minutes between the two, the page showed these rows Stale directly beneath
// trust cards calling the same feeds Current. A feed has one freshness
// contract; this reads it rather than restating it.
//
// The row keeps its current/stale shape: a feed that has never recorded a
// success (unavailable) is not current, and its last recorded failure is
// carried as the row's error so the page can say why.
export function ledgerFeedChecks(
  feeds: readonly { name: string; feedName: KpiFeedName }[],
  records: readonly KpiFeedHealth[],
  now = new Date(),
): FeedCheck[] {
  const trust = resolveKpiTrust(records, now);
  const dependencies = new Map<KpiFeedName, KpiTrustDependency>();
  for (const stream of Object.values(trust)) {
    for (const dependency of stream.dependencies) {
      if (!dependencies.has(dependency.feed_name)) dependencies.set(dependency.feed_name, dependency);
    }
  }
  const recordByFeed = new Map(records.map((record) => [record.feed_name, record]));
  return feeds.map(({ name, feedName }) => {
    // A feed no KPI depends on (the prediction capture) has no trust
    // dependency to read; it is judged by the same freshness table instead.
    const dependency = dependencies.get(feedName) ?? ledgerOnlyDependency(feedName, recordByFeed.get(feedName), now);
    const check: FeedCheck = {
      name,
      configured: true,
      records: recordByFeed.get(feedName)?.last_entity_count ?? 0,
      freshness: dependency?.state === "current" ? "current" : "stale",
    };
    if (dependency?.last_success_at) check.last_success_at = dependency.last_success_at;
    if (dependency && dependency.state !== "current" && dependency.last_failure_reason) {
      check.error = dependency.last_failure_reason;
    }
    return check;
  });
}

function ledgerOnlyDependency(feedName: KpiFeedName, record: KpiFeedHealth | undefined, now: Date): KpiTrustDependency | undefined {
  const limit = (FEED_STALE_AFTER_MINUTES as Partial<Record<KpiFeedName, number>>)[feedName];
  if (!record || limit === undefined) return undefined;
  const lastSuccess = record.last_success_at;
  const current = lastSuccess !== null && now.getTime() - lastSuccess.getTime() <= limit * 60_000;
  return {
    feed_name: feedName,
    required: false,
    state: lastSuccess === null ? "unavailable" : current ? "current" : "stale",
    last_success_at: lastSuccess ? lastSuccess.toISOString() : null,
    source_timestamp_at: record.source_timestamp_at ? record.source_timestamp_at.toISOString() : null,
    coverage_start_at: null,
    coverage_end_at: null,
    stale_after_minutes: limit,
    last_failure_at: record.last_failure_at ? record.last_failure_at.toISOString() : null,
    last_failure_reason: record.last_failure_reason ?? null,
  };
}
