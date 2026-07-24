import { useCallback, useEffect, useState } from "react";
import { type TripDelay, ApiError, OCCUPANCY_LABELS, CURRENT_STATUS_LABELS } from "@mvta/shared";
import { api } from "../../config.js";

const ESCALATION_THRESHOLD_SECONDS = 15 * 60;
const AUTO_REFRESH_INTERVAL_MS = 15_000;

function nextStopLabel(d: TripDelay): string {
  if (!d.next_stop_id) return "—";
  return d.next_stop_name ? `${d.next_stop_name} (#${d.next_stop_id})` : d.next_stop_id;
}

function delayPill(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (seconds <= 0) {
    return <span className="pill-sm pill-success">On time</span>;
  }
  const cls = seconds >= ESCALATION_THRESHOLD_SECONDS ? "pill-danger" : "pill-warning";
  return (
    <span className={`pill-sm ${cls}`}>
      +{minutes} min
    </span>
  );
}

function formatSpeed(speedMps: number | null): string {
  if (speedMps === null) return "—";
  const mph = speedMps * 2.23694;
  return `${Math.round(mph)} mph`;
}

function occupancyPill(status: number | null) {
  if (status === null) return <span className="td-dim">—</span>;
  const cls = status >= 5 ? "pill-danger" : status >= 3 ? "pill-warning" : "pill-success";
  return <span className={`pill-sm ${cls}`}>{OCCUPANCY_LABELS[status] ?? status}</span>;
}

// Every currently-monitored trip's live delay, from GTFS-RT TripUpdate - all
// delays are reported here regardless of size. A delay sustained over 15
// minutes across 2 consecutive polls escalates into a Suggested Alerts
// candidate (see gtfsDelaysPoll.ts); this view stays read-only and just
// shows whether that's happened for a given trip.
export function LiveDelays() {
  const [delays, setDelays] = useState<TripDelay[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const load = useCallback(() => {
    api
      .getTripDelays()
      .then((d) => {
        setDelays(d.delays);
        setError(null);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load live delays."));
  }, []);

  useEffect(load, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(load, AUTO_REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [autoRefresh, load]);

  return (
    <>
      <div className="panel-header">
        <span>Live Delays</span>
        <div>
          <button className={`btn-sm ${autoRefresh ? "active" : ""}`} onClick={() => setAutoRefresh((v) => !v)}>
            {autoRefresh ? "⏸ Auto-refresh: on (15s)" : "▶ Auto-refresh: off"}
          </button>
          <button className="btn-sm" onClick={load}>
            ↻ Refresh
          </button>
        </div>
      </div>
      <div className="panel-body">
        <p className="panel-desc">
          Every currently-monitored trip's live delay, speed, and occupancy from GTFS-Realtime.
          The underlying data refreshes server-side every 5 minutes; auto-refresh just keeps this
          view in sync without a manual click. A delay sustained over 15 minutes escalates into a
          Suggested Alerts candidate for review.
        </p>
        {error ? <p className="error-text">{error}</p> : null}
        {delays === null ? (
          <p className="muted">Loading… (requires staff sign-in)</p>
        ) : delays.length === 0 ? (
          <p className="empty-note">No trips currently being monitored.</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Route</th>
                <th>Vehicle</th>
                <th>Next stop</th>
                <th>Delay</th>
                <th>Speed</th>
                <th>Occupancy</th>
                <th>Status</th>
                <th>Suggested alert</th>
              </tr>
            </thead>
            <tbody>
              {delays.map((d) => (
                <tr key={d.trip_id}>
                  <td>{d.route_id}</td>
                  <td className="td-dim">{d.vehicle_id ?? "—"}</td>
                  <td className="td-dim">{nextStopLabel(d)}</td>
                  <td>{delayPill(d.delay_seconds)}</td>
                  <td className="td-dim">{formatSpeed(d.speed_mps)}</td>
                  <td>{occupancyPill(d.occupancy_status)}</td>
                  <td className="td-dim">
                    {d.current_status !== null ? CURRENT_STATUS_LABELS[d.current_status] ?? d.current_status : "—"}
                  </td>
                  <td>
                    {d.suggested_alert_id ? (
                      <span className="pill-sm pill-accent">Escalated</span>
                    ) : (
                      <span className="td-dim">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
