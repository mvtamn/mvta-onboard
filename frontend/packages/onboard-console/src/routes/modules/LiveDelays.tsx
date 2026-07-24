import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { type TripDelay, ApiError, OCCUPANCY_LABELS, CURRENT_STATUS_LABELS } from "@mvta/shared";
import { api } from "../../config.js";

const ESCALATION_THRESHOLD_SECONDS = 15 * 60;
const AUTO_REFRESH_INTERVAL_MS = 15_000;
const AUTO_REFRESH_STORAGE_KEY = "mvta-onboard-live-delays-auto-refresh";

// Same localStorage convention as ThemeContext.tsx - a dedicated key, read
// synchronously in the useState initializer, written in a useEffect on
// change. Needed because switching OCC Tools tabs (or navigating away
// entirely) fully unmounts this component, so component state alone can
// never survive it - only something outside React's lifecycle can.
function getInitialAutoRefresh(): boolean {
  return window.localStorage.getItem(AUTO_REFRESH_STORAGE_KEY) === "true";
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

function stopLabel(id: string | null, name: string | null): string {
  if (!id) return "—";
  return name ? `${name} (${id})` : id;
}

function groupByRoute(delays: TripDelay[]): [string, TripDelay[]][] {
  const byRoute = new Map<string, TripDelay[]>();
  for (const d of delays) {
    const list = byRoute.get(d.route_id) ?? [];
    list.push(d);
    byRoute.set(d.route_id, list);
  }
  return Array.from(byRoute.entries())
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
    .map(([route, trips]) => [route, [...trips].sort((a, b) => b.delay_seconds - a.delay_seconds)]);
}

// Every currently-monitored trip's live delay, from GTFS-RT TripUpdate - all
// delays are reported here regardless of size. A delay sustained over 15
// minutes across 2 consecutive polls escalates into a Suggested Alerts
// candidate (see gtfsDelaysPoll.ts); this view stays read-only and just
// shows whether that's happened for a given trip.
export function LiveDelays() {
  const [delays, setDelays] = useState<TripDelay[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(getInitialAutoRefresh);
  const [secondsLeft, setSecondsLeft] = useState(AUTO_REFRESH_INTERVAL_MS / 1000);

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
    window.localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, String(autoRefresh));
  }, [autoRefresh]);

  useEffect(() => {
    if (!autoRefresh) {
      setSecondsLeft(AUTO_REFRESH_INTERVAL_MS / 1000);
      return;
    }
    setSecondsLeft(AUTO_REFRESH_INTERVAL_MS / 1000);
    const tickId = setInterval(() => {
      setSecondsLeft((s) => (s <= 1 ? AUTO_REFRESH_INTERVAL_MS / 1000 : s - 1));
    }, 1000);
    const refreshId = setInterval(load, AUTO_REFRESH_INTERVAL_MS);
    return () => {
      clearInterval(tickId);
      clearInterval(refreshId);
    };
  }, [autoRefresh, load]);

  const grouped = useMemo(() => groupByRoute(delays ?? []), [delays]);

  return (
    <>
      <div className="panel-header">
        <span>Live Delays</span>
        <div>
          <button className={`btn-sm ${autoRefresh ? "active" : ""}`} onClick={() => setAutoRefresh((v) => !v)}>
            {autoRefresh ? `⏸ Auto-refresh: on - next in ${secondsLeft}s` : "▶ Auto-refresh: off"}
          </button>
          <button className="btn-sm" onClick={load}>
            ↻ Refresh
          </button>
        </div>
      </div>
      <div className="panel-body">
        <p className="panel-desc">
          Every currently-monitored trip's live delay, direction, speed, and occupancy from
          GTFS-Realtime, grouped by route. The underlying data refreshes server-side every 5
          minutes; auto-refresh just keeps this view in sync without a manual click. A delay
          sustained over 15 minutes escalates into a Suggested Alerts candidate for review.
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
                <th>Vehicle</th>
                <th>Direction</th>
                <th>Previous stop</th>
                <th>Next stop</th>
                <th>Delay</th>
                <th>Speed</th>
                <th>Occupancy</th>
                <th>Status</th>
                <th>Suggested alert</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map(([route, trips]) => (
                <Fragment key={route}>
                  <tr className="route-group-header">
                    <td colSpan={9}>
                      Route {route} <span className="td-dim">({trips.length})</span>
                    </td>
                  </tr>
                  {trips.map((d) => (
                    <tr key={d.trip_id}>
                      <td className="td-dim">{d.vehicle_id ?? "—"}</td>
                      <td className="td-dim">{d.direction_label ?? "—"}</td>
                      <td className="td-dim">{stopLabel(d.previous_stop_id, d.previous_stop_name)}</td>
                      <td className="td-dim">{stopLabel(d.next_stop_id, d.next_stop_name)}</td>
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
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
