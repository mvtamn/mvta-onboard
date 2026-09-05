import { useEffect, useState } from "react";
import { ApiError, type OnDemandDeparture } from "@mvta/shared";
import { api } from "../../config.js";
import { KpiTrustSummary } from "./KpiTrustSummary.js";
import {
  badgeLabel,
  dateTimeLabel,
  deltaLabel,
  monitoringState,
  RiskStat,
  type DepartureDiagnosticsBase,
} from "./garageDepartures.shared.js";
import "./serviceRisk.css";

const DAY_OPTIONS = [7, 14, 30] as const;
const DEFAULT_DAYS = 14;

interface DepartureDiagnostics extends DepartureDiagnosticsBase {
  late_count: number;
  no_departure_count: number;
  variance_seconds: number;
}

// Where the actual came from. A started start-location slot is Spare's own
// record of the pullout; the vehicle first appearing in the service area is
// an inference, and is labelled as one.
function sourceLabel(source: OnDemandDeparture["departure_source"]): string {
  if (source === "slots_startLocation") return "Start slot";
  if (source === "duties_firstSeenInServiceArea") return "Seen in service area";
  return "—";
}

function outcome(d: OnDemandDeparture, varianceSeconds: number): { label: string; className: string } | null {
  if (d.no_departure) return { label: "No departure", className: "pill-danger" };
  if (d.departure_delta_seconds === null) return null;
  if (d.departure_delta_seconds > varianceSeconds) return { label: "Late", className: "pill-warning" };
  return { label: "Departed", className: "pill-muted" };
}

// On-Demand view of Garage Departures - Spare duty start tracking
// (Compliance tab). One row per duty: the start-location slot's scheduled
// and started times when Spare has one, else the duty's requested start and
// its first sighting in the service area. Same growing-log shape as the fixed
// route view, so it fetches on mount/range-change with a manual refresh.
export function OnDemandDepartures() {
  const [days, setDays] = useState<number>(DEFAULT_DAYS);
  const [departures, setDepartures] = useState<OnDemandDeparture[] | null>(null);
  const [diagnostics, setDiagnostics] = useState<DepartureDiagnostics | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    api
      .getOnDemandDepartures(days)
      .then(({ departures: rows, diagnostics: diag }) => {
        setDepartures(rows);
        setDiagnostics(diag);
        setMessage(
          !diag.configured
            ? "Spare duty departures are not enabled yet (ON_DEMAND_DEPARTURES_ENABLED and SPARE_API_KEY)."
            : !diag.table_ready
              ? "Departure history is not connected: OnDemandDepartures is missing, so no duty has been recorded yet. Apply migration 096."
              : rows.length === 0
                ? "Feed enabled but no duty departures have been logged yet in this window."
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
  const varianceMinutes = diagnostics ? Math.round(diagnostics.variance_seconds / 60) : null;

  return (
    <>
      <KpiTrustSummary stream="on_demand_departures" />

      <div className="risk-refresh-bar" aria-label="On-demand departures controls">
        <label htmlFor="odd-days">Window</label>
        <select id="odd-days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
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

      {/* Same rule as the fixed route view: the numbers are withheld until the
          feed and its table are both live, because a zero is a claim. */}
      <div className="risk-stat-grid" aria-label="On-demand departures summary">
        <RiskStat value={connected ? diagnostics!.no_departure_count : "—"} label="No departure recorded" tone="danger" />
        <RiskStat
          value={connected ? diagnostics!.late_count : "—"}
          label={varianceMinutes !== null ? `Late over ${varianceMinutes} min` : "Late departures"}
          tone="warning"
        />
        <RiskStat
          value={connected && diagnostics!.avg_delta_seconds != null ? deltaLabel(diagnostics!.avg_delta_seconds) : "—"}
          label="Avg delta"
          tone="muted"
        />
        <RiskStat value={connected ? diagnostics!.record_count : "—"} label="Duties in window" tone="accent" />
      </div>

      {state === "loading" ? (
        <div className="risk-empty-state" role="status">
          <strong>Loading departure history</strong>
          <span>Checking the Spare duties feed and its recorded history.</span>
        </div>
      ) : state === "unavailable" ? (
        <div className="risk-empty-state">
          <strong>Departure history unavailable</strong>
          <span>The departure-compliance service could not be reached, so this window cannot be reported on.</span>
        </div>
      ) : state === "not_configured" ? (
        <div className="risk-empty-state">
          <strong>Departure monitoring is not configured</strong>
          <span>Enable Spare duty departures before relying on on-demand departure compliance.</span>
        </div>
      ) : state === "not_connected" ? (
        <div className="risk-empty-state">
          <strong>Departure monitoring is not connected</strong>
          <span>The feed is enabled, but its history table is missing, so no duty departure has been recorded to report on.</span>
        </div>
      ) : !departures || departures.length === 0 ? (
        <div className="risk-empty-state">
          <strong>No departures tracked</strong>
          <span>No duty departures are available for this window yet.</span>
        </div>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Date</th>
              <th>Duty</th>
              <th>Driver</th>
              <th>Vehicle</th>
              <th>Scheduled</th>
              <th>Actual</th>
              <th>Delta</th>
              <th>Source</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {departures.map((d) => {
              const pill = outcome(d, diagnostics!.variance_seconds);
              return (
                <tr key={d.duty_id}>
                  <td className="td-dim">{d.service_date}</td>
                  <td>{d.duty_identifier ?? d.duty_id}</td>
                  <td className="td-dim">{d.driver_id ?? "—"}</td>
                  <td className="td-dim">{d.vehicle_id ?? "—"}</td>
                  <td className="td-dim" title={d.scheduled_source === "duties_startRequested" ? "From the duty's requested start; no start-location slot" : undefined}>
                    {dateTimeLabel(d.departure_scheduled)}
                    {d.scheduled_source === "duties_startRequested" ? " *" : ""}
                  </td>
                  <td className="td-dim">{dateTimeLabel(d.departure_actual)}</td>
                  <td>{deltaLabel(d.departure_delta_seconds)}</td>
                  <td className="td-dim">{sourceLabel(d.departure_source)}</td>
                  <td>{pill ? <span className={`pill-sm ${pill.className}`}>{pill.label}</span> : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {departures?.some((d) => d.scheduled_source === "duties_startRequested") ? (
        <p className="td-dim" style={{ fontSize: 11, marginTop: 8 }}>
          * Scheduled from the duty's requested start because Spare has no start-location slot for it.
        </p>
      ) : null}
    </>
  );
}
