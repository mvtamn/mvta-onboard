import { useEffect, useMemo, useState } from "react";
import { ApiError, type FixedRouteDeparture, type FixedRouteDepartureOutcome } from "@mvta/shared";
import { api } from "../../config.js";
import {
  agencyTimeLabel,
  badgeLabel,
  deltaMinutesLabel,
  monitoringState,
  operatorParts,
  RiskStat,
  serviceDayLabel,
  serviceDaysEnding,
  type DepartureDiagnosticsBase,
} from "./garageDepartures.shared.js";
import "./serviceRisk.css";

const DAY_OPTIONS = [7, 14, 30] as const;
const DEFAULT_DAYS = 14;

export type DepartureGroupBy = "date" | "operator" | "vehicle";
type Show = "all" | "reviewable";

interface DepartureDiagnostics extends DepartureDiagnosticsBase {
  settled_count: number;
  late_count: number;
  no_departure_count: number;
  variance_seconds: number;
  settled_before: string;
}

// The outcome is judged by the API with the compliance candidate rule; this
// only says how each judgement reads. Late and no-departure are the two the
// candidate poll raises, and they share the danger tint because they are the
// same kind of fact - a run the contractor will be asked about.
const OUTCOMES: Record<FixedRouteDepartureOutcome, { label: string; pill: string; rank: number; reviewable: boolean }> = {
  no_departure: { label: "No departure", pill: "pill-danger", rank: 0, reviewable: true },
  late: { label: "Late", pill: "pill-danger", rank: 1, reviewable: true },
  unresolved: { label: "No pullout record", pill: "pill-muted", rank: 2, reviewable: false },
  no_schedule: { label: "No schedule", pill: "pill-muted", rank: 3, reviewable: false },
  departed: { label: "Within allowance", pill: "pill-muted", rank: 4, reviewable: false },
  not_settled: { label: "Not settled", pill: "pill-accent", rank: 5, reviewable: false },
};

export function isReviewable(outcome: FixedRouteDepartureOutcome): boolean {
  return OUTCOMES[outcome].reviewable;
}

// Avail's status is evidence, shown as emitted. Its tint follows what the
// status says about the departure: the three "never left" statuses and the
// settled Expired Pullout are red, Late Pullout amber, everything else
// (clean departures, pull-in states, On Route No Pullout) neutral. A blank
// status is a run Avail has not classified yet, and says so.
export function statusPill(status: string | null): { label: string; className: string } {
  if (!status) return { label: "Still resolving", className: "pill-muted" };
  if (status === "Missed Pullout" || status === "Missed Login" || status === "Expired Pullout") return { label: status, className: "pill-danger" };
  if (status === "Late Pullout") return { label: status, className: "pill-warning" };
  return { label: status, className: "pill-muted" };
}

export interface DepartureGroup {
  key: string;
  title: string;
  reference: string | null;
  settled: boolean;
  lateCount: number;
  noDepartureCount: number;
  departedCount: number;
  avgDeltaSeconds: number | null;
  rows: FixedRouteDeparture[];
}

function summarize(rows: FixedRouteDeparture[]): Pick<DepartureGroup, "lateCount" | "noDepartureCount" | "departedCount" | "avgDeltaSeconds"> {
  const settled = rows.filter((r) => r.outcome !== "not_settled");
  const departed = settled.filter((r) => r.pullout_delta_seconds !== null);
  return {
    lateCount: settled.filter((r) => r.outcome === "late").length,
    noDepartureCount: settled.filter((r) => r.outcome === "no_departure").length,
    departedCount: departed.length,
    avgDeltaSeconds: departed.length
      ? Math.round(departed.reduce((sum, r) => sum + (r.pullout_delta_seconds ?? 0), 0) / departed.length)
      : null,
  };
}

function byBlockRun(a: FixedRouteDeparture, b: FixedRouteDeparture): number {
  return a.block - b.block || a.run - b.run;
}

