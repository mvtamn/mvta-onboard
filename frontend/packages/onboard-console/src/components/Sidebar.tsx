import { dataStateLabel, type LiveStats } from "../hooks/useLiveStats.js";

// Data-health context for the Dashboard's right rail. Each feed status is
// derived from the live endpoints already used by the dashboard.
export function Sidebar({ stats }: { stats: LiveStats }) {
  const fixedRoutePending = stats.pending?.filter((alert) => alert.source === "gtfs_rt").length ?? null;
  const onDemandPending = stats.pending?.filter((alert) => alert.source === "zona").length ?? null;
  const syncLabel = stats.syncedAt
    ? `Today at ${stats.syncedAt.toLocaleTimeString()}`
    : "Not synced yet";

  return (
    <section className="data-health" aria-labelledby="data-health-title">
      <div className="data-health-header">
        <div>
          <span className="dashboard-eyebrow">Data health</span>
          <h2 id="data-health-title">Feeds &amp; freshness</h2>
        </div>
        <button className="btn-sm data-health-refresh" onClick={stats.refresh}>
          ↻ Refresh
        </button>
      </div>

      <div className={`data-health-summary ${stats.overallState}`} role="status">
        <span className="live-dot" />
        <strong>{dataStateLabel(stats.overallState)}</strong>
      </div>

      <div className="data-health-status" aria-live="polite">
        <div className={`data-health-feed ${stats.activeState}`}>
          <span className="live-dot" />
          GTFS-Realtime · {dataStateLabel(stats.activeState)}
        </div>
        <div className={`data-health-feed ${stats.pendingState}`}>
          <span className="live-dot" />
          MVTA Connect · {dataStateLabel(stats.pendingState)}
        </div>
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
        <span>Last successful sync</span>
        <strong>{syncLabel}</strong>
      </div>

      <p className="data-health-guidance">
        Use the queue to investigate, prepare an alert, or review messages nearest to expiration.
      </p>
    </section>
  );
}
