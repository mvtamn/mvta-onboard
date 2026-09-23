import type { KpiTrust, KpiTrustStream, KpiTrustStreamName } from "@mvta/shared";
import { worstDataState, type OperationalDataState } from "./dataState.js";

// The feeds the Dashboard's "Feeds & freshness" rail reports, and where their
// freshness really comes from: the feed-health ledger, as KPI trust resolves
// it (GET /kpi-trust).
//
// The rail used to label two console API calls as feeds. "GTFS-Realtime" was
// whether the active-messages endpoint answered, and "MVTA Connect" whether
// the suggested-alerts endpoint answered. Both could read "Live data
// connected" while the GTFS-Realtime feed was hours stale or MVTA Connect had
// never delivered at all. Each row now reads its own feed's delivery.
export interface DashboardFeedSpec {
  key: string;
  label: string;
  detail: string;
  stream: KpiTrustStreamName;
  // The dependency whose delivery the row reports - the one that decides
  // whether the stream is current.
  feed: string;
}

export const DASHBOARD_FEEDS: readonly DashboardFeedSpec[] = [
  { key: "gtfs-realtime", label: "GTFS-Realtime", detail: "Fixed-route trip updates", stream: "fixed_route_delay", feed: "gtfs_trip_updates" },
  // Named for the dependency it reports, not for the vendor. The row reads one
  // feed - the hourly reconciliation - and MVTA Connect delivers three others
  // (requests, slots, duties) that it never looks at. Labelling it "MVTA
  // Connect" made a reconciliation that had never run read as a vendor outage,
  // on a console that was showing fresh Spare deliveries at the same moment.
  { key: "mvta-connect", label: "On-demand reconciliation", detail: "MVTA Connect wait-time monitor", stream: "on_demand", feed: "spare_on_demand_reconciliation" },
];

// How the feed-health request itself went, separate from what it said.
export type FeedHealthLoad = "loading" | "ok" | "no_access" | "authentication_required" | "failed";

export interface DashboardFeed {
  key: string;
  label: string;
  detail: string;
  // "no_access" is neutral: a role that cannot read feed health has learned
  // nothing about the feeds, and must not be shown them as broken.
  state: OperationalDataState | "no_access";
  stateLabel: string;
  lastDeliveryAt: string | null;
}

function judge(stream: KpiTrustStream, lastDeliveryAt: string | null): { state: OperationalDataState; label: string } {
  if (stream.state === "current") return { state: "live", label: "Current" };
  if (stream.state === "current_but_empty") return { state: "live", label: "Current · no records" };
  if (stream.state === "stale") return { state: "stale", label: "Stale" };
  // A feed that has never delivered has not failed - it has not been switched
  // on, or has never completed a first run. "Unavailable" claims a working
  // ingestion has gone down, which sends OCC to the vendor instead of to the
  // configuration.
  if (!lastDeliveryAt) return { state: "unavailable", label: "Not received" };
  return { state: "unavailable", label: "Unavailable" };
}

export function dashboardFeeds(streams: KpiTrust | null, load: FeedHealthLoad): DashboardFeed[] {
  return DASHBOARD_FEEDS.map((spec) => {
    const base = { key: spec.key, label: spec.label, detail: spec.detail };
    const stream = streams?.[spec.stream];
    const lastDeliveryAt = stream?.dependencies.find((dependency) => dependency.feed_name === spec.feed)?.last_success_at ?? null;

    if (load === "no_access") return { ...base, state: "no_access", stateLabel: "No access", lastDeliveryAt: null };
    if (load === "authentication_required") return { ...base, state: "authentication-required", stateLabel: "Sign in again", lastDeliveryAt };
    if (!streams) {
      return load === "loading"
        ? { ...base, state: "loading", stateLabel: "Checking", lastDeliveryAt: null }
        : { ...base, state: "unavailable", stateLabel: "Unavailable", lastDeliveryAt: null };
    }
    // A stream the deployed API does not report is unknown, not current.
    if (!stream) return { ...base, state: "unavailable", stateLabel: "Not reported", lastDeliveryAt: null };

    const judged = judge(stream, lastDeliveryAt);
    // A failed re-check leaves the last answer on screen, but it can no longer
    // be vouched for - a feed that was current a minute ago is not claimed to
    // be current now.
    if (load === "failed" && judged.state === "live") {
      return { ...base, state: "stale", stateLabel: "Not rechecked", lastDeliveryAt };
    }
    return { ...base, state: judged.state, stateLabel: judged.label, lastDeliveryAt };
  });
}

export interface FeedSummary {
  state: OperationalDataState;
  label: string;
}

// One line for the whole set: the worst state, and which feeds are behind it.
export function summarizeFeeds(feeds: readonly DashboardFeed[]): FeedSummary {
  const judged = feeds.filter((feed): feed is DashboardFeed & { state: OperationalDataState } => feed.state !== "no_access");
  if (judged.length === 0) return { state: "loading", label: "Feed health is not available to your role" };
  const state = worstDataState(judged.map((feed) => feed.state));
  if (state === "live") return { state, label: "All feeds current" };
  if (state === "loading") return { state, label: "Checking feeds" };
  if (state === "authentication-required") return { state, label: "Sign in again to check feeds" };
  const behind = judged
    .filter((feed) => feed.state !== "live" && feed.state !== "loading")
    .map((feed) => `${feed.label} ${feed.stateLabel.toLowerCase()}`);
  return { state, label: behind.join(" · ") };
}
