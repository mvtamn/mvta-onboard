import type { LiveStats } from "../hooks/useLiveStats.js";
import type { DashboardFeed, FeedSummary } from "../hooks/feedFreshness.js";
import { whenLabel } from "../routes/modules/kpiTrustPresentation.js";
import { LiveSignal, signalStateFor } from "./LiveSignal.js";

// Data-health context for the Dashboard's right rail. Each feed row reports
// that feed's own delivery from the feed-health ledger. It used to report two
// console API calls under feed names - "GTFS-Realtime" was the active-messages
// endpoint answering - so a stale feed could sit under "Live data connected".
export function Sidebar({
  stats,
  feeds,
  summary,
  checkedAt,
  onRefresh,
}: {
  stats: LiveStats;
  feeds: DashboardFeed[];
  summary: FeedSummary;
  checkedAt: Date | null;
  onRefresh: () => void;
}) {
  const fixedRoutePending = stats.pending?.filter((alert) => alert.source === "gtfs_rt").length ?? null;
  const onDemandPending = stats.pending?.filter((alert) => alert.source === "zona").length ?? null;
  const checkedLabel = checkedAt ? `Today at ${checkedAt.toLocaleTimeString()}` : "Not checked yet";

  return (
    <section className="data-health" aria-labelledby="data-health-title">
      <div className="data-health-header">
        <div>
          <span className="dashboard-eyebrow">Data health</span>
          <h2 id="data-health-title">Feeds &amp; freshness</h2>
        </div>
        <button className="btn-sm data-health-refresh" onClick={onRefresh}>
          ↻ Refresh
        </button>
      </div>

      <div className={`data-health-summary ${summary.state}`} role="status">
        <LiveSignal state={signalStateFor(summary.state)} />
        <strong>{summary.label}</strong>
      </div>

      <div className="data-health-status" aria-live="polite">
        {feeds.map((feed) => (
          <div key={feed.key} className={`data-health-feed ${feed.state === "no_access" ? "loading" : feed.state}`}>
            {/* No access says nothing about the feed, so it gets no signal at all. */}
            {feed.state === "no_access" ? null : <LiveSignal state={signalStateFor(feed.state)} size="sm" />}
            <span className="data-health-feed-text">
              {feed.label} · {feed.stateLabel}
              <small>
                {feed.detail}
                {feed.lastDeliveryAt
                  ? ` · last delivery ${whenLabel(feed.lastDeliveryAt)}`
                  : feed.state === "unavailable" ? " · no delivery recorded" : ""}
              </small>
            </span>
          </div>
        ))}
      </div>

      <div className="data-health-pending" aria-label="Pending alerts by feed">
        <div className="data-health-pending-heading">Pending alerts by feed</div>
        <div className="data-health-pending-row fixed-route">
          <span><strong>Fixed-route delays</strong><small>Delay candidates</small></span>
          <b>{fixedRoutePending ?? "—"}</b>
        </div>
        <div className="data-health-pending-row on-demand">
          <span><strong>On-demand wait times</strong><small>Wait-time candidates</small></span>
          <b>{onDemandPending ?? "—"}</b>
        </div>
      </div>

      <div className="data-health-sync">
        <span>Feeds last checked</span>
        <strong>{checkedLabel}</strong>
      </div>

      <p className="data-health-guidance">
        Use the queue to investigate, prepare an alert, or review messages nearest to expiration.
      </p>
    </section>
  );
}
