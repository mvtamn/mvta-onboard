import type { LiveStats } from "../hooks/useLiveStats.js";

// Data-health context for the Dashboard's right rail. Each feed status is
// derived from the live endpoints already used by the dashboard.
export function Sidebar({ stats }: { stats: LiveStats }) {
  const gtfsHealthy = stats.ok;
  const mvtaConnectHealthy = stats.pending !== null;
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

      <div className="data-health-status" aria-live="polite">
        <div className={`data-health-feed${gtfsHealthy ? "" : " is-unavailable"}`}>
          <span className="live-dot" />
          GTFS-Realtime · {gtfsHealthy ? "healthy" : "unavailable"}
        </div>
        <div className={`data-health-feed${mvtaConnectHealthy ? "" : " is-unavailable"}`}>
          <span className="live-dot" />
          MVTA Connect · {mvtaConnectHealthy ? "healthy" : "unavailable"}
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
