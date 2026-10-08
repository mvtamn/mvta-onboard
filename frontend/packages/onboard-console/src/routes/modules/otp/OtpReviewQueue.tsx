import { useEffect, useMemo, useState } from "react";
import { type FlaggedStop, type OtpAuditEntry, type ReasonCode, type OtpStopExclusion } from "@mvta/shared";
import { api } from "../../../config.js";
import { type StopExclusionStatus } from "./otpData.js";
import { type QueueRow } from "./otpFigures.js";
import { auditLines } from "./otpAuditEntries.js";

function AdherenceStrip({ row }: { row: QueueRow }) {
  const other = Math.max(0, 100 - row.earlyPct - row.ontimePct - row.latePct - row.missedPct);
  const segs = [
    { cls: "early", v: row.earlyPct },
    { cls: "ontime", v: row.ontimePct },
    { cls: "late", v: row.latePct },
    { cls: "missed", v: row.missedPct + other },
  ];
  return (
    <div className="adherence-strip">
      {segs.map((s, i) => <div key={i} className={`seg ${s.cls}`} style={{ width: `${s.v}%` }} />)}
    </div>
  );
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
}: {
  flaggedStops: FlaggedStop[];
  queueRows: QueueRow[];
  statusOf: (stop: FlaggedStop) => StopExclusionStatus;
  reasonOf: (stop: FlaggedStop) => string;
  reasonCodes: ReasonCode[];
  onResolve: (stop: FlaggedStop, action: "approve" | "reject") => void;
  onReason: (stop: FlaggedStop, reason: string) => void;
  serviceMonth: string | null;
  auditRefreshTick: number;
  previousDecisionFor: (stop: FlaggedStop) => OtpStopExclusion | undefined;
  onCopy: (stop: FlaggedStop) => void;
  onCopyAll: () => void;
  copyingAll: boolean;
}) {
  const [routeFilter, setRouteFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [search, setSearch] = useState("");
  const routes = useMemo(() => [...new Set(queueRows.map((r) => r.routeLabel))].sort(), [queueRows]);

  const [timeline, setTimeline] = useState<OtpAuditEntry[]>([]);
  const timelineLines = useMemo(() => auditLines(timeline, reasonCodes), [timeline, reasonCodes]);
  useEffect(() => {
    api
      .getOtpAuditStream(serviceMonth ?? undefined, 6)
      .then((d) => setTimeline(d.entries))
      .catch(() => setTimeline([]));
  }, [serviceMonth, auditRefreshTick]);

  const reasonLabel = (code: string) => reasonCodes.find((r) => r.code === code)?.label ?? code;

  const copyableCount = flaggedStops.filter(
    (stop) => statusOf(stop) === "pending" && previousDecisionFor(stop),
  ).length;

  return (
    <div className="otp-two">
      <div className="subcard otp-queue">
        <div className="otp-queue-toolbar">
          <select value={routeFilter} onChange={(e) => setRouteFilter(e.target.value)}>
            <option value="">All routes</option>
            {routes.map((r) => <option key={r} value={r}>Route {r}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="pending">Pending review</option>
            <option value="all">All flagged stops</option>
            <option value="resolved">Resolved only</option>
          </select>
          <input placeholder="Search stop name…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        {copyableCount > 0 ? (
          <div className="subcard otp-copy-banner" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
            <span>
              {copyableCount} pending stop{copyableCount === 1 ? "" : "s"} matched last month's decision.
            </span>
            <button className="btn-post" disabled={copyingAll} onClick={onCopyAll}>
              {copyingAll ? "Copying…" : `Copy all ${copyableCount} matching last month's decisions`}
            </button>
          </div>
        ) : null}

        {queueRows.length === 0 ? (
          <div className="subcard empty-note" style={{ textAlign: "center", padding: "30px 20px" }}>
            {serviceMonth
              ? "No stops show an early/late-bias pattern above the review threshold this month."
              : "The Avail OTP Monthly feed has no rows for this month yet, so there is nothing to review."}
          </div>
        ) : null}

        {queueRows.map((row, i) => {
          const stop = flaggedStops[i]!;
          const status = statusOf(stop);
          const reason = reasonOf(stop);
          if (routeFilter && row.routeLabel !== routeFilter) return null;
          if (statusFilter === "pending" && status !== "pending") return null;
          if (statusFilter === "resolved" && status === "pending") return null;
          if (search && !row.stopName.toLowerCase().includes(search.toLowerCase())) return null;

          const iconClass = status === "approved" ? "ok" : status === "rejected" ? "rejected" : "warn";
          const iconGlyph = status === "approved" ? "\u2713" : status === "rejected" ? "\u2715" : "!";
          const prevDecision = status === "pending" ? previousDecisionFor(stop) : undefined;

          return (
            <div className={`check-row${status === "pending" ? " highlight" : ""}`} key={row.key}>
              <div className={`status-icon ${iconClass}`}>{iconGlyph}</div>
              <div className="check-body">
                <div className="check-title"><span className="route-chip">RT {row.routeLabel}</span>{row.stopName}</div>
                <div className="check-desc">Stop {row.stopId} · {row.dayOfWeek} · {row.sampled} departures sampled · {row.biasLabel}</div>
                <AdherenceStrip row={row} />
                {prevDecision ? (
                  <div className="muted" style={{ fontSize: "0.85em", marginTop: 4 }}>
                    Last month: {prevDecision.status === "approved" ? "Approved" : "Rejected"}
                    {prevDecision.reason_code ? ` \u2014 ${reasonLabel(prevDecision.reason_code)}` : ""}
                  </div>
                ) : null}
              </div>
              <div className="check-actions">
                {status === "pending" ? (
                  <>
                    <select value={reason} onChange={(e) => onReason(stop, e.target.value)}>
                      {reasonCodes.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                    </select>
                    <button className="btn-post" onClick={() => onResolve(stop, "approve")}>Approve</button>
                    <button className="btn-sm" onClick={() => onResolve(stop, "reject")}>Reject</button>
                    {prevDecision ? (
                      <button className="btn-sm" onClick={() => onCopy(stop)}>Copy last month</button>
                    ) : null}
                  </>
                ) : status === "approved" ? (
                  <span className="ok-text">Excluded — {reasonLabel(reason)}</span>
                ) : (
                  <span className="muted">Kept in OTP calc</span>
                )}
              </div>
            </div>
          );
        })}
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
