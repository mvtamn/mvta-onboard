import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  type SuggestedAlert,
  CATEGORY_LABELS,
  SEVERITY_LABELS,
  timeAgo,
  ApiError,
} from "@mvta/shared";
import { useAuth } from "../auth/AuthContext.js";
import { api } from "../config.js";

const SOURCE_PILL: Record<string, string> = {
  gtfs_rt: "pill-warning",
  zona: "pill-success",
  missed_trip: "pill-danger",
};
const SOURCE_LABEL: Record<string, string> = {
  gtfs_rt: "GTFS-RT",
  zona: "MVTA Connect",
  missed_trip: "Missed Trip",
};

// Suggested Alerts - the human-review queue (HANDOFF §2.3). Detection feeds
// (GTFS-Realtime, MVTA Connect, missed-trip detection) insert pending rows
// here; staff approve (which publishes through the normal Messages pipeline)
// or dismiss. Nothing auto-publishes. Rows also auto-expire to 'expired'
// after 2 hours unreviewed (suggestedAlertsExpire.ts) - the status pill below
// already renders any status it doesn't special-case as muted, so that shows
// correctly with no changes here.
export function SuggestedAlerts({ onChanged }: { onChanged?: () => void }) {
  const { roles } = useAuth();
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get("focus");
  const focusRow = useRef<HTMLTableRowElement | null>(null);
  const canReview = roles.some((r) => r === "OCC.Publisher" || r === "OCC.Admin");

  const [alerts, setAlerts] = useState<SuggestedAlert[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .getSuggestedAlerts(focusId ? "all" : "pending")
      .then((d) => {
        setAlerts(d.alerts);
        setError(null);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load suggested alerts."));
  }, [focusId]);

  useEffect(load, [load]);
  useEffect(() => {
    if (alerts && focusId && focusRow.current) {
      focusRow.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [alerts, focusId]);

  async function act(id: string, action: "approve" | "dismiss") {
    setBusy(id);
    setError(null);
    try {
      if (action === "approve") {
        await api.approveSuggestedAlert(id);
      } else {
        await api.dismissSuggestedAlert(id);
      }
      load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="panel-header">Suggested Alerts</div>
      <div className="panel-body">
        <p className="panel-desc">
          Delay and wait-time candidates detected from GTFS-Realtime and MVTA Connect (On-Demand).
          Nothing publishes without your review — Approve posts through the normal Messages
          pipeline; Dismiss discards the suggestion.
        </p>
        {focusId ? (
          <p className="review-focus-note">
            Draft prepared from OCC service risk. Review the customer wording before approving it.
          </p>
        ) : null}
        {error ? <p className="error-text">{error}</p> : null}
        {alerts === null ? (
          <p className="muted">Loading… (requires staff sign-in)</p>
        ) : alerts.length === 0 ? (
          <p className="empty-note">
            No pending suggestions right now. GTFS-Realtime alert and delay detection are live —
            MVTA Connect (On-Demand) wait-time detection is not yet connected.
          </p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Source</th>
                <th>Draft</th>
                <th>Category</th>
                <th>Severity</th>
                <th>Status</th>
                <th>Detected</th>
                {canReview ? <th>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr
                  key={a.alert_id}
                  ref={a.alert_id === focusId ? focusRow : undefined}
                  className={a.alert_id === focusId ? "review-focus-row" : undefined}
                >
                  <td>
                    <span className={`pill-sm ${SOURCE_PILL[a.source] ?? "pill-muted"}`}>
                      {SOURCE_LABEL[a.source] ?? a.source}
                    </span>
                  </td>
                  <td>{a.draft_text}</td>
                  <td className="td-dim">{CATEGORY_LABELS[a.category] ?? a.category}</td>
                  <td className="td-dim">{SEVERITY_LABELS[a.severity] ?? a.severity}</td>
                  <td>
                    <span className={`pill-sm ${a.status === "pending" ? "pill-warning" : a.status === "approved" ? "pill-success" : "pill-muted"}`}>
                      {a.status}
                    </span>
                  </td>
                  <td className="td-dim">{timeAgo(a.created_at)}</td>
                  {canReview ? (
                    <td>
                      {a.status === "pending" ? (
                        <>
                          <button className="btn-sm" disabled={busy === a.alert_id} onClick={() => act(a.alert_id, "approve")}>
                            Approve &amp; publish
                          </button>
                          <button className="btn-sm danger" disabled={busy === a.alert_id} onClick={() => act(a.alert_id, "dismiss")}>
                            Dismiss
                          </button>
                        </>
                      ) : (
                        <span className="td-dim">Review complete</span>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
