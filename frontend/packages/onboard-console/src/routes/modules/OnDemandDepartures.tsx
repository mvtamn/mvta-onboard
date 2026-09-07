import { useEffect, useMemo, useState } from "react";
import { ApiError, type OnDemandDeparture, type OnDemandDepartureOutcome } from "@mvta/shared";
import { api } from "../../config.js";
import { useAuth } from "../../auth/AuthContext.js";
import {
  agencyTimeLabel,
  badgeLabel,
  dailyCounts,
  deltaMinutesLabel,
  DepartureTrend,
  GroupByToggle,
  monitoringState,
  OccurrenceCell,
  type OccurrenceReviewHandlers,
  RiskStat,
  serviceDayLabel,
  shortRef,
  type DailyCounts,
  type DepartureDiagnosticsBase,
  type DepartureGroupBy,
} from "./garageDepartures.shared.js";
import "./serviceRisk.css";

const DAY_OPTIONS = [7, 14, 30] as const;
const DEFAULT_DAYS = 14;

type Show = "all" | "flagged";

interface DepartureDiagnostics extends DepartureDiagnosticsBase {
  judged_count: number;
  late_count: number;
  no_departure_count: number;
  variance_seconds: number;
  settled_before: string;
}

// The outcome is judged by the API with the compliance candidate rule (the
// on-demand half of GARAGE_DEPARTURE since ADR 0028's source discriminator
// landed); this only says how each judgement reads. Late and no-departure are
// the two the candidate poll raises, and share the danger tint because they
// are the same kind of fact - a duty the contractor will be asked about.
const OUTCOMES: Record<OnDemandDepartureOutcome, { label: string; pill: string; rank: number; flagged: boolean }> = {
  no_departure: { label: "No departure", pill: "pill-danger", rank: 0, flagged: true },
  late: { label: "Late", pill: "pill-danger", rank: 1, flagged: true },
  no_schedule: { label: "No schedule", pill: "pill-muted", rank: 2, flagged: false },
  departed: { label: "Within allowance", pill: "pill-muted", rank: 3, flagged: false },
  cancelled: { label: "Cancelled", pill: "pill-muted", rank: 4, flagged: false },
  not_settled: { label: "Not settled", pill: "pill-accent", rank: 5, flagged: false },
};

export function isFlagged(outcome: OnDemandDepartureOutcome): boolean {
  return OUTCOMES[outcome].flagged;
}

function isJudged(outcome: OnDemandDepartureOutcome): boolean {
  return outcome === "late" || outcome === "no_departure" || outcome === "departed";
}

// Where each side of the measurement came from. A started start-location
// slot is Spare's own record of the pullout; the vehicle first appearing in
// the service area is an inference, and is labelled as one.
export function scheduledSourceLabel(source: OnDemandDeparture["scheduled_source"]): string | null {
  if (source === "slots_startLocation") return "start slot";
  if (source === "duties_startRequested") return "requested start";
  return null;
}

export function actualSourceLabel(source: OnDemandDeparture["departure_source"]): string | null {
  if (source === "slots_startLocation") return "slot started";
  if (source === "duties_firstSeenInServiceArea") return "seen in service area";
  return null;
}

export interface DutyGroup {
  key: string;
  title: string;
  reference: string | null;
  // The full Spare id behind the group, for hover. The band shows a short
  // reference instead: a 36-character id printed beside a driver's name
  // crowds out the name, which is the thing being read.
  referenceTitle: string | null;
  open: boolean;
  lateCount: number;
  noDepartureCount: number;
  departedCount: number;
  avgDeltaSeconds: number | null;
  rows: OnDemandDeparture[];
}

function summarize(rows: OnDemandDeparture[]): Pick<DutyGroup, "lateCount" | "noDepartureCount" | "departedCount" | "avgDeltaSeconds"> {
  const judged = rows.filter((r) => isJudged(r.outcome));
  const departed = judged.filter((r) => r.departure_delta_seconds !== null);
  return {
    lateCount: judged.filter((r) => r.outcome === "late").length,
    noDepartureCount: judged.filter((r) => r.outcome === "no_departure").length,
    departedCount: departed.length,
    avgDeltaSeconds: departed.length
      ? Math.round(departed.reduce((sum, r) => sum + (r.departure_delta_seconds ?? 0), 0) / departed.length)
      : null,
  };
}

