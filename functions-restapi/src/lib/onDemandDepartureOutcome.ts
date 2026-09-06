// How one on-demand duty departure is judged, for GET /on-demand-departures.
// The on-demand counterpart of fixedRouteDepartureOutcome.ts, with one
// difference in kind: no compliance candidate is raised from these yet (ADR
// 0028 wants a source discriminator on the garage-departure MERGE first), so
// "late" and "no_departure" are what staff review here, not yet what a
// contractor is asked about.
//
// The time-based part of the rule - whether a duty with no recorded
// departure is past its allowance - is decided by the SQL that sets
// no_departure, against the database clock, and is not re-derived here.
export type OnDemandDepartureOutcome =
  | "late"
  | "no_departure"
  | "departed"
  | "pending"
  | "cancelled"
  | "no_schedule";

export interface OnDemandDepartureJudgement {
  duty_status: string | null;
  departure_scheduled: Date | string | null;
  departure_actual: Date | string | null;
  departure_delta_seconds: number | null;
  no_departure: boolean;
}

export function onDemandDepartureOutcome(row: OnDemandDepartureJudgement, varianceSeconds: number): OnDemandDepartureOutcome {
  if (row.duty_status === "cancelled") return "cancelled";
  if (row.departure_scheduled === null) return "no_schedule";
  if (row.no_departure) return "no_departure";
  if (row.departure_actual === null) return "pending";
  if (row.departure_delta_seconds !== null && row.departure_delta_seconds > varianceSeconds) return "late";
  return "departed";
}

// A duty counts toward the summary once its departure has been decided one
// way or the other: departed (late or not) or past its allowance with none.
export function isJudged(outcome: OnDemandDepartureOutcome): boolean {
  return outcome === "late" || outcome === "no_departure" || outcome === "departed";
}
