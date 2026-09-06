// What the two Garage Departures views share. Garage departure is one concept
// with one source per service type (ADR 0028), so the fixed-route and
// on-demand views read their sources through the same state model and speak
// the same labels; only the source and its columns differ.

export interface DepartureDiagnosticsBase {
  configured: boolean;
  table_ready: boolean;
  record_count: number;
  avg_delta_seconds: number | null;
}

export type MonitoringState = "loading" | "unavailable" | "live" | "not_configured" | "not_connected";

// Not-connected monitoring: a source that has not passed its activation gate
// cannot make claims about departure compliance. An unconfigured feed and a
// missing history table are both that state - the API answers 200 with an
// empty list either way, so reading that list as "no late departures" would
// report a silent zero for a module that has never been switched on. The
// remedy differs, so the two are named separately even though both suppress
// the summary. A failed request is not a not-connected source either: nothing
// is known about the feed, so it says so rather than blaming configuration.
export function monitoringState(diagnostics: DepartureDiagnosticsBase | null, loading: boolean): MonitoringState {
  if (!diagnostics) return loading ? "loading" : "unavailable";
  if (!diagnostics.configured) return "not_configured";
  if (!diagnostics.table_ready) return "not_connected";
  return "live";
}

export function badgeLabel(state: MonitoringState): string {
  if (state === "live") return "Live data";
  if (state === "loading") return "Checking";
  if (state === "unavailable") return "Unavailable";
  return "Not connected";
}