function byScheduled(a: OnDemandDeparture, b: OnDemandDeparture): number {
  return (a.departure_scheduled ?? "").localeCompare(b.departure_scheduled ?? "") || a.duty_id.localeCompare(b.duty_id);
}

// Rows grouped for reading. By service day: newest first, and within a day
// the duties needing attention before the clean ones. By driver or vehicle
// (Spare ids, since that is all the duty carries): the groups with the most
// flagged duties first, so a repeat is the first thing on the page.
export function groupDuties(rows: OnDemandDeparture[], groupBy: DepartureGroupBy, today: string): DutyGroup[] {
  if (groupBy === "date") {
    const dates = [...new Set(rows.map((r) => r.service_date))].sort((a, b) => b.localeCompare(a));
    return dates.map((date) => {
      const members = rows
        .filter((r) => r.service_date === date)
        .sort((a, b) => OUTCOMES[a.outcome].rank - OUTCOMES[b.outcome].rank || byScheduled(a, b));
      return { key: date, title: serviceDayLabel(date), reference: null, referenceTitle: null, open: date >= today, ...summarize(members), rows: members };
    });
  }
  // A vehicle groups by its fleet number when Spare gave one (migration 099),
  // else by its Spare id; a driver only ever has an id.
  // A driver groups by Spare id (stable even before the name is known) and
  // is titled by name once the poll has resolved it, the identifier beside
  // it as the fixed-route view shows a badge. A vehicle groups by its fleet
  // number when Spare gave one (migration 099), else by its Spare id.
  const keyOf = groupBy === "operator"
    ? (r: OnDemandDeparture) => r.driver_id ?? ""
    : (r: OnDemandDeparture) => r.vehicle_identifier ?? r.vehicle_id ?? "";
  const noun = groupBy === "operator" ? "Driver" : "Vehicle";
  const keys = [...new Set(rows.map(keyOf))];
  return keys
    .map((key) => {
      const members = rows
        .filter((r) => keyOf(r) === key)
        .sort((a, b) => b.service_date.localeCompare(a.service_date) || byScheduled(a, b));
      const first = members[0];
      const fleet = groupBy === "vehicle" && first?.vehicle_identifier === key;
      const driverName = groupBy === "operator" ? (members.find((r) => r.driver_name)?.driver_name ?? null) : null;
      const driverIdentifier = groupBy === "operator" ? (members.find((r) => r.driver_identifier)?.driver_identifier ?? null) : null;
      // Grouped by fleet number the key is the number itself, so the Spare
      // id has to come off a row; grouped by anything else the key IS the
      // Spare id.
      const spareId = (fleet ? first?.vehicle_id : key) || null;
      let title: string;
      let reference: string | null;
      if (!key) { title = `No ${noun.toLowerCase()} on duty`; reference = null; }
      else if (fleet) { title = `Vehicle ${key}`; reference = shortRef(spareId); }
      else if (driverName) { title = driverName; reference = driverIdentifier ? `#${driverIdentifier}` : shortRef(spareId); }
      else if (driverIdentifier) { title = `Driver #${driverIdentifier}`; reference = shortRef(spareId); }
      // The title already carries the short reference; a second copy beside
      // it would say the same thing twice.
      else { title = `${noun} ${shortRef(key)}`; reference = null; }
      return {
        key,
        title,
        reference,
        referenceTitle: spareId ? `Spare ${noun.toLowerCase()} ${spareId}` : null,
        open: false,
        ...summarize(members),
        rows: members,
      };
    })
    .sort((a, b) => (b.lateCount + b.noDepartureCount) - (a.lateCount + a.noDepartureCount) || a.title.localeCompare(b.title));
}

