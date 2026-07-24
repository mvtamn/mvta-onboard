import { useCallback, useEffect, useState } from "react";
import { type TripDelay, ApiError } from "@mvta/shared";
import { api } from "../../config.js";

const ESCALATION_THRESHOLD_SECONDS = 15 * 60;

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

// Every currently-monitored trip's live delay, from GTFS-RT TripUpdate - all
// delays are reported here regardless of size. A delay sustained over 15
// minutes across 2 consecutive polls escalates into a Suggested Alerts
// candidate (see gtfsDelaysPoll.ts); this view stays read-only and just
// shows whether that's happened for a given trip.
export function LiveDelays() {
  const [delays, setDelays] = useState<TripDelay[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <>
      <div className="panel-header">
        <span>Live Delays</span>
        <button className="btn-sm" onClick={load}>
          ↻ Refresh
        </button>
      </div>
      <div className="panel-body">
        <p className="panel-desc">
          Every currently-monitored trip's live delay from GTFS-Realtime, refreshed every 5 minutes.
          A delay sustained over 15 minutes escalates into a Suggested Alerts candidate for review.
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
                <th>Suggested alert</th>
              </tr>
            </thead>
            <tbody>
              {delays.map((d) => (
                <tr key={d.trip_id}>
                  <td>{d.route_id}</td>
                  <td className="td-dim">{d.vehicle_id ?? "—"}</td>
                  <td className="td-dim">{d.next_stop_id ?? "—"}</td>
                  <td>{delayPill(d.delay_seconds)}</td>
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