export function RiskStat({
  value,
  label,
  detail,
  tone,
}: {
  value: string | number;
  label: string;
  // A qualifying line under the label - what the number is a share of, or
  // what it excludes - so a count is never read without its denominator.
  detail?: string;
  tone: "danger" | "warning" | "muted" | "accent";
}) {
  return (
    <div className={`risk-stat ${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

// --- Display helpers --------------------------------------------------------
// Service dates are agency-local CHAR(8) values and pullout instants are UTC
// ISO strings; both are shown in the agency's own zone so a reviewer outside
// Central sees the same day and time the poll recorded, and the same calendar
// day the Dispatch Log and Missed Trips show for the same run.
const AGENCY_TIME_ZONE = "America/Chicago";

export function serviceDayLabel(serviceDate: string): string {
  if (!/^\d{8}$/.test(serviceDate)) return serviceDate;
  const date = new Date(`${serviceDate.slice(0, 4)}-${serviceDate.slice(4, 6)}-${serviceDate.slice(6, 8)}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? serviceDate
    : date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

export function agencyTimeLabel(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("en-US", { timeZone: AGENCY_TIME_ZONE, hour: "numeric", minute: "2-digit" });
}

// The service dates of the last `count` days ending at `end` (inclusive),
// oldest first. Pure calendar arithmetic on the CHAR(8) form, so no zone is
// involved: the API already says which agency-local day is "today".
export function serviceDaysEnding(end: string, count: number): string[] {
  if (!/^\d{8}$/.test(end) || count < 1) return [];
  const endUtc = Date.UTC(Number(end.slice(0, 4)), Number(end.slice(4, 6)) - 1, Number(end.slice(6, 8)));
  const days: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(endUtc - i * 86_400_000);
    days.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`);
  }
  return days;
}

// Avail sends the operator as "LAST, FIRST -badge" in capitals. The badge is
// what dispatch looks an operator up by and the name is what a reviewer
// reads, so they are split: the name cased for reading, the badge kept as a
// reference. A string with no badge is shown as sent, cased.
export interface OperatorParts {
  name: string;
  badge: string | null;
}

export function operatorParts(raw: string | null): OperatorParts | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(.*?)\s*-\s*(\d+)\s*$/);
  const source = match ? match[1] : trimmed;
  const name = source.toLowerCase().replace(/(^|[\s,'\-])([a-z])/g, (_m, lead: string, letter: string) => lead + letter.toUpperCase());
  return { name, badge: match ? match[2] : null };
}

// Minutes with a sign, and a real minus for early. Zero is "0 min" rather
// than "On time": the allowance, not zero, is the standard, so a clean
// departure is said by the Outcome column and not by the delta.
export function deltaMinutesLabel(seconds: number | null): string {
  if (seconds === null) return "—";
  const minutes = Math.round(seconds / 60);
  if (minutes === 0) return "0 min";
  return minutes > 0 ? `+${minutes} min` : `−${Math.abs(minutes)} min`;
}

// Spare identifies drivers, vehicles and duties by id only. The first eight
// characters are enough to tell two rows for the same driver apart on a page;
// the full id rides on the element's title for lookup.
export function shortRef(id: string | null): string | null {
  const trimmed = id?.trim();
  return trimmed ? `${trimmed.slice(0, 8)}…` : null;
}

// --- Per-day strip -----------------------------------------------------------
export interface DailyCounts {
  date: string;
  late: number;
  noDeparture: number;
  // The day is over; its counts are final. Today's are still moving.
  settled: boolean;
}

// One entry per service day in the window ending today, including days with
// no rows, so the strip's spacing is calendar time and a quiet day shows as
// quiet. `classify` says which rows count, and as what.
export function dailyCounts<T extends { service_date: string }>(
  rows: readonly T[],
  today: string,
  days: number,
  classify: (row: T) => "late" | "no_departure" | null,
): DailyCounts[] {
  return serviceDaysEnding(today, days).map((date) => {
    const day = rows.filter((r) => r.service_date === date);
    return {
      date,
      late: day.filter((r) => classify(r) === "late").length,
      noDeparture: day.filter((r) => classify(r) === "no_departure").length,
      settled: date < today,
    };
  });
}

function dayTick(date: string): string {
  const d = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? date.slice(6, 8) : `${d.toLocaleDateString("en-US", { weekday: "short" }).slice(0, 2)} ${d.getDate()}`;
}

function isWeekend(date: string): boolean {
  const d = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T12:00:00`);
  return d.getDay() === 0 || d.getDay() === 6;
}

export function DepartureTrend({
  title,
  daily,
  lateLegend,
  openLegend,
}: {
  title: string;
  daily: DailyCounts[];
  lateLegend: string;
  openLegend: string;
}) {
  const max = Math.max(1, ...daily.map((d) => d.late + d.noDeparture));
  return (
    <div className="departure-trend" aria-label={title}>
      <div className="departure-trend-head">
        <h4>{title}</h4>
        <div className="departure-trend-legend">
          <span><i className="nodep"></i>No departure</span>
          <span><i className="late"></i>{lateLegend}</span>
          <span><i className="late open"></i>{openLegend}</span>
        </div>
      </div>
      <div className="departure-trend-bars" style={{ gridTemplateColumns: `repeat(${daily.length}, minmax(0, 1fr))` }}>
        {daily.map((day) => (
          <div
            key={day.date}
            className={`departure-trend-day${day.settled ? "" : " open"}${isWeekend(day.date) ? " weekend" : ""}`}
            title={`${serviceDayLabel(day.date)}: ${day.noDeparture} no departure, ${day.late} late${day.settled ? "" : " (still moving)"}`}
          >
            <div className="departure-trend-col">
              <div className="bar late" style={{ height: `${Math.round((day.late / max) * 62)}px` }}></div>
              <div className="bar nodep" style={{ height: `${Math.round((day.noDeparture / max) * 62)}px` }}></div>
            </div>
            <span className="departure-trend-n">{day.late + day.noDeparture}</span>
            <span className="departure-trend-lbl">{dayTick(day.date)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// The Group by control both views share.
export type DepartureGroupBy = "date" | "operator" | "vehicle";

export function GroupByToggle({ id, value, onChange }: { id: string; value: DepartureGroupBy; onChange: (next: DepartureGroupBy) => void }) {
  return (
    <>
      <label id={`${id}-label`}>Group by</label>
      <div className="risk-view-toggle risk-view-toggle-sm" role="tablist" aria-labelledby={`${id}-label`}>
        {([["date", "Service day"], ["operator", "Operator"], ["vehicle", "Vehicle"]] as const).map(([key, label]) => (
          <button key={key} role="tab" aria-selected={value === key} className={value === key ? "active" : ""} onClick={() => onChange(key)}>
            {label}
          </button>
        ))}
      </div>
    </>
  );
}
