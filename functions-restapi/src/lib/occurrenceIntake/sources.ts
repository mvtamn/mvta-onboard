// What each source observes that is worth an occurrence, and the reference
// that names that observation. The rules below decide which source rows become
// candidates; lib/occurrenceIntake decides whether a candidate is assigned,
// scored, and writable.
//
// The garage-departure rule itself is NOT here any more. It is declared once
// in lib/garageDeparture as an ordered ladder, and both the console's per-row
// judgement and the WHERE clauses below are derived from that one declaration
// - so a row is judged the same way on both sides by construction rather than
// by two pieces of code being kept in step. The allowance and the settled-day
// guard moved with it, and are re-exported here for callers that already
// import them from this module.
import type { KpiTrustState } from "../kpiTrust";
import { missedTripSourceRefSql } from "../missedTripCase/classify";

export {
  garageDepartureCandidatePredicate,
  garageDepartureVarianceSeconds,
  onDemandDepartureCandidatePredicate,
  settledServiceDateExclusive,
} from "../garageDeparture";

// The per-source gate the ADR asks for. A departure feed that is not
// trustworthy must not raise candidates, because a candidate is never
// withdrawn. Unlike the missed-trip gates, current-but-empty passes: this poll
// runs at 01:20 agency-local, when a departures feed has legitimately had
// nothing to report for hours, and that quiet is not a reason to distrust
// yesterday's settled rows.
export function departureSourceAllowed(state: KpiTrustState | undefined): boolean {
  return state === "current" || state === "current_but_empty";
}

// The source of an occurrence. Its reference (source_ref) is the one key the
// intake dedupes on and relief reads the observing system from, so it is built
// and read here only. The formats predate this module and live in stored rows
// (migration 097 rewrote the fixed-route ones); they must not change.
//
// References name the source system, per ADR 0028, so one physical departure
// can never be raised twice against GARAGE_DEPARTURE: the fixed-route
// reference says avail_pullout and the on-demand one says spare_duties.
export type OccurrenceSourceKind = "missed_trip" | "fixed_route_departure" | "on_demand_departure";

export type OccurrenceSource =
  | { kind: "missed_trip"; system: "gtfs" | "spare"; record_id: string; service_date: string }
  | { kind: "fixed_route_departure"; service_date: string; block: string; run: string }
  // Keyed by duty id alone: OnDemandDepartures holds one row per duty, and a
  // duty is one departure however its service date is later revised.
  | { kind: "on_demand_departure"; duty_id: string };

export const FIXED_ROUTE_DEPARTURE_SOURCE = "avail_pullout";
export const ON_DEMAND_DEPARTURE_SOURCE = "spare_duties";

const PREFIX = {
  missed_trip: "MonitoredMissedTrips:",
  fixed_route_departure: `FixedRouteDepartures:${FIXED_ROUTE_DEPARTURE_SOURCE}:`,
  on_demand_departure: `OnDemandDepartures:${ON_DEMAND_DEPARTURE_SOURCE}:`,
} as const;

// The reference as a SQL expression over a source row. `alias` is the source
// table's alias: MonitoredMissedTrips, FixedRouteDepartures or OnDemandDepartures.
export function occurrenceSourceRefSql(kind: OccurrenceSourceKind, alias: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new TypeError("occurrenceSourceRefSql alias must be a plain identifier");
  if (kind === "missed_trip") return missedTripSourceRefSql(alias);
  if (kind === "fixed_route_departure") return `CONCAT(N'${PREFIX.fixed_route_departure}',${alias}.service_date,N'|',${alias}.block,N'|',${alias}.run)`;
  return `CONCAT(N'${PREFIX.on_demand_departure}',${alias}.duty_id)`;
}

// A stored reference read back. Null for a hand-entered occurrence, and for a
// reference no source here writes.
export function parseOccurrenceSource(ref: string | null | undefined): OccurrenceSource | null {
  if (!ref) return null;
  if (ref.startsWith(PREFIX.missed_trip)) {
    const rest = ref.slice(PREFIX.missed_trip.length);
    const colon = rest.indexOf(":"), bar = rest.lastIndexOf("|");
    const system = rest.slice(0, colon);
    if ((system !== "gtfs" && system !== "spare") || bar < colon) return null;
    return { kind: "missed_trip", system, record_id: rest.slice(colon + 1, bar), service_date: rest.slice(bar + 1) };
  }
  if (ref.startsWith(PREFIX.fixed_route_departure)) {
    const [service_date, block, run] = ref.slice(PREFIX.fixed_route_departure.length).split("|");
    if (block === undefined || run === undefined) return null;
    return { kind: "fixed_route_departure", service_date, block, run };
  }
  if (ref.startsWith(PREFIX.on_demand_departure)) return { kind: "on_demand_departure", duty_id: ref.slice(PREFIX.on_demand_departure.length) };
  return null;
}

// Which system observed a source, for outage relief (ADR 0012). Avail's CAD/AVL
// feeds both GTFS-RT and pullouts; Spare runs on-demand.
export type ObservingSystem = "Avail_CAD_AVL" | "Spare";

export function observingSystem(source: OccurrenceSource | null): ObservingSystem | null {
  if (!source) return null;
  if (source.kind === "missed_trip") return source.system === "spare" ? "Spare" : "Avail_CAD_AVL";
  return source.kind === "fixed_route_departure" ? "Avail_CAD_AVL" : "Spare";
}

// The same answer as a SQL CASE over a stored reference, so scoring and the
// report exclude the same rows the API labels.
export function observingSystemSql(refExpr: string): string {
  return `CASE WHEN ${refExpr} LIKE '${PREFIX.fixed_route_departure}%' THEN 'Avail_CAD_AVL' WHEN ${refExpr} LIKE '${PREFIX.missed_trip}gtfs:%' THEN 'Avail_CAD_AVL' WHEN ${refExpr} LIKE '${PREFIX.missed_trip}spare:%' THEN 'Spare' WHEN ${refExpr} LIKE '${PREFIX.on_demand_departure}%' THEN 'Spare' END`;
}
