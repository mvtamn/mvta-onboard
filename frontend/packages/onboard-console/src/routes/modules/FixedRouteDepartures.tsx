import { useEffect, useState } from "react";
import { ApiError, type FixedRouteDeparture } from "@mvta/shared";
import { api } from "../../config.js";
import "./serviceRisk.css";

const DAY_OPTIONS = [7, 14, 30] as const;
const DEFAULT_DAYS = 14;

function dateTimeLabel(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function deltaLabel(seconds: number | null): string {
  if (seconds === null) return "—";
  const minutes = Math.round(seconds / 60);
  if (minutes === 0) return "On time";
  return minutes > 0 ? `+${minutes} min` : `${minutes} min`;
}

function statusClass(status: string | null): string {
  if (status === "Expired Pullout") return "pill-danger";
  if (status === "Late Relief") return "pill-warning";
  return "pill-muted";
}

// Fixed Route Departures - Avail Pullout compliance tracking (Compliance
// tab). Evaluates whether vehicles left the garage on schedule, using
// Avail's own dispatch-side check-in/login/pullout timing - a more
// authoritative signal for garage-side lateness than anything inferred from
// GTFS or AVL data. A growing historical log (not a live feed), so this
// fetches on mount/range-change with a manual refresh, no auto-refresh
// interval.
export function FixedRouteDepartures() {
  const [days, setDays] = useState<number>(DEFAULT_DAYS);
  const [departures, setDepartures] = useState<FixedRouteDeparture[] | null>(null);
  const [diagnostics, setDiagnostics] = useState<{
    configured: boolean;
    late_count: number;
    expired_count: number;
    avg_delta_seconds: number | null;
    record_count: number;
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function load() {
    setLoading(true);
    api
      .getFixedRouteDepartures(days)
      .then(({ departures: rows, diagnostics: diag }) => {
        setDepartures(rows);
        setDiagnostics(diag);
        setMessage(
          diag.configured
            ? rows.length === 0
              ? "Feed configured but no departures have been logged yet in this window."
              : null
            : "Avail Pullout Reports feed is not configured yet.",
        );
      })
      .catch((err) => {
        setDepartures(null);
        setDiagnostics(null);
        setMessage(
          err instanceof ApiError
            ? `Could not load departure history: ${err.message}`
            : "Could not reach the departure-compliance service.",
        );
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  return (
    <div className="risk-module">
      <div className="risk-module-head">
        <div>
          <span className="risk-eyebrow">Compliance investigation</span>
          <h2>Fixed Route Departures</h2>
          <p>
            Evaluates whether vehicles left the garage on schedule using Avail's own dispatch
            check-in/login/pullout timing. Late and expired pullouts are logged permanently for
            trend analysis.
          </p>
        </div>
      </div>

      <div className="risk-refresh-bar" aria-label="Fixed route departures controls">
        <label htmlFor="frd-days">Window</label>
        <select id="frd-days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {DAY_OPTIONS.map((d) => (
            <option value={d} key={d}>Last {d} days</option>
          ))}
        </select>
        <button className="btn-sm" disabled={loading} onClick={load}>
          {loading ? "Refreshing…" : "↻ Refresh"}
        </button>
      </div>

      {message ? (
        <div className="concept-banner">
          <span className="concept-badge">{diagnostics?.configured ? "Live data" : "Preview data"}</span>
          <span>{message}</span>
        </div>
      ) : null}

      <div className="risk-stat-grid" aria-label="Fixed route departures summary">
        <RiskStat value={diagnostics?.expired_count ?? 0} label="Expired pullouts" tone="danger" />
        <RiskStat value={diagnostics?.late_count ?? 0} label="Late pullouts" tone="warning" />
        <RiskStat
          value={diagnostics?.avg_delta_seconds != null ? deltaLabel(diagnostics.avg_delta_seconds) : "—"}
          label="Avg delta"
          tone="muted"
        />
        <RiskStat value={diagnostics?.record_count ?? 0} label="Tracked in window" tone="accent" />
      </div>

      {!departures || departures.length === 0 ? (
        <div className="risk-empty-state">
          <strong>No departures tracked</strong>
          <span>No pullout records are available for this window yet.</span>
        </div>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Date</th>
              <th>Operator</th>
              <th>Vehicle</th>
              <th>Block/Run</th>
              <th>Scheduled</th>
              <th>Actual</th>
              <th>Delta</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {departures.map((d) => (
              <tr key={`${d.service_date}-${d.block}-${d.run}`}>
                <td className="td-dim">{d.service_date}</td>
                <td>{d.operator_name ?? "—"}</td>
                <td>{d.vehicle_label ?? "—"}</td>
                <td>{d.block}/{d.run}</td>
                <td className="td-dim">{dateTimeLabel(d.pullout_scheduled)}</td>
                <td className="td-dim">{dateTimeLabel(d.pullout_actual)}</td>
                <td>{deltaLabel(d.pullout_delta_seconds)}</td>
                <td>
                  {d.pullout_status ? (
                    <span className={`pill-sm ${statusClass(d.pullout_status)}`}>{d.pullout_status}</span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function RiskStat({
  value,
  label,
  tone,
}: {
  value: string | number;
  label: string;
  tone: "danger" | "warning" | "muted" | "accent";
}) {
  return (
    <div className={`risk-stat ${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
