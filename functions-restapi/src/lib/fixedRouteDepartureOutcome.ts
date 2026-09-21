// How one fixed-route garage departure is judged, shared by the compliance
// candidate poll (which raises occurrences from it) and GET
// /fixed-route-departures (which shows staff the same judgement per row).
// One implementation, so the console's summary can never disagree with what
// becomes a compliance occurrence.
//
// Why exactly these statuses, and why the settled-day guard, is argued at
// length in functions/complianceCandidatesPoll.ts; this file only holds the
// rule. Change it there in spirit and here in code.
export const DEPARTURE_OUTCOME_STATUSES = [
  "Missed Pullout",
  "Missed Login",
  "Expired Pullout",
  "Late Pullout",
] as const;

// The judgement of one row. Two of these are what the candidate poll raises:
//   late          - departed more than the allowance late
//   no_departure  - never departed
// The rest explain why a row is not a candidate:
//   departed      - departed within the allowance (or Avail settled it clean)
//   unresolved    - service day is over, no actual, but Avail never settled
//                   the status into a departure outcome (a blank status, or
//                   On Route No Pullout); a data question, not a breach
//   no_schedule   - no scheduled pullout to have missed; a gap in the source
//                   (including Avail's midnight placeholder, below)
//   not_settled   - the service day is still in progress, so the status has
//                   not stopped moving and nothing is judged yet
export type FixedRouteDepartureOutcome =
  | "late"
  | "no_departure"
  | "departed"
  | "unresolved"
  | "no_schedule"
  | "not_settled";

export interface FixedRouteDepartureJudgement {
  service_date: string;
  pullout_status: string | null;
  pullout_scheduled: Date | string | null;
  pullout_actual: Date | string | null;
  pullout_delta_seconds: number | null;
}

// Avail publishes a run with no committed pullout time as midnight, not as an
// absent one. In 38 days of feed not one row has arrived with a NULL
// pullout_scheduled, so the IS NOT NULL guard below has never once fired -
// while 694 rows arrived scheduled at exactly 00:00:00. Every one of those 694
// is a Missed Pullout or a Missed Login, not one has ever recorded a
// departure, and they are the same 18 blocks every day - among them 2222,
// 3333, 4444, 5555, 6666, 7777 and 9999, which are placeholders rather than
// service. They were roughly 18 of the ~21 candidates raised per night, so the
// guard that was written to keep source gaps out of the assessment was in fact
// letting almost all of them through.
//
// Matching the time is what the null check was meant to do. A run genuinely
// scheduled to leave the garage at midnight is suppressed by this too, and
// that is the right trade: fixed route operates 04:00 to midnight, so midnight
// is when buses pull IN, and no midnight pullout has ever been observed to
// happen.
function scheduledAtAgencyMidnight(scheduled: Date | string): boolean {
  // Avail's timestamps are agency-local wall clock carrying no zone, and they
  // are stored and read back digit for digit, so the UTC accessors report the
  // agency-local time rather than a converted one.
  if (scheduled instanceof Date) {
    return scheduled.getUTCHours() === 0 && scheduled.getUTCMinutes() === 0 && scheduled.getUTCSeconds() === 0;
  }
  return /[T ]00:00:00/.test(scheduled);
}

// Mirrors garageDepartureCandidatePredicate() in complianceCandidatesPoll.ts
// clause for clause: status in the outcome set, service day settled, a
// scheduled pullout, and either no actual or an actual past the allowance.
export function fixedRouteDepartureOutcome(
  row: FixedRouteDepartureJudgement,
  varianceSeconds: number,
  settledBefore: string,
): FixedRouteDepartureOutcome {
  if (row.service_date >= settledBefore) return "not_settled";
  if (row.pullout_scheduled === null || scheduledAtAgencyMidnight(row.pullout_scheduled)) return "no_schedule";
  const judged = (DEPARTURE_OUTCOME_STATUSES as readonly string[]).includes(row.pullout_status ?? "");
  if (row.pullout_actual === null) return judged ? "no_departure" : "unresolved";
  if (judged && row.pullout_delta_seconds !== null && row.pullout_delta_seconds > varianceSeconds) return "late";
  return "departed";
}