// Rows grouped for reading. By service day: newest day first, and within a
// day the runs that need attention before the clean ones. By operator or
// vehicle: the groups with the most reviewable runs first, so a repeat
// offender is the first thing on the page, and within a group newest first.
export function groupDepartures(rows: FixedRouteDeparture[], groupBy: DepartureGroupBy): DepartureGroup[] {
  if (groupBy === "date") {
    const dates = [...new Set(rows.map((r) => r.service_date))].sort((a, b) => b.localeCompare(a));
    return dates.map((date) => {
      const members = rows
        .filter((r) => r.service_date === date)
        .sort((a, b) => OUTCOMES[a.outcome].rank - OUTCOMES[b.outcome].rank || byBlockRun(a, b));
      return {
        key: date,
        title: serviceDayLabel(date),
        reference: null,
        settled: members.every((r) => r.outcome !== "not_settled"),
        ...summarize(members),
        rows: members,
      };
    });
  }
  const keyOf = groupBy === "operator" ? (r: FixedRouteDeparture) => r.operator_name ?? "" : (r: FixedRouteDeparture) => r.vehicle_label ?? "";
  const keys = [...new Set(rows.map(keyOf))];
  return keys
    .map((key) => {
      const members = rows
        .filter((r) => keyOf(r) === key)
        .sort((a, b) => b.service_date.localeCompare(a.service_date) || byBlockRun(a, b));
      let title: string;
      let reference: string | null = null;
      if (groupBy === "operator") {
        const parts = operatorParts(key);
        title = parts ? parts.name : "No operator on record";
        reference = parts?.badge ? `#${parts.badge}` : null;
      } else {
        title = key ? `Vehicle ${key}` : "No vehicle on record";
      }
      return { key, title, reference, settled: true, ...summarize(members), rows: members };
    })
    .sort((a, b) => (b.lateCount + b.noDepartureCount) - (a.lateCount + a.noDepartureCount) || a.title.localeCompare(b.title));
}

export interface DailyReviewable {
  date: string;
  late: number;
  noDeparture: number;
  settled: boolean;
}

// One entry per service day in the window, including days with no rows, so
// the strip's spacing is calendar time and a quiet day shows as quiet.
export function dailyReviewable(rows: FixedRouteDeparture[], settledBefore: string, days: number): DailyReviewable[] {
  return serviceDaysEnding(settledBefore, days).map((date) => ({
    date,
    late: rows.filter((r) => r.service_date === date && r.outcome === "late").length,
    noDeparture: rows.filter((r) => r.service_date === date && r.outcome === "no_departure").length,
    settled: date < settledBefore,
  }));
}

function dayTick(date: string): string {
  const d = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? date.slice(6, 8) : d.toLocaleDateString("en-US", { weekday: "short" }).slice(0, 2) + " " + d.getDate();
}

