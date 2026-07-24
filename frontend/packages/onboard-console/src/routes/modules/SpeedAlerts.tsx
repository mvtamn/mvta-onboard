import { useCallback, useEffect, useState } from "react";
import { type TripDelay, ApiError, CURRENT_STATUS_LABELS } from "@mvta/shared";
import { api } from "../../config.js";

const AUTO_REFRESH_INTERVAL_MS = 15_000;
// A flat fleet-wide flag point, not a per-route/per-road-segment speed-limit
// calculation - this app has no posted-speed-limit data per segment to
// compare against. Adjust if 50 proves too noisy or too quiet in practice.
const SPEEDING_THRESHOLD_MPH = 50;

function mph(speedMps: number | null): number | null {
  return speedMps === null ? null : speedMps * 2.23694;
}

function nextStopLabel(d: TripDelay): string {
  if (!d.next_stop_id) return "—";
  return d.next_stop_name ? `${d.next_stop_name} (#${d.next_stop_id})` : d.next_stop_id;
}

// Vehicles currently over SPEEDING_THRESHOLD_MPH, from the same GTFS-RT
// VehiclePosition data Live Delays shows - this is a filtered lens on that
// same dataset, not a separate feed or table.
export function SpeedAlerts() {
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
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load speed data."));
  }, []);

  useEffect(load, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(load, AUTO_REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [autoRefresh, load]);

  const speeding = (delays ?? [])
    .map((d) => ({ d, mph: mph(d.speed_mps) }))
    .filter((row): row is { d: TripDelay; mph: number } => row.mph !== null && row.mph >= SPEEDING_THRESHOLD_MPH)
    .sort((a, b) => b.mph - a.mph);

  return (
    <>
      <div className="panel-header">
        <span>Speed Alerts</span>
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
          Vehicles currently running at or above {SPEEDING_THRESHOLD_MPH} mph, from the same
          GTFS-Realtime data shown in Live Delays. This is a flat fleet-wide flag point, not a
          per-route speed-limit check - use judgment on whether a flagged trip is actually a
          concern (e.g. a highway segment) before acting on it.
        </p>
        {error ? <p className="error-text">{error}</p> : null}
        {delays === null ? (
          <p className="muted">Loading… (requires staff sign-in)</p>
        ) : speeding.length === 0 ? (
          <p className="empty-note">No vehicles currently at or above {SPEEDING_THRESHOLD_MPH} mph.</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Route</th>
                <th>Vehicle</th>
                <th>Speed</th>
                <th>Next stop</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {speeding.map(({ d, mph: speed }) => (
                <tr key={d.trip_id}>
                  <td>{d.route_id}</td>
                  <td className="td-dim">{d.vehicle_id ?? "—"}</td>
                  <td>
                    <span className="pill-sm pill-danger">{Math.round(speed)} mph</span>
                  </td>
                  <td className="td-dim">{nextStopLabel(d)}</td>
                  <td className="td-dim">
                    {d.current_status !== null ? CURRENT_STATUS_LABELS[d.current_status] ?? d.current_status : "—"}
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
