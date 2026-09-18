import { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import type { ActiveMessage, DetourIntake, Severity, SuggestedAlert } from "@mvta/shared";
import { MessagesTable } from "../components/MessagesTable.js";
import { Sidebar } from "../components/Sidebar.js";
import { LiveSignal, signalStateFor } from "../components/LiveSignal.js";
import { dataStateLabel, type LiveStats, type OperationalDataState } from "../hooks/useLiveStats.js";
import { useFeedFreshness } from "../hooks/useFeedFreshness.js";
import { usePendingIntake } from "../hooks/usePendingIntake.js";
import { pendingIntakes, waitingHours, waitingLabel } from "../lib/intakeQueue.js";

// Dashboard: triage-first metrics and next actions, followed by published
// communications. Compose remains available from its dedicated route. `stats` comes from App.tsx's single useLiveStats()
// instance (also drives the nav footer), which says whether the console's own API
// answers. Whether the feeds behind it are fresh is a different question, read
// here from the feed-health ledger - the freshness bar and the "Feed state"
// metric used to answer it with the API's state alone.
export function Dashboard({ stats, onChanged }: { stats: LiveStats; onChanged?: () => void }) {
  const [activeMessages, setActiveMessages] = useState<ActiveMessage[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const feedHealth = useFeedFreshness();
  const knownActiveMessages = activeMessages ?? stats.activeMessages ?? null;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  function refreshAll() {
    stats.refresh();
    feedHealth.refresh();
    onChanged?.();
  }

  // The console's API comes first: if it is not answering, nothing on the page
  // is current, feeds included. Once it answers, the bar reports the feeds.
  const apiLive = stats.overallState === "live";
  const barState: OperationalDataState = apiLive ? feedHealth.summary.state : stats.overallState;
  const barLabel = apiLive ? feedHealth.summary.label : dataStateLabel(stats.overallState);

  const expiringSoon = useMemo(() => {
    if (!knownActiveMessages) return null;
    const cutoff = now + 60 * 60 * 1000;
    return knownActiveMessages.filter((message) => new Date(message.expires_at).getTime() <= cutoff).length;
  }, [knownActiveMessages, now]);

  const { intake } = usePendingIntake();
  const triageItems = useMemo(
    () => buildTriageItems(knownActiveMessages, stats.pending, stats.activeState, stats.pendingState, now, intake),
    [knownActiveMessages, stats.pending, stats.activeState, stats.pendingState, now, intake],
  );
  const shownItems = triageItems.slice(0, TRIAGE_SHOWN);

  return (
    <div className="content-layout">
      <div className="content-primary">
        <div className={`dashboard-freshness ${barState}`} role="status">
          <LiveSignal state={signalStateFor(barState)} />
          <strong>{barLabel}</strong>
          <span>{stats.syncedAt ? `Updated ${stats.syncedAt.toLocaleTimeString()}` : "Retrying connection"}</span>
          <NavLink to="/service-operations/suggested">{stats.pending?.length ?? "—"} suggested alerts</NavLink>
        </div>

        <div className="dashboard-metrics" aria-label="Dashboard summary">
          <DashboardMetric label="Active rider alerts" value={knownActiveMessages?.length ?? stats.activeCount ?? "—"} />
          <DashboardMetric label="Suggested alerts" value={stats.pending?.length ?? "—"} tone="attention" />
          <DashboardMetric label="Expiring within 1 hour" value={expiringSoon ?? "—"} tone="attention" />
          <DashboardMetric label="Feed state" value={barLabel} tone={barState === "live" ? "healthy" : "attention"} />
        </div>

        <div className="dashboard-triage-grid">
          <section className="dashboard-queue" aria-labelledby="dashboard-queue-title">
            <div className="dashboard-section-heading">
              <div>
                <span className="dashboard-eyebrow">Priority queue</span>
                <h2 id="dashboard-queue-title">Triage exceptions</h2>
              </div>
              <NavLink className="btn-sm" to="/service-operations/suggested">Open Suggested Alerts</NavLink>
            </div>
            {shownItems.length > 0 ? (
              <>
                <div className="dashboard-queue-list">
                  {shownItems.map((item) => (
                    <div className="dashboard-queue-row" key={item.id}>
                      <span className={`dashboard-queue-signal ${item.tone}`} aria-hidden="true" />
                      <div className="dashboard-queue-text">
                        {/* The clamp is a backstop: triageTitle() has already cut the
                            source text to something that fits two lines, and the full
                            text stays one click away on `item.to`. */}
                        <p className="dashboard-queue-title" title={item.fullTitle}>{item.title}</p>
                        <p className="dashboard-queue-meta">
                          <span className={`dashboard-queue-kind ${item.kind}`}>{item.kindLabel}</span>
                          <span className="dashboard-queue-facts">{item.meta.join(" · ")}</span>
                        </p>
                      </div>
                      <div className="dashboard-queue-rail">
                        <span className={`dashboard-queue-status ${item.statusTone}`}>{item.status}</span>
                        <NavLink
                          className="dashboard-queue-action"
                          to={item.to}
                          aria-label={`${item.action}: ${item.title}`}
                        >
                          {item.action} <span aria-hidden="true">→</span>
                        </NavLink>
                      </div>
                    </div>
                  ))}
                </div>
                {triageItems.length > shownItems.length ? (
                  <div className="dashboard-queue-footer">
                    <span>Showing the {shownItems.length} most urgent of {triageItems.length} exceptions</span>
                    <NavLink to="/service-operations/suggested">See all →</NavLink>
                  </div>
                ) : null}
              </>
            ) : (
              // An empty queue is the normal state on a good afternoon, so it says
              // what was checked and when rather than only that nothing was found.
              <div className="dashboard-queue-empty">
                <strong>Nothing needs triage</strong>
                <span>
                  {emptyQueueDetail(knownActiveMessages?.length ?? stats.activeCount, stats.pending?.length ?? 0)}
                  {stats.syncedAt ? ` Checked ${stats.syncedAt.toLocaleTimeString()}.` : ""}
                </span>
              </div>
            )}
          </section>

          <Sidebar
            stats={stats}
            feeds={feedHealth.feeds}
            summary={feedHealth.summary}
            checkedAt={feedHealth.checkedAt}
            onRefresh={refreshAll}
          />
        </div>

        <section className="dashboard-published-card" aria-labelledby="published-communications-title">
          <div className="dashboard-published-header">
            <div>
              <span className="dashboard-eyebrow">Published communications</span>
              <h2 id="published-communications-title">Active Service Alerts</h2>
            </div>
            <span className="dashboard-published-actions">
              <NavLink className="btn-primary" to="/service-operations/compose">+ New announcement</NavLink>
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

export const TRIAGE_SHOWN = 5;

type TriageKind = "alert" | "suggested" | "feed" | "intake";

type TriageItem = {
  id: string;
  kind: TriageKind;
  kindLabel: string;
  /** Cut to fit two lines; `fullTitle` keeps the source text for the tooltip. */
  title: string;
  fullTitle: string;
  meta: string[];
  status: string;
  statusTone: "" | "critical" | "attention";
  action: string;
  to: string;
  tone: "critical" | "attention" | "info";
};

/**
 * Where a row sits in the queue.
 *
 * Two fields, compared in order, rather than one blended number: a queue that
 * mixes kinds cannot rank them on a single scalar without inventing a rate of
 * exchange between minutes and severity. The previous version scored expiring
 * alerts in milliseconds-remaining and suggested alerts with constants around
 * 1,000,000, so any alert more than 16m40s from expiry sorted below every
 * suggestion in the queue - a conversion nobody chose, it fell out of the units.
 */
type TriageRank = { tier: number; a: number; b: number };

const TIER_FEED_DOWN = 0;
const TIER_EXPIRED = 1;
const TIER_EXPIRING = 2;
const TIER_SUGGESTED_HIGH = 3;
// A detour request nobody has answered. Below a live alert, above a low
// suggestion: somebody outside OCC is waiting on it, and until this queue
// carried them the only way to find one was to open the Intake page.
const TIER_INTAKE = 4;
const TIER_FEED_STALE = 5;
const TIER_SUGGESTED_LOW = 6;

// Most urgent first, which is the opposite of the SEVERITIES array's order.
const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, major: 1, minor: 2, informational: 3 };

function buildTriageItems(
  activeMessages: ActiveMessage[] | null,
  pending: SuggestedAlert[] | null,
  activeState: OperationalDataState,
  pendingState: OperationalDataState,
  now = Date.now(),
  intake: DetourIntake[] | null = null,
): TriageItem[] {
  const items: Array<TriageItem & { rank: TriageRank }> = [];
  const cutoff = now + 60 * 60 * 1000;

  for (const message of activeMessages ?? []) {
    const expiresAt = new Date(message.expires_at).getTime();
    if (expiresAt > cutoff) continue;
    const expired = expiresAt <= now;
    items.push({
      id: `message-${message.message_id}`,
      kind: "alert",
      kindLabel: "Rider alert",
      title: triageTitle(message.summary),
      fullTitle: message.summary,
      meta: [
        message.routes_affected?.join(", ") || "All routes",
        capitalize(message.severity),
        message.channels?.map(capitalize).join(", ") || "All channels",
      ],
      status: expired ? `Expired ${formatMinutes(now - expiresAt)} ago` : `Expires in ${formatMinutes(expiresAt - now)}`,
      statusTone: expired ? "critical" : "attention",
      // "Expired" used to sit in the action column styled as a link, so the row
      // offered a status where it looked like it offered a verb.
      action: expired ? "Renew or retire" : "Extend",
      to: "/service-operations/active",
      tone: expired ? "critical" : "attention",
      // Oldest expiry first within either tier.
      rank: { tier: expired ? TIER_EXPIRED : TIER_EXPIRING, a: expiresAt, b: 0 },
    });
  }

  for (const alert of pending ?? []) {
    const severityOrder = SEVERITY_ORDER[alert.severity] ?? SEVERITY_ORDER.informational;
    const high = severityOrder <= SEVERITY_ORDER.major;
    const raisedAt = new Date(alert.created_at).getTime();
    items.push({
      id: `suggested-${alert.alert_id}`,
      kind: "suggested",
      kindLabel: "Suggested",
      title: triageTitle(alert.draft_text),
      fullTitle: alert.draft_text,
      meta: [
        alert.routes_affected?.join(", ") || alert.zones_affected?.join(", ") || "Service risk",
        capitalize(alert.severity),
        categoryLabel(alert.category),
      ],
      status: Number.isFinite(raisedAt) ? `Raised ${formatMinutes(Math.max(0, now - raisedAt))} ago` : "Awaiting review",
      statusTone: "",
      action: "Investigate",
      to: "/service-operations/suggested",
      // A critical suggestion used to render in the same calm blue as an
      // informational one; the alert's own severity reaches the signal bar now.
      tone: severityOrder <= SEVERITY_ORDER.critical ? "critical" : high ? "attention" : "info",
      rank: {
        tier: high ? TIER_SUGGESTED_HIGH : TIER_SUGGESTED_LOW,
        a: severityOrder,
        b: Number.isFinite(raisedAt) ? raisedAt : Number.MAX_SAFE_INTEGER,
      },
    });
  }

  const feeds: Array<{ id: string; name: string; state: OperationalDataState; to: string; order: number }> = [
    { id: "active-data-state", name: "Active Service Alerts", state: activeState, to: "/service-operations/active", order: 0 },
    { id: "suggested-data-state", name: "Suggested Alerts", state: pendingState, to: "/service-operations/suggested", order: 1 },
  ];
  for (const feed of feeds) {
    if (feed.state === "live" || feed.state === "loading") continue;
    const stale = feed.state === "stale";
    const title = stale ? `${feed.name} may be out of date` : `${feed.name} is not answering`;
    items.push({
      id: feed.id,
      kind: "feed",
      kindLabel: "Feed",
      title,
      fullTitle: title,
      meta: ["Console API", dataStateLabel(feed.state)],
      status: stale ? "Showing last known" : "Counts unavailable",
      statusTone: stale ? "attention" : "critical",
      action: "Review feed",
      to: feed.to,
      tone: stale ? "attention" : "critical",
      // A feed that is not answering outranks everything: nothing below it in
      // the queue can be trusted to be complete.
      rank: { tier: stale ? TIER_FEED_STALE : TIER_FEED_DOWN, a: feed.order, b: 0 },
    });
  }

  // Detour requests waiting on OCC. Oldest first: the queue's job is to stop
  // one sitting unanswered, so the wait is the thing that ranks them.
  for (const request of pendingIntakes(intake)) {
    const hours = waitingHours(request, now);
    const title = request.description || "Detour request";
    items.push({
      id: `intake-${request.id}`,
      kind: "intake",
      kindLabel: "Detour request",
      title: triageTitle(title),
      fullTitle: title,
      meta: [request.created_by || "Unknown requester", request.location || "No location given"],
      status: waitingLabel(hours),
      statusTone: hours >= 24 ? "attention" : "",
      action: "Review request",
      to: "/detour-intake",
      tone: hours >= 24 ? "attention" : "info",
      rank: { tier: TIER_INTAKE, a: -hours, b: 0 },
    });
  }

  return items.sort((x, y) => x.rank.tier - y.rank.tier || x.rank.a - y.rank.a || x.rank.b - y.rank.b);
}

/** Roughly two lines of the queue's title column at 13.5px. */
const TITLE_BUDGET = 150;

/**
 * A queue title short enough to read in a glance.
 *
 * Suggested alerts carry `draft_text`, which for the On-Demand wait-risk drafts
 * is ~220 characters opening with a fixed stem - rendered on one truncated line
 * every such row read identically, with the zone and the wait time both past the
 * cut. Only text that genuinely overruns is shortened, and the first sentence is
 * preferred over a hard cut because it is where the distinguishing facts are.
 */
export function triageTitle(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= TITLE_BUDGET) return trimmed;
  // Only trusted on long text, so a mid-sentence "Ave." cannot swallow the row.
  const sentence = /^.*?[.!?](?=\s)/.exec(trimmed)?.[0]?.trim();
  if (sentence && sentence.length >= 40 && sentence.length <= TITLE_BUDGET) return sentence;
  return `${trimmed.slice(0, TITLE_BUDGET - 1).trimEnd()}…`;
}

function emptyQueueDetail(activeCount: number | null, pendingCount: number) {
  const alerts = activeCount === null ? "Rider alerts" : `${activeCount} rider alert${activeCount === 1 ? "" : "s"}`;
  const live = activeCount === null ? "are live" : activeCount === 1 ? "is live" : "are live";
  const suggested = pendingCount === 0
    ? "no suggested alerts are waiting"
    : `${pendingCount} suggested alert${pendingCount === 1 ? "" : "s"} ${pendingCount === 1 ? "is" : "are"} waiting`;
  return `${alerts} ${live} and ${suggested}.`;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function categoryLabel(category: string) {
  return capitalize(category.replace(/_/g, " "));
}

function formatMinutes(milliseconds: number) {
  const minutes = Math.max(1, Math.ceil(milliseconds / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}
