import { useCallback, useEffect, useState } from "react";
import {
  type SuggestedAlert,
  CATEGORY_LABELS,
  SEVERITY_LABELS,
  timeAgo,
  ApiError,
} from "@mvta/shared";
import { useAuth } from "../auth/AuthContext.js";
import { api } from "../config.js";

// Suggested Alerts - the human-review queue (HANDOFF §2.3). Detection feeds
// (GTFS-Realtime, Zona) insert pending rows in Phase 3; staff approve (which
// publishes through the normal Messages pipeline) or dismiss. Nothing
// auto-publishes.
export function SuggestedAlerts({ onChanged }: { onChanged?: () => void }) {
  const { roles } = useAuth();
  const canReview = roles.some((r) => r === "OCC.Publisher" || r === "OCC.Admin");

  const [alerts, setAlerts] = useState<SuggestedAlert[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .getSuggestedAlerts("pending")
      .then((d) => {
        setAlerts(d.alerts);
        setError(null);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load suggested alerts."));
  }, []);

  useEffect(load, [load]);

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
          Delay and wait-time candidates detected from GTFS-Realtime and Zona. Nothing publishes
          without your review — Approve posts through the normal Messages pipeline; Dismiss
          discards the suggestion.
        </p>
        {error ? <p className="error-text">{error}</p> : null}
        {alerts === null ? (
          <p className="muted">Loading… (requires staff sign-in)</p>
        ) : alerts.length === 0 ? (
          <p className="empty-note">
            No pending suggestions. Detection feeds (GTFS-RT, Zona) come online in Phase 3 — this
            queue is ready for them.
          </p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Source</th>
                <th>Draft</th>
                <th>Category</th>
                <th>Severity</th>
                <th>Detected</th>
                {canReview ? <th>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.alert_id}>
                  <td>
                    <span className={`pill-sm ${a.source === "gtfs_rt" ? "pill-warning" : "pill-success"}`}>
                      {a.source === "gtfs_rt" ? "GTFS-RT" : "Zona"}
                    </span>
                  </td>
                  <td>{a.draft_text}</td>
                  <td className="td-dim">{CATEGORY_LABELS[a.category] ?? a.category}</td>
                  <td className="td-dim">{SEVERITY_LABELS[a.severity] ?? a.severity}</td>
                  <td className="td-dim">{timeAgo(a.created_at)}</td>
                  {canReview ? (
                    <td>
                      <button className="btn-sm" disabled={busy === a.alert_id} onClick={() => act(a.alert_id, "approve")}>
                        Approve &amp; publish
                      </button>
                      <button className="btn-sm danger" disabled={busy === a.alert_id} onClick={() => act(a.alert_id, "dismiss")}>
                        Dismiss
                      </button>
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
