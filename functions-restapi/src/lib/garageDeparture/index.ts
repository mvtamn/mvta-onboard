// Garage departure: how one is judged, and the only place that judgement is
// written down.
//
// A Garage departure is the departure of an assigned vehicle from its garage
// or start location, measured as the variance between its scheduled and actual
// departure. One concept, one source per service type (ADR 0028) - Avail's
// Pullout Reports for fixed route, Spare's duties for on-demand.
//
// Everything that decides whether a departure is worth charging to the
// contractor lives behind this interface: the ladder, the allowance, and the
// settled-day guard. Callers judge a row with fixedRouteDepartureOutcome or
// onDemandDepartureOutcome, and build a WHERE clause with
// garageDepartureCandidatePredicate or onDemandDepartureCandidatePredicate.
// Both come off the same declaration, so the console's per-row judgement and
// what becomes a Compliance occurrence cannot disagree.
import { agencyServiceDate } from "../missedTripTime";
import type { JudgementParameters, JudgementRow } from "./conditions";
import {
  type FixedRouteDepartureOutcome,
  type OnDemandDepartureOutcome,
  fixedRouteRule,
  onDemandRule,
} from "./declarations";
import { judge, renderCandidatePredicate } from "./rule";

export {
  AGENCY_TIME_ZONE_SQL,
  type ColumnMap,
  type Condition,
  type FieldName,
  type JudgementParameters,
  type JudgementRow,
  evaluate,
  render,
} from "./conditions";
export {
  type Arm,
  type DepartureRule,
  assertLadderIsTotal,
  isCandidateOutcome,
  judge,
  renderCandidatePredicate,
} from "./rule";
export {
  DEPARTURE_OUTCOME_STATUSES,
  type FixedRouteDepartureOutcome,
  type OnDemandDepartureOutcome,
  fixedRouteRule,
  onDemandRule,
} from "./declarations";

// ---------------------------------------------------------------------------
// The allowance and the settled day
//
// These are only ever meaningful as inputs to the judgement, so this module is
// the one place they are exported from. They stay ARGUMENTS to the evaluator
// rather than being read inside it: what went wrong before was a caller
// reaching for a different clock - GET /on-demand-departures computes a
// no_departure bit against SYSUTCDATETIME() that the rule explicitly ignores -
// and a single import path fixes that without costing the evaluator its purity.

// How late a pullout must be before it is worth a contractor's review.
//
// Avail's PulloutStatus is a timing state, not an outcome. "Expired Pullout"
// says the scheduled pullout window elapsed - it does not say the bus never
// left, and in practice most of those runs do leave, a couple of minutes late.
// Raising a candidate on the status alone made roughly one pullout in seven a
// reviewable occurrence, which buries the reviewer and, because a period cannot
// be finalized while any candidate is unreviewed, blocks assessment behind a
// queue that is mostly dismissals.
//
// onboard-spare-integration-spec.md section 9.1 always intended a threshold
// ("flag rows exceeding a configurable variance threshold (e.g. >10 min
// late)"); the candidate rule simply never got one. Ten minutes is that
// example, overridable per environment while section 10's open item 9 - whether
// these thresholds should be admin-managed - is still undecided.
const DEFAULT_VARIANCE_MINUTES = 10;

export function garageDepartureVarianceSeconds(
  raw: string | undefined = process.env.GARAGE_DEPARTURE_VARIANCE_MINUTES,
): number {
  // An empty setting is an absent one. Number("") is 0, so trusting it would
  // read a blank app setting as a deliberate zero variance and make every late
  // departure reviewable - the exact flood this threshold exists to stop.
  const configured = raw?.trim();
  const parsed = configured ? Number(configured) : Number.NaN;
  const minutes = Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_VARIANCE_MINUTES;
  return Math.round(minutes * 60);
}

// The first service date that is NOT yet settled. A row on or after this is
// still in progress and nothing about it is judged.
//
// KNOWN WRONG, inherited unchanged and deliberately not fixed here. Avail
// publishes the next day's roster at 02:30 local and keeps updating it, so a
// service date is not actually frozen until 02:30 local TWO days later, while
// this calls it settled after one. complianceCandidatesPoll only gets away
// with it by running a full day behind; moving it earlier without fixing this
// would raise candidates against runs still in flight, which intake never
// withdraws. See the note in lib/availPullout.ts. Fixing it needs its own
// evidence and its own backfill, the way migration 138 got.
export function settledServiceDateExclusive(now: Date = new Date()): string {
  return agencyServiceDate(now).serviceDate;
}

// ---------------------------------------------------------------------------
// Judging a row
//
// Callers hold rows in their source's own column names; these adapt one to the
// rule's vocabulary. The shapes are unchanged from when each rule lived in its
// own file.

export interface FixedRouteDepartureJudgement {
  service_date: string;
  pullout_status: string | null;
  pullout_scheduled: Date | string | null;
  pullout_actual: Date | string | null;
  pullout_delta_seconds: number | null;
}

export interface OnDemandDepartureJudgement {
  service_date: string;
  duty_status: string | null;
  departure_scheduled: Date | string | null;
  departure_actual: Date | string | null;
  departure_delta_seconds: number | null;
}

function parameters(varianceSeconds: number, settledBefore: string): JudgementParameters {
  return { settled_before: settledBefore, variance_seconds: varianceSeconds };
}

export function fixedRouteDepartureOutcome(
  row: FixedRouteDepartureJudgement,
  varianceSeconds: number,
  settledBefore: string,
): FixedRouteDepartureOutcome {
  const judged: JudgementRow = {
    serviceDate: row.service_date,
    status: row.pullout_status,
    scheduled: row.pullout_scheduled,
    actual: row.pullout_actual,
    delta: row.pullout_delta_seconds,
  };
  return judge(fixedRouteRule, judged, parameters(varianceSeconds, settledBefore));
}

export function onDemandDepartureOutcome(
  row: OnDemandDepartureJudgement,
  varianceSeconds: number,
  settledBefore: string,
): OnDemandDepartureOutcome {
  const judged: JudgementRow = {
    serviceDate: row.service_date,
    status: row.duty_status,
    scheduled: row.departure_scheduled,
    actual: row.departure_actual,
    delta: row.departure_delta_seconds,
  };
  return judge(onDemandRule, judged, parameters(varianceSeconds, settledBefore));
}

// A duty counts toward the summary once its day is settled and it had a
// departure to make: departed (late or not) or never departed. Deliberately
// NOT derived from the ladder - it is a summary denominator, not a rule
// clause, and folding it in would model something the rule does not care
// about.
export function isJudged(outcome: OnDemandDepartureOutcome): boolean {
  return outcome === "late" || outcome === "no_departure" || outcome === "departed";
}

// ---------------------------------------------------------------------------
// The candidate predicates
//
// Both are DERIVED from the ladders above. Never hand-write one: a predicate
// that disagrees with the ladder charges a contractor for something the
// console says is fine, and intake never withdraws a candidate.
//
// Both bind @settled_before and @variance_seconds, which raiseCandidates
// supplies.

export function garageDepartureCandidatePredicate(alias = "d"): string {
  return renderCandidatePredicate(fixedRouteRule, alias);
}

export function onDemandDepartureCandidatePredicate(alias = "d"): string {
  return renderCandidatePredicate(onDemandRule, alias);
}
