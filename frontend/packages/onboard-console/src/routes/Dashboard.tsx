import { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import type { ActiveMessage, SuggestedAlert } from "@mvta/shared";
import { MessagesTable } from "../components/MessagesTable.js";
import { Sidebar } from "../components/Sidebar.js";
import type { LiveStats } from "../hooks/useLiveStats.js";

// Dashboard: triage-first metrics and next actions, followed by published
// communications. Compose remains available from its dedicated route. `stats` comes from App.tsx's single useLiveStats()
// instance (also drives the nav footer) rather than polling again here.
export function Dashboard({ stats, onChanged }: { stats: LiveStats; onChanged?: () => void }) {
  const [activeMessages, setActiveMessages] = useState<ActiveMessage[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const knownActiveMessages = activeMessages ?? stats.activeMessages ?? null;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  function refreshAll() {
    stats.refresh();
    onChanged?.();
  }

  const expiringSoon = useMemo(() => {
    if (!knownActiveMessages) return null;
    const cutoff = now + 60 * 60 * 1000;
    return knownActiveMessages.filter((message) => new Date(message.expires_at).getTime() <= cutoff).length;
  }, [knownActiveMessages, now]);

  const triageItems = useMemo(() => buildTriageItems(knownActiveMessages, stats.pending, now), [knownActiveMessages, stats.pending, now]);

  return (
    <div className="content-layout">
      <div className="content-primary">
        <div className="dashboard-freshness" role="status">
          <span className={stats.ok ? "live-dot" : "live-dot is-offline"} />
          <strong>{stats.ok ? "Live data connected" : "Live data unavailable"}</strong>
          <span>{stats.syncedAt ? `Updated ${stats.syncedAt.toLocaleTimeString()}` : "Retrying connection"}</span>
          <NavLink to="/service-operations/suggested">{stats.pending?.length ?? "—"} suggested alerts</NavLink>
        </div>

        <div className="dashboard-metrics" aria-label="Dashboard summary">
          <DashboardMetric label="Active rider alerts" value={knownActiveMessages?.length ?? stats.activeCount ?? "—"} />
          <DashboardMetric label="Suggested alerts" value={stats.pending?.length ?? "—"} tone="attention" />
          <DashboardMetric label="Expiring within 1 hour" value={expiringSoon ?? "—"} tone="attention" />
          <DashboardMetric label="Feed state" value={stats.ok ? "Live" : "Offline"} tone={stats.ok ? "healthy" : "attention"} />
        </div>

        <div className="dashboard-triage-grid">
          <section className="dashboard-queue" aria-labelledby="dashboard-queue-title">
            <div className="dashboard-section-heading">
              <div>
                <span className="dashboard-eyebrow">Priority queue</span>
                <h2 id="dashboard-queue-title">Next actions</h2>
              </div>
              <NavLink className="btn-sm" to="/service-operations/suggested">Open queue</NavLink>
            </div>
            {triageItems.length > 0 ? (
              <div className="dashboard-queue-list">
                {triageItems.map((item) => (
                  <div className="dashboard-queue-row" key={item.id}>
                    <span className={`dashboard-queue-signal ${item.tone}`} aria-hidden="true" />
                    <div>
                      <strong>{item.title}</strong>
                        <span><b className="dashboard-queue-status">{item.status}</b>{item.meta}</span>
                    </div>
                    <NavLink className="btn-sm" to={item.to}>{item.action}</NavLink>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-note">No priority actions right now.</p>
            )}
          </section>

          <Sidebar stats={stats} />
        </div>

        <section className="dashboard-published-card" aria-labelledby="published-communications-title">
          <div className="dashboard-published-header">
            <div>
              <span className="dashboard-eyebrow">Published communications</span>
              <h2 id="published-communications-title">Active Service Alerts</h2>
            </div>
            <span className="dashboard-published-actions">
              <NavLink className="btn-primary" to="/service-operations/compose">+ New announcement</NavLink>
              <NavLink className="btn-sm" to="/service-operations/active">Open full list →</NavLink>
            </span>
          </div>
          <MessagesTable compact onChanged={refreshAll} onLoaded={setActiveMessages} />
        </section>
      </div>
    </div>
  );
}

function DashboardMetric({ label, value, tone = "" }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className={`dashboard-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>Current status</small>
    </div>
  );
}

type TriageItem = { id: string; title: string; meta: string; status: string; action: string; to: string; tone: "critical" | "attention" | "info" };

function buildTriageItems(activeMessages: ActiveMessage[] | null, pending: SuggestedAlert[] | null, now = Date.now()): TriageItem[] {
  const items: Array<TriageItem & { priority: number }> = [];
  const cutoff = now + 60 * 60 * 1000;

  for (const message of activeMessages ?? []) {
    const expiresAt = new Date(message.expires_at).getTime();
    if (expiresAt <= cutoff) {
      items.push({
        id: `message-${message.message_id}`,
        title: message.summary,
        meta: ` · ${message.routes_affected?.join(", ") || "All routes"} · ${message.channels?.join(", ") || "All channels"}`,
        status: expiresAt <= now ? "Expired" : "Expires soon",
        action: "Review alert",
        to: "/service-operations/active",
        tone: expiresAt <= now ? "critical" : "attention",
        priority: Math.max(0, expiresAt - now),
      });
    }
  }

  for (const alert of pending ?? []) {
    items.push({
      id: `suggested-${alert.alert_id}`,
      title: alert.draft_text,
      meta: ` · ${alert.routes_affected?.join(", ") || alert.zones_affected?.join(", ") || "Service risk"} · ${alert.source === "gtfs_rt" ? "Fixed-route feed" : alert.source === "zona" ? "On-demand feed" : "Missed-trip feed"}`,
      status: "Suggested alert",
      action: "Review candidate",
      to: "/service-operations/suggested",
      tone: "info",
      priority: 1_000_000 + ({ critical: 0, major: 10_000, minor: 20_000, informational: 30_000 }[alert.severity] ?? 40_000),
    });
  }

  return items.sort((a, b) => a.priority - b.priority).slice(0, 5);
}
