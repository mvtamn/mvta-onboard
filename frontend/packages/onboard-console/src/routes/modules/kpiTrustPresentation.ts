import type { KpiTrustDependency, KpiTrustStream, KpiTrustStreamName } from "@mvta/shared";

// One vocabulary for a KPI trust state wherever an administrator meets it.
export function kpiTrustStateLabel(state: KpiTrustStream["state"]): string {
  return state === "current_but_empty" ? "Current · no records" : state.replaceAll("_", " ");
}

export function kpiTrustStateTone(state: KpiTrustStream["state"]): "success" | "warning" | "danger" {
  if (state === "current") return "success";
  if (state === "current_but_empty" || state === "stale") return "warning";
  return "danger";
}

// Streams are named for the contract, not for a reader. They are shown
// together on the Admin Integrations & Data Health page, away from the module
// each one backs, so every label has to say which KPI it is about on its own:
// two streams labelled "On-demand" would be indistinguishable there.
export const STREAM_LABELS: Record<KpiTrustStreamName, string> = {
  fixed_route_delay: "Fixed route delays",
  fixed_route_departures: "Fixed route departures",
  on_demand_departures: "On-demand departures",
  otp: "OTP",
  event_avl: "Event AVL",
  on_demand: "On-demand wait times",
  fixed_route_missed_trips: "Fixed route missed trips",
  spare_missed_trips: "On-demand missed trips",
};

// The console module whose actions each stream gates, so a card says where a
// stale stream will be felt.
export const STREAM_MODULES: Record<KpiTrustStreamName, string> = {
  fixed_route_delay: "Fixed Route Service Risk",
  fixed_route_departures: "Garage Departures",
  on_demand_departures: "Garage Departures",
  otp: "OTP Compliance",
  event_avl: "Event Monitoring",
  on_demand: "On-Demand Service Quality",
  fixed_route_missed_trips: "Missed Trips",
  spare_missed_trips: "Missed Trips",
};

// Every stream the console knows about, in label order. A stream added to the
// contract map shows up on the Admin page through this list alone.
export const KPI_TRUST_STREAMS = Object.keys(STREAM_LABELS) as KpiTrustStreamName[];

// Attention first: what is broken outranks what is merely quiet, which
// outranks what is fine. Ties keep label order so the board is stable.
const STATE_RANK: Record<KpiTrustStream["state"], number> = {
  unavailable: 0,
  stale: 1,
  current_but_empty: 2,
  current: 3,
};

export function rankTrustState(state: KpiTrustStream["state"]): number {
  return STATE_RANK[state];
}

// ISO-8601 sorts lexicographically in chronological order, so the raw value is
// what gets compared. A formatted label must never be sorted: "11:00 AM"
// precedes "9:00 AM" as text.
//
// Only dependencies with a freshness contract count. A monthly feed with no
// approved deadline is legitimately days old, and would otherwise sit in the
// summary as the "oldest" every single day, teaching staff to ignore it.
export function oldestRequiredDependency(
  streams: readonly KpiTrustStream[],
): KpiTrustDependency | null {
  return streams
    .flatMap((stream) => stream.dependencies)
    .filter((dependency) => dependency.required && dependency.last_success_at && dependency.stale_after_minutes !== null)
    .sort((a, b) => (a.last_success_at as string).localeCompare(b.last_success_at as string))[0] ?? null;
}

export function feedDisplayName(feedName: string): string {
  return feedName.replaceAll("_", " ");
}

export function contractLabel(dependency: KpiTrustDependency): string {
  return dependency.stale_after_minutes === null
    ? "deadline pending"
    : `${dependency.stale_after_minutes}-minute contract`;
}

const CLOCK: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
const DATE_CLOCK: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
const DATE: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };

// Times from today read as a clock; anything older carries its date, so a
// stale monthly feed cannot pass for this morning's.
export function whenLabel(iso: string, now = new Date()): string {
  const at = new Date(iso);
  return at.toDateString() === now.toDateString()
    ? at.toLocaleTimeString([], CLOCK)
    : at.toLocaleString([], DATE_CLOCK);
}

export function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString([], DATE);
}
