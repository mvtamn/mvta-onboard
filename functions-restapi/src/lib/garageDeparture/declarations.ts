// The two garage-departure rules, one per service type.
//
// ADR 0028: garage departure is ONE concept with one source per service type,
// never both. That is why these are two declarations rather than one rule with
// a service-type flag - the fixed-route ladder turns on Avail's status ladder,
// the on-demand one has no status ladder to turn on, and burying that
// difference behind a parameter would hide the only thing that actually
// differs.
//
// What they share is this file's machinery: one vocabulary, one evaluator, one
// renderer. Change a clause here and both the console's per-row judgement and
// the candidate poll's WHERE clause change with it.
import type { DepartureRule } from "./rule";

// ---------------------------------------------------------------------------
// Fixed route - Avail Pullout Reports

// The statuses that describe how a run's DEPARTURE ended.
//
// Avail's PulloutStatus is a precedence-ordered ladder: a pullout row shows the
// single highest-precedence status that currently applies, so the value moves
// as the run progresses. The vendor's own table settles what each one means:
//
//   Missed Login (10) is NOT terminal. The Late Login note says a status "can
//   change from Missed Login to either Waiting for Pullout or Late Login" - it
//   means login has not happened YET.
//
//   Missed Pullout (14) is NOT terminal either: "no longer valid if the vehicle
//   is detected on Route".
//
//   Expired Pullout (16) is the settled one, and says so: it "takes precedence
//   over Missed Check In, Missed Log In, and Missed Pull Out after this timer
//   has expired".
//
//   On Route No Pullout (17) means the vehicle IS running - "the driver did not
//   log on before leaving the yard". A missing pullout RECORD, not a missing
//   departure, which is why it stays out of this list.
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
//   no_schedule   - no scheduled pullout to have missed; a gap in the source,
//                   which includes Avail's midnight placeholder
//   not_settled   - the service day is still in progress, so the status has
//                   not stopped moving and nothing is judged yet
export type FixedRouteDepartureOutcome =
  | "late"
  | "no_departure"
  | "departed"
  | "unresolved"
  | "no_schedule"
  | "not_settled";

// The ladder, in order. Read it top to bottom as "the first of these that is
// true is what happened".
//
// The status says the departure has been decided; the timestamps say what
// happened. Neither alone is enough: the status alone called a bus that left
// four minutes late a breach, and the timestamps alone would flag a run Avail
// has not finished classifying.
//
// A row with no scheduled pullout is deliberately not a candidate. There is no
// committed time to have missed, so it is a gap in the source rather than a
// breach, and the repo already refuses to turn absent evidence into a finding
// (see the unknown_data_gap handling in gtfsMissedTripsPoll).
//
// That gap arrives as MIDNIGHT, not as NULL, which is why two arms produce
// no_schedule. Avail has never sent a NULL pullout_scheduled in 38 days of
// feed, while 694 rows arrived scheduled at exactly midnight - the same 18
// placeholder blocks every day, among them 2222, 3333, 4444, 5555, 6666, 7777
// and 9999, not one of which has ever recorded a departure. They were roughly
// 18 of the ~21 candidates raised per night. A run genuinely scheduled to
// leave at midnight is suppressed by this too, and that is the right trade:
// fixed route operates 04:00 to midnight, so midnight is when buses pull IN.
export const fixedRouteRule: DepartureRule<FixedRouteDepartureOutcome> = {
  columns: {
    serviceDate: "service_date",
    status: "pullout_status",
    scheduled: "pullout_scheduled",
    actual: "pullout_actual",
    delta: "pullout_delta_seconds",
  },
  candidateOutcomes: ["late", "no_departure"],
  arms: [
    { when: [{ kind: "serviceDateAtOrAfter", param: "settled_before" }], outcome: "not_settled" },
    { when: [{ kind: "isNull", field: "scheduled" }], outcome: "no_schedule" },
    { when: [{ kind: "atAgencyMidnight", field: "scheduled" }], outcome: "no_schedule" },
    {
      when: [
        { kind: "isNull", field: "actual" },
        { kind: "valueIn", field: "status", values: DEPARTURE_OUTCOME_STATUSES },
      ],
      outcome: "no_departure",
    },
    // Reached only when there is no actual and the status is not a departure
    // outcome: Avail has not finished classifying the run.
    { when: [{ kind: "isNull", field: "actual" }], outcome: "unresolved" },
    {
      when: [
        { kind: "valueIn", field: "status", values: DEPARTURE_OUTCOME_STATUSES },
        { kind: "delayExceeds", param: "variance_seconds" },
      ],
      outcome: "late",
    },
    { when: [], outcome: "departed" },
  ],
};

// ---------------------------------------------------------------------------
// On demand - Spare duties

export type OnDemandDepartureOutcome =
  | "late"
  | "no_departure"
  | "departed"
  | "cancelled"
  | "no_schedule"
  | "not_settled";

// Spare has no status ladder, so a duty is judged on its timestamps alone once
// its day is settled. A cancelled duty had no departure to make. A duty with no
// scheduled start is a gap in the source, not a breach, for the same reason as
// the fixed-route rule above.
//
// There is no midnight-placeholder arm here: that is an Avail behaviour, and
// Spare records an absent start as absent.
export const onDemandRule: DepartureRule<OnDemandDepartureOutcome> = {
  columns: {
    serviceDate: "service_date",
    status: "duty_status",
    scheduled: "departure_scheduled",
    actual: "departure_actual",
    delta: "departure_delta_seconds",
  },
  candidateOutcomes: ["late", "no_departure"],
  arms: [
    { when: [{ kind: "serviceDateAtOrAfter", param: "settled_before" }], outcome: "not_settled" },
    { when: [{ kind: "equalsIgnoringCase", field: "status", value: "cancelled" }], outcome: "cancelled" },
    { when: [{ kind: "isNull", field: "scheduled" }], outcome: "no_schedule" },
    { when: [{ kind: "isNull", field: "actual" }], outcome: "no_departure" },
    { when: [{ kind: "delayExceeds", param: "variance_seconds" }], outcome: "late" },
    { when: [], outcome: "departed" },
  ],
};
