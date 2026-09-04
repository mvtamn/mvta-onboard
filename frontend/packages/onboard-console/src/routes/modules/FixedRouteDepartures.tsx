import { useEffect, useState } from "react";
import { ApiError, type FixedRouteDeparture } from "@mvta/shared";
import { api } from "../../config.js";
import { KpiTrustSummary } from "./KpiTrustSummary.js";
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

interface DepartureDiagnostics {
  configured: boolean;
  table_ready: boolean;
  late_count: number;
  expired_count: number;
  avg_delta_seconds: number | null;
  record_count: number;
}

type MonitoringState = "loading" | "unavailable" | "live" | "not_configured" | "not_connected";

// Not-connected monitoring: a source that has not passed its activation gate
// cannot make claims about departure compliance. An unconfigured feed and a
// missing FixedRouteDepartures table are both that state - the API answers 200
// with an empty list either way, so reading that list as "no late pullouts"
// would report a silent zero for a module that has never been switched on.
// The remedy differs, so the two are named separately even though both
// suppress the summary. A failed request is not a not-connected source either:
// nothing is known about the feed, so it says so rather than blaming
// configuration.
function monitoringState(diagnostics: DepartureDiagnostics | null, loading: boolean): MonitoringState {
  if (!diagnostics) return loading ? "loading" : "unavailable";
  if (!diagnostics.configured) return "not_configured";
  if (!diagnostics.table_ready) return "not_connected";
  return "live";
}

function badgeLabel(state: MonitoringState): string {
  if (state === "live") return "Live data";
  if (state === "loading") return "Checking";
  if (state === "unavailable") return "Unavailable";
  return "Not connected";
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
  const [diagnostics, setDiagnostics] = useState<DepartureDiagnostics | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Starts true: the module loads on mount, and an unresolved first request
  // must not read as a source that failed.
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    api
      .getFixedRouteDepartures(days)
      .then(({ departures: rows, diagnostics: diag }) => {
        setDepartures(rows);
        setDiagnostics(diag);
        setMessage(
          !diag.configured
            ? "Avail Pullout Reports feed is not configured yet."
            : !diag.table_ready
              ? "Departure history is not connected: FixedRouteDepartures is missing, so no pullout has been recorded yet. Apply migration 013."
              : rows.length === 0
                ? "Feed configured but no departures have been logged yet in this window."
                : null,
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

  const state = monitoringState(diagnostics, loading);
  const connected = state === "live";

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

      <KpiTrustSummary stream="fixed_route_departures" />

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
          <span className="concept-badge">{badgeLabel(state)}</span>
          <span>{message}</span>
        </div>
      ) : null}

      {/* A zero here is a claim - "no expired pullouts happened" - and an
          unconnected source has not earned it. Withhold the numbers until the
          feed and its table are both live. */}
      <div className="risk-stat-grid" aria-label="Fixed route departures summary">
        <RiskStat value={connected ? diagnostics!.expired_count : "—"} label="Expired pullouts" tone="danger" />
        <RiskStat value={connected ? diagnostics!.late_count : "—"} label="Late pullouts" tone="warning" />
        <RiskStat
          value={connected && diagnostics!.avg_delta_seconds != null ? deltaLabel(diagnostics!.avg_delta_seconds) : "—"}
          label="Avg delta"
          tone="muted"
        />
        <RiskStat value={connected ? diagnostics!.record_count : "—"} label="Tracked in window" tone="accent" />
      </div>

      {state === "loading" ? (
        <div className="risk-empty-state" role="status">
          <strong>Loading departure history</strong>
          <span>Checking the Avail Pullout Reports feed and its recorded history.</span>
        </div>
      ) : state === "unavailable" ? (
        <div className="risk-empty-state">
          <strong>Departure history unavailable</strong>
          <span>The departure-compliance service could not be reached, so this window cannot be reported on.</span>
        </div>
      ) : state === "not_configured" ? (
        <div className="risk-empty-state">
          <strong>Departure monitoring is not configured</strong>
          <span>Set the Avail Pullout Reports feed before relying on departure compliance.</span>
        </div>
      ) : state === "not_connected" ? (
        <div className="risk-empty-state">
          <strong>Departure monitoring is not connected</strong>
          <span>The feed is configured, but its history table is missing, so no departure has been recorded to report on.</span>
        </div>
      ) : !departures || departures.length === 0 ? (
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
