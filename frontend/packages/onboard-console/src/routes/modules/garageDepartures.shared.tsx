// What the two Garage Departures views share. Garage departure is one concept
// with one source per service type (ADR 0028), so the fixed-route and
// on-demand views read their sources through the same state model and speak
// the same labels; only the source and its columns differ.

export function dateTimeLabel(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function deltaLabel(seconds: number | null): string {
  if (seconds === null) return "—";
  const minutes = Math.round(seconds / 60);
  if (minutes === 0) return "On time";
  return minutes > 0 ? `+${minutes} min` : `${minutes} min`;
}

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