// Flagged duties per service day in the window.
export function dailyFlagged(rows: OnDemandDeparture[], today: string, days: number): DailyCounts[] {
  return dailyCounts(rows, today, days, (r) => (r.outcome === "late" || r.outcome === "no_departure" ? r.outcome : null));
}

function percent(part: number, whole: number): string {
  return whole > 0 ? `${(100 * part / whole).toFixed(1)}%` : "—";
}

function avgLabel(seconds: number | null): string {
  return seconds === null ? "no departed duties" : `avg ${deltaMinutesLabel(seconds)}`;
}

const COLUMNS: Record<string, { label: string; hint: string; className?: string }> = {
  date: { label: "Service day", hint: "Central" },
  duty: { label: "Duty", hint: "Spare identifier" },
  operator: { label: "Operator", hint: "Spare driver" },
  vehicle: { label: "Vehicle", hint: "fleet no." },
  scheduled: { label: "Scheduled", hint: "and its source", className: "td-num" },
  actual: { label: "Actual", hint: "and its source", className: "td-num" },
  delta: { label: "Delta", hint: "", className: "td-num" },
  outcome: { label: "Outcome", hint: "" },
  // What a reviewer did with the outcome, as opposed to what the rule judged.
  assessment: { label: "Assessment", hint: "occurrence" },
};

// The Duty column exists for Spare's duty identifier. MVTA's duties carry
// none, so when no duty in view has one the column would be a row of
// fallback ids saying nothing a reader can use; it is left out and the Spare
// duty id rides on the row for lookup instead.
export function columnsFor(groupBy: DepartureGroupBy, withDutyIdentifiers: boolean): string[] {
  return ["date", "duty", "operator", "vehicle", "scheduled", "actual", "delta", "outcome", "assessment"]
    .filter((key) => key !== groupBy && (key !== "duty" || withDutyIdentifiers));
}

