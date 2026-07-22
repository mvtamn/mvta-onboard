import type { LiveStats } from "../hooks/useLiveStats.js";

const dash = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toLocaleString());

// Live data-source sidebar per the approved dashboard mockup. Counts degrade
// to "—" when an auth-gated endpoint isn't reachable (mock preview mode).
export function Sidebar({ stats }: { stats: LiveStats }) {
  const gtfsPending = stats.pending?.filter((a) => a.source === "gtfs_rt").length ?? null;
  const zonaPending = stats.pending?.filter((a) => a.source === "zona").length ?? null;

  return (
    <div className="sidebar">
      <div className="side-label">Data source</div>
      <div className="live-badge">
        <span className="live-dot" />
        {stats.ok ? "Live" : "Offline"}
        {stats.syncedAt ? ` · ${stats.syncedAt.toLocaleTimeString()}` : ""}
      </div>
      <div className="datasource-card">
        <div>
          {stats.ok ? <span className="ok">✓ Live from Azure SQL</span> : <span className="err">✕ API unreachable</span>}
        </div>
        Active messages: {dash(stats.activeCount)}
        <br />
        Pending alerts: {dash(stats.pending?.length ?? null)}
        <br />
        Subscribers: {dash(stats.subscribers?.total)}
        <br />
        {stats.lastMessageId ? (
          <>
            Last message: {stats.lastMessageId.slice(0, 8)}…
            <br />
          </>
        ) : null}
        Synced: {stats.syncedAt ? stats.syncedAt.toLocaleTimeString() : "—"}
      </div>
      <button className="refresh-btn" onClick={stats.refresh}>
        ↻ Refresh
      </button>

      <div className="side-label">Pending by source</div>
      <div className="stat-card" style={{ borderLeftColor: "#F78E1E" }}>
        <div className="stat-label" style={{ color: "#B5620C" }}>GTFS-REALTIME</div>
        <div className="stat-value">{dash(gtfsPending)}</div>
        <div className="stat-sub">Fixed-route delay candidates</div>
      </div>
      <div className="stat-card" style={{ borderLeftColor: "#417B68" }}>
        <div className="stat-label" style={{ color: "#2C5A47" }}>ZONA</div>
        <div className="stat-value">{dash(zonaPending)}</div>
        <div className="stat-sub">Wait-time candidates</div>
      </div>

      <div className="side-label">Message totals</div>
      <div className="totals-row"><span>Active messages</span><span className="n">{dash(stats.activeCount)}</span></div>
      <div className="totals-row"><span>SMS subscribers</span><span className="n">{dash(stats.subscribers?.sms_confirmed)}</span></div>
      <div className="totals-row"><span>Email subscribers</span><span className="n">{dash(stats.subscribers?.email_confirmed)}</span></div>
      <div className="totals-row"><span>Pending opt-ins</span><span className="n">{dash(stats.subscribers?.pending)}</span></div>
    </div>
  );
}
