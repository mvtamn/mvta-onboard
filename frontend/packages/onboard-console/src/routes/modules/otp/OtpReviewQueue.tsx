import { useEffect, useMemo, useRef, useState } from "react";
import { type FlaggedStop, type OtpAuditEntry, type ReasonCode, type OtpStopExclusion } from "@mvta/shared";
import { api } from "../../../config.js";
import { type StopExclusionStatus } from "./otpData.js";
import { type QueueRow } from "./otpFigures.js";
import { auditLines } from "./otpAuditEntries.js";
import { formatServiceMonth } from "./otpServiceMonth.js";
import { useAppDialog } from "../../../components/AppDialog.js";
import {
  decidedSummary,
  matchesFilter,
  previousSummary,
  queueGroups,
  type QueueDay,
  type QueueFilter,
  type QueueGroup,
} from "./otpQueueGroups.js";

interface Mix { earlyPct: number; ontimePct: number; latePct: number; missedPct: number }

function AdherenceStrip({ mix, compact = false }: { mix: Mix; compact?: boolean }) {
  const other = Math.max(0, 100 - mix.earlyPct - mix.ontimePct - mix.latePct - mix.missedPct);
  const segs = [
    { cls: "early", v: mix.earlyPct },
    { cls: "ontime", v: mix.ontimePct },
    { cls: "late", v: mix.latePct },
    { cls: "missed", v: mix.missedPct + other },
  ];
  return (
    <div className={`adherence-strip${compact ? " compact" : ""}`} aria-hidden="true">
      {segs.map((s, i) => <div key={i} className={`seg ${s.cls}`} style={{ width: `${s.v}%` }} />)}
    </div>
  );
}

const statusWord = (status: StopExclusionStatus) =>
  status === "approved" ? "excluded" : status === "rejected" ? "kept" : "pending";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The share that put the day in the queue: early or late, whichever leans further. */
const leanText = (r: QueueRow) => r.earlyPct > r.latePct ? `${Math.round(r.earlyPct)}% early` : `${Math.round(r.latePct)}% late`;

function dayDescription(day: QueueDay): string {
  const r = day.row;
  return `${day.dayName}, ${statusWord(day.status)}, ${plural(r.sampled, "departure")}, ${leanText(r)}`;
}

function dayTooltip(day: QueueDay, reasonLabel: (code: string) => string): string {
  const r = day.row;
  const parts = [
    day.dayName,
    plural(r.sampled, "departure"),
    `${r.earlyPct}% early · ${r.ontimePct}% on time · ${r.latePct}% late`,
  ];
  if (day.previous) {
    parts.push(
      `Last month: ${day.previous.status === "approved" ? "excluded" : "kept"}` +
      (day.previous.reason_code ? ` — ${reasonLabel(day.previous.reason_code)}` : ""),
    );
  }
  return parts.join(" · ");
}

/** "Exclude 5 days", or the day's own name when only one is picked. */
function actionLabel(verb: string, days: readonly QueueDay[]): string {
  if (days.length === 1) return `${verb} ${days[0]!.dayLabel}`;
  return `${verb} ${plural(days.length, "day")}`;
}