// On-Demand view of Garage Departures - Spare duty start tracking
// (Compliance tab). One row per duty: the start-location slot's scheduled
// and started times when Spare has one, else the duty's requested start and
// its first sighting in the service area. Same growing-log shape as the fixed
// route view, so it fetches on mount/range-change with a manual refresh.
export function OnDemandDepartures() {
  const { roles } = useAuth();
  const [days, setDays] = useState<number>(DEFAULT_DAYS);
  const [groupBy, setGroupBy] = useState<DepartureGroupBy>("date");
  const [show, setShow] = useState<Show>("all");
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
              ? "Departure history is not connected: OnDemandDepartures is missing, so no duty has been recorded yet. Apply migration 096b."
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
  const today = diagnostics?.settled_before ?? "";

  const visible = useMemo(
    () => (departures ?? []).filter((d) => show === "all" || isFlagged(d.outcome)),
    [departures, show],
  );
  const groups = useMemo(() => groupDuties(visible, groupBy, today), [visible, groupBy, today]);
  const daily = useMemo(() => (departures && today ? dailyFlagged(departures, today, days) : []), [departures, today, days]);
  const columns = columnsFor(groupBy, visible.some((d) => Boolean(d.duty_identifier)));

  // Same PATCH the Performance Assessment module's occurrence queue makes, so
  // a duty settled here and one settled there are indistinguishable after.
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const review: OccurrenceReviewHandlers = {
    busy: reviewing,
    canReview: roles.includes("OCC.Compliance") || roles.includes("OCC.ComplianceManager")
      || roles.includes("OCC.Publisher") || roles.includes("OCC.Admin"),
    onReview: (occurrenceId, attribution) => {
      setReviewing(true);
      setReviewError(null);
      void api.reviewComplianceOccurrence(
        occurrenceId,
        attribution === "contractor_error" ? "confirmed" : "dismissed",
        attribution,
        attribution === "contractor_error" ? undefined : `Attributed as ${attribution} from Garage Departures.`,
      )
        .then(() => load())
        .catch(() => setReviewError("The occurrence could not be updated."))
        .finally(() => setReviewing(false));
    },
  };

  // How the actuals were measured, for the reader who wants to know how much
  // of the average rests on Spare's own record versus an inference.
  const sourceMix = useMemo(() => {
    const measured = (departures ?? []).filter((d) => d.departure_actual !== null);
    const slot = measured.filter((d) => d.departure_source === "slots_startLocation").length;
    return measured.length ? `start slot ${percent(slot, measured.length)} · seen in service area ${percent(measured.length - slot, measured.length)}` : "no departed duties";
  }, [departures]);
  const undecided = diagnostics ? diagnostics.record_count - diagnostics.judged_count : 0;

  return (
    <>
      <div className="risk-refresh-bar" aria-label="On-demand departures controls">
        <label htmlFor="odd-days">Window</label>
        <select id="odd-days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {DAY_OPTIONS.map((d) => (
            <option value={d} key={d}>Last {d} days</option>
          ))}
        </select>
        <GroupByToggle id="odd-group" value={groupBy} onChange={setGroupBy} />
        <label htmlFor="odd-show">Show</label>
        <select id="odd-show" value={show} onChange={(e) => setShow(e.target.value as Show)}>
          <option value="all">All duties</option>
          <option value="flagged">Flagged only</option>
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

      {/* Same rule as the fixed route view: the numbers are withheld until the
          feed and its table are both live, because a zero is a claim. */}
      <div className="risk-stat-grid" aria-label="On-demand departures summary">
        <RiskStat
          value={connected ? diagnostics!.no_departure_count : "—"}
          label="No departure recorded"
          detail={connected ? `${percent(diagnostics!.no_departure_count, diagnostics!.judged_count)} of ${diagnostics!.judged_count} judged duties` : undefined}
          tone="danger"
        />
        <RiskStat
          value={connected ? diagnostics!.late_count : "—"}
          label={varianceMinutes !== null ? `Late over ${varianceMinutes} min` : "Late over allowance"}
          detail={connected ? `${percent(diagnostics!.late_count, diagnostics!.judged_count)} of judged duties` : undefined}
          tone="warning"
        />
        <RiskStat
          value={connected && diagnostics!.avg_delta_seconds != null ? deltaMinutesLabel(diagnostics!.avg_delta_seconds) : "—"}
          label="Avg delta, departed duties"
          detail={connected ? sourceMix : undefined}
          tone="muted"
        />
        <RiskStat
          value={connected ? diagnostics!.record_count : "—"}
          label="Duties in window"
          detail={connected ? `${diagnostics!.judged_count} judged · ${undecided} not settled, cancelled or unscheduled` : undefined}
          tone="accent"
        />
      </div>

      {connected && departures && departures.length > 0 ? (
        <DepartureTrend
          title="Late and undeparted duties by service day"
          daily={daily}
          lateLegend={`Late over ${varianceMinutes} min`}
          openLegend="Today, not settled"
        />
      ) : null}

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
      ) : visible.length === 0 ? (
        <div className="risk-empty-state">
          <strong>No flagged duties</strong>
          <span>Every judged duty in this window departed within the allowance.</span>
        </div>
      ) : (
        <>
          {reviewError ? <p className="risk-action-error">{reviewError}</p> : null}
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
                  <GroupRows key={group.key} group={group} groupBy={groupBy} columns={columns} review={review} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="departures-foot">
            Outcome applies the rule the compliance candidate poll uses: a settled duty with a scheduled start that never departed, or departed more than the allowance late, is raised for review. Driver names come from Spare's driver record and are filled in by the poll; a driver it has not resolved yet shows as the first eight characters of the Spare id, in full on hover.
          </p>
        </>
      )}
    </>
  );
}

