import { feedDependency, type KpiFeedHealth, type KpiFeedName } from "./kpiTrust";

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

// The ledger-backed rows on the Integrations & Data Health page, judged by the
// same feedDependency rule the KPI trust cards above them use.
//
// These rows used to read KpiFeedHealth with their own query and call Spare
// stale after 35 minutes, while the freshness contract says 45. For the ten
// minutes between the two, the page showed these rows Stale directly beneath
// trust cards calling the same feeds Current. Later a second rule judged feeds
// no KPI declares (the prediction capture) by last success alone. A feed has
// one freshness contract, whether or not a KPI reads it; this applies it.
//
// The row keeps its current/stale shape: a feed that has never recorded a
// success, or delivered records with no source time (unavailable), is not
// current, and its last recorded failure is carried as the row's error so the
// page can say why.
export function ledgerFeedChecks(
  feeds: readonly { name: string; feedName: KpiFeedName }[],
  records: readonly KpiFeedHealth[],
  now = new Date(),
): FeedCheck[] {
  const recordByFeed = new Map(records.map((record) => [record.feed_name, record]));
  return feeds.map(({ name, feedName }) => {
    const record = recordByFeed.get(feedName);
    const dependency = feedDependency(feedName, record, now);
    const check: FeedCheck = {
      name,
      configured: true,
      records: record?.last_entity_count ?? 0,
      freshness: dependency.state === "current" ? "current" : "stale",
    };
    if (dependency.last_success_at) check.last_success_at = dependency.last_success_at;
    if (dependency.state !== "current" && dependency.last_failure_reason) {
      check.error = dependency.last_failure_reason;
    }
    return check;
  });
}