function isWeekend(date: string): boolean {
  const d = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T12:00:00`);
  return d.getDay() === 0 || d.getDay() === 6;
}

function percent(part: number, whole: number): string {
  return whole > 0 ? `${(100 * part / whole).toFixed(1)}%` : "—";
}

function avgLabel(seconds: number | null): string {
  return seconds === null ? "no departed runs" : `avg ${deltaMinutesLabel(seconds)}`;
}

const COLUMNS: Record<string, { label: string; hint: string; className?: string }> = {
  date: { label: "Service day", hint: "Central" },
  block: { label: "Block/Run", hint: "", className: "td-num" },
  operator: { label: "Operator", hint: "Avail badge" },
  vehicle: { label: "Vehicle", hint: "fleet no." },
  scheduled: { label: "Scheduled", hint: "pullout", className: "td-num" },
  actual: { label: "Actual", hint: "pullout", className: "td-num" },
  delta: { label: "Delta", hint: "", className: "td-num" },
  status: { label: "Avail status", hint: "as emitted" },
  outcome: { label: "Outcome", hint: "contract rule" },
};

function columnsFor(groupBy: DepartureGroupBy): string[] {
  const all = ["date", "block", "operator", "vehicle", "scheduled", "actual", "delta", "status", "outcome"];
  return all.filter((key) => key !== groupBy);
}

// Fixed Route view of Garage Departures - Avail Pullout compliance tracking
// (Compliance tab). Evaluates whether vehicles left the garage on schedule,
// using Avail's own dispatch-side check-in/login/pullout timing - a more
// authoritative signal for garage-side lateness than anything inferred from
// GTFS or AVL data. A growing historical log (not a live feed), so this
// fetches on mount/range-change with a manual refresh, no auto-refresh
// interval. The module head and the service-type switch live in
// GarageDepartures.tsx.
export function FixedRouteDepartures() {
  const [days, setDays] = useState<number>(DEFAULT_DAYS);
  const [groupBy, setGroupBy] = useState<DepartureGroupBy>("date");
  const [show, setShow] = useState<Show>("all");
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
  const varianceMinutes = diagnostics ? Math.round(diagnostics.variance_seconds / 60) : null;

  const visible = useMemo(
    () => (departures ?? []).filter((d) => show === "all" || isReviewable(d.outcome)),
    [departures, show],
  );
  const groups = useMemo(() => groupDepartures(visible, groupBy), [visible, groupBy]);
  const daily = useMemo(
    () => (departures && diagnostics ? dailyReviewable(departures, diagnostics.settled_before, days) : []),
    [departures, diagnostics, days],
  );
  const dailyMax = Math.max(1, ...daily.map((d) => d.late + d.noDeparture));
  const columns = columnsFor(groupBy);
  const todayCount = diagnostics ? diagnostics.record_count - diagnostics.settled_count : 0;

  return (
    <>
      <div className="risk-refresh-bar" aria-label="Fixed route departures controls">
        <label htmlFor="frd-days">Window</label>
        <select id="frd-days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {DAY_OPTIONS.map((d) => (
            <option value={d} key={d}>Last {d} days</option>
          ))}
        </select>
        <label id="frd-group-label">Group by</label>
        <div className="risk-view-toggle risk-view-toggle-sm" role="tablist" aria-labelledby="frd-group-label">
          {([["date", "Service day"], ["operator", "Operator"], ["vehicle", "Vehicle"]] as const).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={groupBy === key}
              className={groupBy === key ? "active" : ""}
              onClick={() => setGroupBy(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <label htmlFor="frd-show">Show</label>
        <select id="frd-show" value={show} onChange={(e) => setShow(e.target.value as Show)}>
          <option value="all">All runs</option>
          <option value="reviewable">Reviewable only</option>
        </select>
        <button className="btn-sm" disabled={loading} onClick={load}>
          {loading ? "Refreshing…" : "↻ Refresh"}
        </button>
        <span className="departures-bar-note">
          Times are Central.{varianceMinutes !== null ? <> Allowance <strong>{varianceMinutes} min</strong>.</> : null}
        </span>
      </div>

      {message ? (
        <div className="concept-banner">
          <span className="concept-badge">{badgeLabel(state)}</span>
          <span>{message}</span>
        </div>
      ) : null}

      {/* A zero here is a claim - "no run failed to depart" - and an
          unconnected source has not earned it. Withhold the numbers until the
          feed and its table are both live. */}
      <div className="risk-stat-grid" aria-label="Fixed route departures summary">
        <RiskStat
          value={connected ? diagnostics!.no_departure_count : "—"}
          label="No departure"
          detail={connected ? `${percent(diagnostics!.no_departure_count, diagnostics!.settled_count)} of ${diagnostics!.settled_count} settled runs` : undefined}
          tone="danger"
        />
        <RiskStat
          value={connected ? diagnostics!.late_count : "—"}
          label={varianceMinutes !== null ? `Late over ${varianceMinutes} min` : "Late over allowance"}
          detail={connected ? `${percent(diagnostics!.late_count, diagnostics!.settled_count)} of settled runs` : undefined}
          tone="warning"
        />
        <RiskStat
          value={connected && diagnostics!.avg_delta_seconds != null ? deltaMinutesLabel(diagnostics!.avg_delta_seconds) : "—"}
          label="Avg delta, departed runs"
          detail={connected ? "settled runs with a recorded pullout" : undefined}
          tone="muted"
        />
        <RiskStat
          value={connected ? diagnostics!.record_count : "—"}
          label="Runs tracked"
          detail={connected ? `${diagnostics!.settled_count} settled · ${todayCount} today, not settled` : undefined}
          tone="accent"
        />
      </div>

      {connected && departures && departures.length > 0 ? (
        <div className="departure-trend" aria-label="Reviewable departures by service day">
          <div className="departure-trend-head">
            <h4>Reviewable departures by service day</h4>
            <div className="departure-trend-legend">
              <span><i className="nodep"></i>No departure</span>
              <span><i className="late"></i>Late over {varianceMinutes} min</span>
              <span><i className="late open"></i>Today, not settled</span>
            </div>
          </div>
          <div className="departure-trend-bars" style={{ gridTemplateColumns: `repeat(${daily.length}, minmax(0, 1fr))` }}>
            {daily.map((day) => (
              <div
                key={day.date}
                className={`departure-trend-day${day.settled ? "" : " open"}${isWeekend(day.date) ? " weekend" : ""}`}
                title={`${serviceDayLabel(day.date)}: ${day.noDeparture} no departure, ${day.late} late${day.settled ? "" : " (not settled)"}`}
              >
                <div className="departure-trend-col">
                  <div className="bar late" style={{ height: `${Math.round((day.late / dailyMax) * 62)}px` }}></div>
                  <div className="bar nodep" style={{ height: `${Math.round((day.noDeparture / dailyMax) * 62)}px` }}></div>
                </div>
                <span className="departure-trend-n">{day.late + day.noDeparture}</span>
                <span className="departure-trend-lbl">{dayTick(day.date)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

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
      ) : visible.length === 0 ? (
        <div className="risk-empty-state">
          <strong>No reviewable departures</strong>
          <span>Every settled run in this window departed within the allowance.</span>
        </div>
      ) : (
        <>
          <div className="departures-table-scroll">
            <table className="data departures-table">
              <thead>
                <tr>
                  {columns.map((key) => (
                    <th key={key} className={COLUMNS[key].className}>
                      {COLUMNS[key].label}
                      <small>{key === "delta" && varianceMinutes !== null ? `allowance ${varianceMinutes} min` : COLUMNS[key].hint}</small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <GroupRows key={group.key} group={group} groupBy={groupBy} columns={columns} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="departures-foot">
            Outcome applies the rule the compliance candidate poll uses: a settled run with a scheduled pullout that never departed, or departed more than the allowance late, is raised for review. Avail's status is shown as the vendor emits it and never decides the outcome on its own.
          </p>
        </>
      )}
    </>
  );
}

function GroupRows({ group, groupBy, columns }: { group: DepartureGroup; groupBy: DepartureGroupBy; columns: string[] }) {
  const reviewable = group.lateCount + group.noDepartureCount;
  const meta = groupBy === "date" && !group.settled
    ? `${group.rows.length} runs so far · Avail is still classifying today`
    : `${group.rows.length} runs · ${reviewable} reviewable${group.noDepartureCount ? ` (${group.noDepartureCount} no departure)` : ""} · ${avgLabel(group.avgDeltaSeconds)}`;
  return (
    <>
      <tr className="departure-band">
        <td colSpan={columns.length}>
          <div className="departure-band-line">
            <strong>{group.title}</strong>
            {group.reference ? <span className="mono-ref">{group.reference}</span> : null}
            <span>{meta}</span>
            {groupBy === "date" && !group.settled ? <span className="pill-sm pill-accent">Not settled</span> : null}
            {groupBy !== "date" && reviewable >= 2 ? <span className="pill-sm pill-warning">Repeat</span> : null}
          </div>
        </td>
      </tr>
      {group.rows.map((d) => (
        <tr key={`${d.service_date}-${d.block}-${d.run}`}>
          {columns.map((key) => (
            <DepartureCell key={key} column={key} departure={d} />
          ))}
        </tr>
      ))}
    </>
  );
}

function DepartureCell({ column, departure: d }: { column: string; departure: FixedRouteDeparture }) {
  switch (column) {
    case "date":
      return <td className="td-dim">{serviceDayLabel(d.service_date)}</td>;
    case "block":
      return <td className="td-num">{d.block}/{d.run}</td>;
    case "operator": {
      const parts = operatorParts(d.operator_name);
      return parts ? (
        <td className="td-name">
          {parts.name}
          {parts.badge ? <span className="mono-ref">#{parts.badge}</span> : null}
        </td>
      ) : (
        <td><span className="td-absent">No operator on record</span></td>
      );
    }
    case "vehicle":
      return d.vehicle_label ? <td><span className="td-fleet">{d.vehicle_label}</span></td> : <td><span className="td-absent">No vehicle on record</span></td>;
    case "scheduled":
      return <td className="td-num td-dim">{agencyTimeLabel(d.pullout_scheduled)}</td>;
    case "actual":
      return <td className="td-num td-dim">{agencyTimeLabel(d.pullout_actual)}</td>;
    case "delta":
      return <td className={`td-num${d.outcome === "late" ? " td-over" : ""}`}>{deltaMinutesLabel(d.pullout_delta_seconds)}</td>;
    case "status": {
      const pill = statusPill(d.pullout_status);
      return <td><span className={`pill-sm ${pill.className}`}>{pill.label}</span></td>;
    }
    case "outcome": {
      const o = OUTCOMES[d.outcome];
      return <td><span className={`pill-sm ${o.pill}`}>{o.label}</span></td>;
    }
    default:
      return <td></td>;
  }
}