function GroupRows({ group, groupBy, columns, review }: { group: DutyGroup; groupBy: DepartureGroupBy; columns: string[]; review: OccurrenceReviewHandlers }) {
  const flagged = group.lateCount + group.noDepartureCount;
  const meta = groupBy === "date" && group.open
    ? `${group.rows.length} duties so far · judged once the service day is over`
    : `${group.rows.length} duties · ${flagged} flagged${group.noDepartureCount ? ` (${group.noDepartureCount} no departure)` : ""} · ${avgLabel(group.avgDeltaSeconds)}`;
  return (
    <>
      <tr className="departure-band">
        <td colSpan={columns.length}>
          <div className="departure-band-line">
            <strong title={group.referenceTitle ?? undefined}>{group.title}</strong>
            {group.reference ? <span className="mono-ref" title={group.referenceTitle ?? undefined}>{group.reference}</span> : null}
            <span>{meta}</span>
            {groupBy === "date" && group.open ? <span className="pill-sm pill-accent">Not settled</span> : null}
            {groupBy !== "date" && flagged >= 2 ? <span className="pill-sm pill-warning">Repeat</span> : null}
          </div>
        </td>
      </tr>
      {group.rows.map((d) => (
        <tr key={d.duty_id} title={`Spare duty ${d.duty_id}`}>
          {columns.map((key) => (
            <DutyCell key={key} column={key} departure={d} review={review} />
          ))}
        </tr>
      ))}
    </>
  );
}

function DutyCell({ column, departure: d, review }: { column: string; departure: OnDemandDeparture; review: OccurrenceReviewHandlers }) {
  switch (column) {
    case "date":
      return <td className="td-dim">{serviceDayLabel(d.service_date)}</td>;
    case "duty":
      return d.duty_identifier
        ? <td><span className="td-fleet">{d.duty_identifier}</span></td>
        : <td><span className="mono-ref" title={d.duty_id}>duty {shortRef(d.duty_id)}</span></td>;
    case "operator":
      // The name once the poll has resolved it, with Spare's identifier as
      // the badge and its id on hover; the id's short reference until then.
      if (d.driver_name) {
        return (
          <td className="td-name" title={d.driver_id ? `Spare driver ${d.driver_id}` : undefined}>
            {d.driver_name}
            {d.driver_identifier ? <span className="mono-ref">#{d.driver_identifier}</span> : null}
          </td>
        );
      }
      if (d.driver_identifier) return <td className="td-name" title={d.driver_id ? `Spare driver ${d.driver_id}` : undefined}><span className="mono-ref">#{d.driver_identifier}</span></td>;
      return d.driver_id
        ? <td><span className="mono-ref" title={d.driver_id}>{shortRef(d.driver_id)}</span></td>
        : <td><span className="td-absent">No driver on duty</span></td>;
    case "vehicle":
      // The fleet number when Spare gave one, with the Spare id on hover;
      // the id's short reference stands in when it did not.
      return d.vehicle_identifier
        ? <td><span className="td-fleet" title={d.vehicle_id ? `Spare vehicle ${d.vehicle_id}` : undefined}>{d.vehicle_identifier}</span></td>
        : d.vehicle_id
          ? <td><span className="mono-ref" title={d.vehicle_id}>{shortRef(d.vehicle_id)}</span></td>
          : <td><span className="td-absent">No vehicle on duty</span></td>;
    case "scheduled": {
      const source = scheduledSourceLabel(d.scheduled_source);
      return (
        <td className="td-num td-dim">
          {agencyTimeLabel(d.departure_scheduled)}
          {source ? <span className="td-subtle">{source}</span> : null}
        </td>
      );
    }
    case "actual": {
      const source = actualSourceLabel(d.departure_source);
      return (
        <td className="td-num td-dim">
          {agencyTimeLabel(d.departure_actual)}
          {source ? <span className="td-subtle">{source}</span> : null}
        </td>
      );
    }
    case "delta":
      return <td className={`td-num${d.outcome === "late" ? " td-over" : ""}`}>{deltaMinutesLabel(d.departure_delta_seconds)}</td>;
    case "outcome": {
      const o = OUTCOMES[d.outcome];
      return <td><span className={`pill-sm ${o.pill}`}>{o.label}</span></td>;
    }
    case "assessment":
      return <OccurrenceCell link={d} serviceDate={d.service_date} busy={review.busy} canReview={review.canReview} onReview={review.onReview} />;
    default:
      return <td></td>;
  }
}