export function ReviewQueuePage({
  flaggedStops,
  queueRows,
  statusOf,
  reasonOf,
  reasonCodes,
  onResolve,
  onReason,
  serviceMonth,
  auditRefreshTick,
  previousDecisionFor,
  onCopy,
  onCopyAll,
  copyingAll,
  decidedCount,
  onResetMonth,
  resetting,
}: {
  flaggedStops: FlaggedStop[];
  queueRows: QueueRow[];
  statusOf: (stop: FlaggedStop) => StopExclusionStatus;
  reasonOf: (stop: FlaggedStop) => string;
  reasonCodes: ReasonCode[];
  onResolve: (stops: readonly FlaggedStop[], action: "approve" | "reject") => void | Promise<boolean | void>;
  onReason: (stop: FlaggedStop, reason: string) => void;
  serviceMonth: string | null;
  auditRefreshTick: number;
  previousDecisionFor: (stop: FlaggedStop) => OtpStopExclusion | undefined;
  onCopy: (stops: readonly FlaggedStop[]) => void | Promise<void>;
  onCopyAll: () => void;
  copyingAll: boolean;
  decidedCount: number;
  onResetMonth: () => Promise<boolean>;
  resetting: boolean;
}) {
  const { confirm } = useAppDialog();
  const [routeFilter, setRouteFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<QueueFilter["status"]>("pending");
  const [search, setSearch] = useState("");

  // Which of a group's days the next decision covers. Absent means the
  // default: every day still pending, which is what a reviewer deciding a
  // stop wants nearly every time. A reviewer carving a day out, or reopening
  // a decided one, puts an explicit list here; a successful save clears it so
  // the group reads as decided rather than editable (the same rule the old
  // per-row "Change decision" followed).
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState<string | null>(null);

  // The queue is worked top to bottom. Under the default filter a decided
  // group leaves the list, so the group that was below it slides into its
  // place; focus goes there, and the reviewer's hands stay where they were.
  const listRef = useRef<HTMLDivElement>(null);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  useEffect(() => {
    if (focusIndex === null) return;
    const cards = listRef.current?.querySelectorAll<HTMLElement>(".otp-group") ?? [];
    const card = cards[Math.min(focusIndex, cards.length - 1)];
    (card?.querySelector<HTMLElement>(".otp-group-primary") ?? card)?.focus();
    setFocusIndex(null);
  }, [focusIndex]);

  const groups = useMemo(
    () => queueGroups(flaggedStops, queueRows, statusOf, previousDecisionFor),
    [flaggedStops, queueRows, statusOf, previousDecisionFor],
  );
  const routes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of groups) counts.set(g.routeLabel, (counts.get(g.routeLabel) ?? 0) + 1);
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  }, [groups]);

  const totalDays = queueRows.length;
  const pendingDays = groups.reduce((n, g) => n + g.pending, 0);
  const pendingGroups = groups.filter((g) => g.pending > 0).length;
  const filter: QueueFilter = { route: routeFilter, status: statusFilter, search };
  const visible = groups.filter((g) => matchesFilter(g, filter));
  const filtered = Boolean(routeFilter || search || statusFilter !== "pending");

  const [timeline, setTimeline] = useState<OtpAuditEntry[]>([]);
  const timelineLines = useMemo(() => auditLines(timeline, reasonCodes), [timeline, reasonCodes]);
  useEffect(() => {
    api
      .getOtpAuditStream(serviceMonth ?? undefined, 6)
      .then((d) => setTimeline(d.entries))
      .catch(() => setTimeline([]));
  }, [serviceMonth, auditRefreshTick]);

  // Deleting is the point - a reset month reads as never reviewed - so the
  // reviewer is told exactly what goes, including the month's review history,
  // which is derived from the same rows.
  async function resetMonth() {
    if (!serviceMonth) return;
    const month = formatServiceMonth(serviceMonth);
    const decisions = `${decidedCount} stop exclusion decision${decidedCount === 1 ? "" : "s"}`;
    const ok = await confirm({
      title: `Reset ${month} decisions?`,
      description:
        `This deletes all ${decisions} for ${month} and their review history. Every flagged stop goes back to pending. ` +
        "Weather days and finalized assessments are not affected.",
      confirmLabel: `Reset ${decisions}`,
      danger: true,
    });
    if (!ok) return;
    const reset = await onResetMonth();
    if (reset) setSelected({});
  }

  const reasonLabel = (code: string) => reasonCodes.find((r) => r.code === code)?.label ?? code;

  const copyableCount = flaggedStops.filter(
    (stop) => statusOf(stop) === "pending" && previousDecisionFor(stop),
  ).length;

  const selectedDays = (group: QueueGroup): QueueDay[] => {
    const keys = selected[group.key];
    if (!keys) return group.days.filter((d) => d.status === "pending");
    return group.days.filter((d) => keys.includes(d.row.key));
  };

  function toggleDay(group: QueueGroup, day: QueueDay) {
    const current = selectedDays(group).map((d) => d.row.key);
    const next = current.includes(day.row.key) ? current.filter((k) => k !== day.row.key) : [...current, day.row.key];
    setSelected((s) => ({ ...s, [group.key]: next }));
  }

  function clearSelection(groupKey: string) {
    setSelected((s) => {
      const { [groupKey]: _, ...rest } = s;
      return rest;
    });
  }

  async function decide(group: QueueGroup, action: "approve" | "reject", index: number) {
    const days = selectedDays(group);
    if (days.length === 0) return;
    setSaving(group.key);
    try {
      const saved = await onResolve(days.map((d) => d.stop), action);
      // A failed write leaves the controls where the reviewer can try again,
      // rather than closing the group back to a status that did not change.
      if (saved === false) return;
      clearSelection(group.key);
      setFocusIndex(index);
    } finally {
      setSaving(null);
    }
  }

  async function copyGroup(group: QueueGroup, index: number) {
    const days = selectedDays(group).filter((d) => d.previous);
    if (days.length === 0) return;
    setSaving(group.key);
    try {
      await onCopy(days.map((d) => d.stop));
      clearSelection(group.key);
      setFocusIndex(index);
    } finally {
      setSaving(null);
    }
  }

  function setGroupReason(group: QueueGroup, reason: string) {
    for (const day of selectedDays(group)) onReason(day.stop, reason);
  }

  return (
    <div className="otp-two">
      <div className="subcard otp-queue">
        <div className="otp-queue-toolbar">
          {totalDays > 0 ? (
            <div className="otp-queue-progress" aria-live="polite">
              <div className="otp-queue-counts">
                {pendingDays === 0 ? (
                  <b>Every flagged stop is decided.</b>
                ) : (
                  <>
                    <b>{plural(pendingGroups, "stop")} to review</b>
                    <span className="muted"> · {pendingDays} of {totalDays} stop-days pending</span>
                  </>
                )}
                <span className="muted otp-queue-counts-right">
                  {plural(groups.length, "stop")} · {totalDays} stop-days flagged
                </span>
              </div>
              <div className="otp-progress-track">
                <div className="otp-progress-fill" style={{ width: `${((totalDays - pendingDays) / totalDays) * 100}%` }} />
              </div>
            </div>
          ) : null}
          <div className="otp-queue-filters">
            <select value={routeFilter} onChange={(e) => setRouteFilter(e.target.value)} aria-label="Route">
              <option value="">All routes</option>
              {routes.map(([r, n]) => <option key={r} value={r}>Route {r} ({n})</option>)}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as QueueFilter["status"])} aria-label="Status">
              <option value="pending">Pending review ({pendingGroups})</option>
              <option value="all">All flagged stops ({groups.length})</option>
              <option value="resolved">Decided ({groups.length - pendingGroups})</option>
            </select>
            <input
              type="search"
              placeholder="Search stop name or number…"
              aria-label="Search stops"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {serviceMonth && decidedCount > 0 ? (
              <button className="btn-sm danger" style={{ marginLeft: "auto" }} disabled={resetting} onClick={() => void resetMonth()}>
                {resetting ? "Resetting…" : `Reset ${formatServiceMonth(serviceMonth)} decisions`}
              </button>
            ) : null}
          </div>
        </div>

        {copyableCount > 0 ? (
          <div className="subcard otp-copy-banner">
            <span>
              {copyableCount} pending stop-day{copyableCount === 1 ? "" : "s"} matched last month's decision.
            </span>
            <button className="btn-post" disabled={copyingAll} onClick={onCopyAll}>
              {copyingAll ? "Copying…" : `Copy all ${copyableCount} matching last month's decisions`}
            </button>
          </div>
        ) : null}

        {groups.length === 0 ? (
          <div className="subcard empty-note" style={{ textAlign: "center", padding: "30px 20px" }}>
            {serviceMonth
              ? "No stops show an early/late-bias pattern above the review threshold this month."
              : "The Avail OTP Monthly feed has no rows for this month yet, so there is nothing to review."}
          </div>
        ) : visible.length === 0 ? (
          <div className="subcard empty-note otp-queue-empty">
            <span>
              {filtered
                ? "No flagged stops match these filters."
                : "Every flagged stop this month is decided. Switch the filter to see the decisions."}
            </span>
            {filtered ? (
              <button className="btn-sm" onClick={() => { setRouteFilter(""); setSearch(""); setStatusFilter("pending"); }}>
                Clear filters
              </button>
            ) : (
              <button className="btn-sm" onClick={() => setStatusFilter("all")}>Show all flagged stops</button>
            )}
          </div>
        ) : null}

        <div className="otp-group-list" ref={listRef}>
          {visible.map((group, index) => {
            const days = selectedDays(group);
            const selectedKeys = new Set(days.map((d) => d.row.key));
            const reopening = days.some((d) => d.status !== "pending");
            const busy = saving === group.key;
            const copyable = days.filter((d) => d.previous).length;
            const lastMonth = previousSummary(group.days, reasonLabel);
            const reasonStop = days[0]?.stop;

            return (
              <article
                className={`otp-group${group.pending > 0 ? " highlight" : ""}`}
                key={group.key}
                tabIndex={-1}
                aria-label={`${group.stopName}, route ${group.routeLabel}`}
              >
                <div className="otp-group-head">
                  <div className="otp-group-title">
                    <span className="route-chip">RT {group.routeLabel}</span>
                    <span className="otp-group-name">{group.stopName}</span>
                  </div>
                  <div className="otp-group-meta">
                    Stop {group.stopId} · {group.biasLabel} · {plural(group.days.length, "day")} · {plural(group.sampled, "departure")}
                    {group.otherRoutes.length > 0 ? ` · also flagged on RT ${group.otherRoutes.join(", RT ")}` : ""}
                  </div>
                  <AdherenceStrip mix={group} />
                </div>

                <div className="otp-days" role="group" aria-label={`Days flagged at ${group.stopName}`}>
                  {group.days.map((day) => (
                    <button
                      type="button"
                      key={day.row.key}
                      className={`otp-day ${day.status}${selectedKeys.has(day.row.key) ? " selected" : ""}`}
                      aria-pressed={selectedKeys.has(day.row.key)}
                      aria-label={dayDescription(day)}
                      title={dayTooltip(day, reasonLabel)}
                      disabled={busy}
                      onClick={() => toggleDay(group, day)}
                    >
                      <span className="otp-day-name">{day.dayLabel}</span>
                      <AdherenceStrip mix={day.row} compact />
                      <span className={`otp-day-status ${day.status}`}>
                        {day.status === "approved" ? "\u2713 excluded" : day.status === "rejected" ? "\u2715 kept" : leanText(day.row)}
                      </span>
                    </button>
                  ))}
                </div>

                <div className="otp-group-actions">
                  {days.length > 0 && reasonStop ? (
                    <>
                      <select
                        value={reasonOf(reasonStop)}
                        onChange={(e) => setGroupReason(group, e.target.value)}
                        aria-label={`Reason for ${group.stopName}`}
                        disabled={busy}
                      >
                        {reasonCodes.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                      </select>
                      <button
                        className="btn-post otp-group-primary"
                        disabled={busy}
                        onClick={() => void decide(group, "approve", index)}
                      >
                        {busy ? "Saving…" : actionLabel("Exclude", days)}
                      </button>
                      <button className="btn-sm" disabled={busy} onClick={() => void decide(group, "reject", index)}>
                        {actionLabel("Keep", days)}
                      </button>
                      {copyable > 0 ? (
                        <button className="btn-sm" disabled={busy} onClick={() => void copyGroup(group, index)}>
                          Copy last month
                        </button>
                      ) : null}
                      {reopening ? (
                        <button className="btn-sm" disabled={busy} onClick={() => clearSelection(group.key)}>Cancel</button>
                      ) : null}
                    </>
                  ) : group.pending === 0 ? (
                    <>
                      <span className={group.approved > 0 ? "ok-text" : "muted"}>
                        {decidedSummary(group, reasonOf, reasonLabel)}
                      </span>
                      <button
                        className="btn-sm"
                        onClick={() => setSelected((s) => ({ ...s, [group.key]: group.days.map((d) => d.row.key) }))}
                        aria-label={`Change the decision for ${group.stopName}`}
                      >
                        Change decision
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="muted">Pick the days to decide.</span>
                      <button className="btn-sm" onClick={() => clearSelection(group.key)}>Select pending days</button>
                    </>
                  )}
                  {lastMonth ? <span className="muted otp-group-last">{lastMonth}</span> : null}
                </div>
              </article>
            );
          })}
        </div>
      </div>

      <aside className="subcard otp-timeline">
        <h2>Review Timeline</h2>
        {timelineLines.length === 0 ? <p className="muted">No review activity yet.</p> : null}
        {timelineLines.map((t, i) => (
          <div className="timeline-item" key={i}>
            <div className="t-title">{t.title}</div>
            <div className="t-desc">{t.detail}</div>
          </div>
        ))}
      </aside>
    </div>
  );
}
