// How one on-demand duty departure is judged, for GET /on-demand-departures.
// The on-demand counterpart of fixedRouteDepartureOutcome.ts, mirroring
// onDemandDepartureCandidatePredicate() in complianceCandidatesPoll.ts clause
// for clause: service day settled, a scheduled start, the duty not cancelled,
// and either no departure from either source or one past the allowance. Late
// and no_departure are what the poll raises as GARAGE_DEPARTURE candidates;
// the rest say why a row is not one.
//
// The row-level no_departure flag the SQL computes against the database clock
// is not consulted: a duty is judged once its service day is over, the same
// as a fixed-route run, so that a candidate is never raised against a duty
// that is still in progress.
export type OnDemandDepartureOutcome =
  | "late"
  | "no_departure"
  | "departed"
  | "cancelled"
  | "no_schedule"
  | "not_settled";

export interface OnDemandDepartureJudgement {
  service_date: string;
  duty_status: string | null;
  departure_scheduled: Date | string | null;
  departure_actual: Date | string | null;
  departure_delta_seconds: number | null;
}

export function onDemandDepartureOutcome(
  row: OnDemandDepartureJudgement,
  varianceSeconds: number,
  settledBefore: string,
): OnDemandDepartureOutcome {
  if (row.service_date >= settledBefore) return "not_settled";
  if ((row.duty_status ?? "").toLowerCase() === "cancelled") return "cancelled";
  if (row.departure_scheduled === null) return "no_schedule";
  if (row.departure_actual === null) return "no_departure";
  if (row.departure_delta_seconds !== null && row.departure_delta_seconds > varianceSeconds) return "late";
  return "departed";
}

// A duty counts toward the summary once its day is settled and it had a
// departure to make: departed (late or not) or never departed.
export function isJudged(outcome: OnDemandDepartureOutcome): boolean {
  return outcome === "late" || outcome === "no_departure" || outcome === "departed";
}
