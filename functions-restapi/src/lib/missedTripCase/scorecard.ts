// The Detector scorecard: the evidence a promotion decision is made on.
//
// ADR-0036 made promotion a dated decision carrying "the measured precision and
// sample size it was decided on", and CONTEXT sets the bar - a complete service
// week at 95 percent precision, with indeterminate and unmatched cases reported
// separately. Nothing measured any of that: whoever filled the promotion form
// had to count reviewer outcomes by hand. This does the counting, per detector
// family and per service date or week, against the three things that can say a
// detector was right or wrong:
//
//   - Reviewers. A reviewed case's outcome is the ground truth precision is
//     measured on. Confirmed counts for the detector; Timely service and
//     Partial-service failure count against it (it said a whole run was
//     missed); Indeterminate is reported apart, as the bar asks.
//   - Avail's retrospective report (ADR-0035). An exact or reviewer-confirmed
//     link corroborates a case. A whole-trip miss Avail reported that no
//     flagged case accounts for is a miss the detectors did not catch - the
//     only measure of recall there is. Every Avail record is already kept, one
//     row each, in AvailEvidenceLinks (migration 136), so recall is read from
//     there rather than from a per-run tally.
//   - The Dispatch Log. A dispatcher who saw the trip leave on time disagrees
//     with the case; one who did not see it agrees; and a trip they did not see
//     with no case is another miss.
//
// Classification is classify.ts's, through missedTripCaseSql. Nothing here
// re-derives what held, reviewed or ready for review means.
import { sql } from "../db";
import { missedTripCaseSql } from "./classify";
import { PRECISION_BAR, SERVICE_DATE_KEY } from "./promotion";
import { MISSED_TRIP_DETECTORS, type MissedTripDetector } from "./types";

export type ScorecardGrouping = "week" | "day";

export interface ScorecardQuery {
  /** First service date key (YYYYMMDD), inclusive. A week grouping starts on a Monday. */
  from: string;
  /** Last service date key, inclusive. A week grouping ends on a Sunday. */
  to: string;
  grouping: ScorecardGrouping;
}

export const DEFAULT_SCORECARD_WEEKS = 8;
export const MAX_SCORECARD_DAYS = 26 * 7;

const DAY_MS = 86_400_000;

function keyToDate(key: string): Date {
  return new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(4, 6)) - 1, Number(key.slice(6, 8))));
}

function dateToKey(date: Date): string {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

export function addDays(key: string, days: number): string {
  return dateToKey(new Date(keyToDate(key).getTime() + days * DAY_MS));
}

/** The Monday of the service week a date falls in. Service weeks run Monday to Sunday. */
export function weekStartOf(key: string): string {
  const weekday = keyToDate(key).getUTCDay(); // 0 = Sunday
  return addDays(key, -((weekday + 6) % 7));
}

const validKey = (value: string | null | undefined): value is string =>
  Boolean(value) && SERVICE_DATE_KEY.test(value!) && dateToKey(keyToDate(value!)) === value;

/**
 * The range as asked for over HTTP, made whole. A bad or missing date falls back
 * to the last eight service weeks rather than refusing - it is a read-only
 * report, and a bookmarked URL should show something. A week grouping is
 * widened to whole weeks, because a partial week can never meet the bar.
 */
export function scorecardQuery(
  raw: { from?: string | null; to?: string | null; group?: string | null },
  today: string,
): ScorecardQuery {
  const grouping: ScorecardGrouping = raw.group === "day" ? "day" : "week";
  let to = validKey(raw.to) ? raw.to : today;
  let from = validKey(raw.from) ? raw.from : addDays(weekStartOf(to), -7 * (DEFAULT_SCORECARD_WEEKS - 1));
  if (from > to) [from, to] = [to, from];
  if (grouping === "week") {
    from = weekStartOf(from);
    to = addDays(weekStartOf(to), 6);
  }
  if (keyToDate(to).getTime() - keyToDate(from).getTime() >= MAX_SCORECARD_DAYS * DAY_MS) {
    from = grouping === "week" ? addDays(weekStartOf(to), -(MAX_SCORECARD_DAYS - 7)) : addDays(to, -(MAX_SCORECARD_DAYS - 1));
  }
  return { from, to, grouping };
}

// ---------------------------------------------------------------------------
// What the database says, per service date

/** Case figures for one detector on one service date. */
export interface CaseDayRow {
  service_date: string;
  detector: MissedTripDetector;
  legacy: number;
  open: number;
  closed_by_evidence: number;
  held: number;
  awaiting_review: number;
  reviewed: number;
  confirmed: number;
  timely_service: number;
  partial_service_failure: number;
  indeterminate: number;
  evidence_conflicts: number;
  avail_corroborated: number;
  avail_partial: number;
  confirmed_without_avail: number;
  dispatcher_not_observed: number;
  dispatcher_on_time: number;
  dispatcher_left_late: number;
  review_minutes: number;
}

export interface HeldDayRow {
  service_date: string;
  detector: MissedTripDetector;
  reason: string;
  count: number;
}

/** Whole-trip misses Avail reported on one calendar date, and what became of them. */
export interface AvailDayRow {
  service_date: string;
  whole_misses: number;
  caught: number;
  linked_not_flagged: number;
  awaiting_reviewer: number;
  unmatched: number;
}

/** Dispatch Log observations on one service date. */
export interface DispatchDayRow {
  service_date: string;
  verifications: number;
  not_observed: number;
  caught: number;
}

// ---------------------------------------------------------------------------
// The scorecard

export interface DetectorPeriodFigures {
  detector: MissedTripDetector;
  cases: {
    /** Held, waiting for review, or reviewed: what the detector raised. */
    detected: number;
    open: number;
    closed_by_evidence: number;
    held: number;
    awaiting_review: number;
    reviewed: number;
    legacy: number;
    evidence_conflicts: number;
  };
  outcomes: { confirmed: number; timely_service: number; partial_service_failure: number; indeterminate: number };
  /** Confirmed over every decisive review (confirmed, Timely service, Partial-service failure). */
  precision: number | null;
  /** How many decisive reviews precision is measured on. */
  sample: number;
  held_reasons: { reason: string; count: number }[];
  /** Held cases and Indeterminate reviews, over everything detected. */
  unknown_rate: number | null;
  /** Fixed route only; null for on-demand, which Avail does not report. */
  avail: { corroborated: number; partial: number; confirmed_without_avail: number } | null;
  /** Fixed route only; the Dispatch Log does not cover on-demand. */
  dispatcher: { not_observed: number; observed_on_time: number; observed_left_late: number; agreement: number | null } | null;
  review: { reviewed: number; awaiting_review: number; average_hours_to_review: number | null };
  /** Week grouping only: whether this week supports a promotion, and why not. */
  bar: { complete: boolean; meets_bar: boolean; sentence: string } | null;
}

export interface ScorecardPeriod {
  start: string;
  end: string;
  /** Every service date in the period is over. */
  ended: boolean;
  detectors: DetectorPeriodFigures[];
  /** Fixed route as a whole: Avail names no detector, so a miss it reports belongs to neither family. */
  avail_recall: {
    whole_misses: number;
    caught: number;
    linked_not_flagged: number;
    awaiting_reviewer: number;
    unmatched: number;
    recall: number | null;
    unmatched_rate: number | null;
  } | null;
  dispatcher_recall: { verifications: number; not_observed: number; caught: number; missed: number; recall: number | null } | null;
}

export interface DetectorScorecard {
  from: string;
  to: string;
  grouping: ScorecardGrouping;
  precision_bar: number;
  /** Which comparison sources this database has. A missing one reports null figures, not zeros. */
  sources: { avail: boolean; dispatch_log: boolean };
  periods: ScorecardPeriod[];
}

const ratio = (top: number, bottom: number): number | null => (bottom > 0 ? top / bottom : null);
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

const SPARE_NOTE =
  " On-demand service quality also needs two complete service weeks and dispatcher agreement, which this scorecard does not measure.";

/** Whether a week supports promoting this detector, in the words the form will need. */
export function weekBar(
  figures: Pick<DetectorPeriodFigures, "detector" | "precision" | "sample" | "cases">,
  ended: boolean,
): { complete: boolean; meets_bar: boolean; sentence: string } {
  const waiting = figures.cases.awaiting_review + figures.cases.open;
  const complete = ended && waiting === 0;
  const note = figures.detector === "spare" ? SPARE_NOTE : "";
  let sentence: string;
  if (!ended) sentence = "This service week has not ended.";
  else if (waiting > 0) sentence = `${waiting} case(s) still waiting for review or a decision.`;
  else if (figures.sample === 0 || figures.precision === null) sentence = "No case was reviewed to a decision this week.";
  else if (figures.precision < PRECISION_BAR) {
    sentence = `${percent(figures.precision)} precision over ${figures.sample} case(s) is below ${PRECISION_BAR * 100}%.`;
  } else sentence = `${percent(figures.precision)} precision over ${figures.sample} case(s) meets the bar.${note}`;
  const meets = complete && figures.precision !== null && figures.sample > 0 && figures.precision >= PRECISION_BAR;
  return { complete, meets_bar: meets, sentence };
}

interface Bounds { start: string; end: string }

export function periodsOf(query: ScorecardQuery): Bounds[] {
  const periods: Bounds[] = [];
  const step = query.grouping === "week" ? 7 : 1;
  for (let start = query.from; start <= query.to; start = addDays(start, step)) {
    const end = addDays(start, step - 1);
    periods.push({ start, end: end > query.to ? query.to : end });
  }
  return periods;
}

const sum = <T>(rows: readonly T[], pick: (row: T) => number) => rows.reduce((total, row) => total + (Number(pick(row)) || 0), 0);

export interface ScorecardInputs {
  cases: readonly CaseDayRow[];
  held: readonly HeldDayRow[];
  /** Null when the database has no AvailEvidenceLinks. */
  avail: readonly AvailDayRow[] | null;
  /** Null when the database has no TripStartVerifications. */
  dispatch: readonly DispatchDayRow[] | null;
}

/** Rolls per-date rows up into periods and works out the rates. No I/O. */
export function buildScorecard(inputs: ScorecardInputs, query: ScorecardQuery, today: string): DetectorScorecard {
  const periods = periodsOf(query).map(({ start, end }): ScorecardPeriod => {
    const inPeriod = <T extends { service_date: string }>(row: T) => row.service_date >= start && row.service_date <= end;
    const ended = end < today;
    const detectors = MISSED_TRIP_DETECTORS.map((detector): DetectorPeriodFigures => {
      const rows = inputs.cases.filter((row) => row.detector === detector && inPeriod(row));
      const total = (pick: (row: CaseDayRow) => number) => sum(rows, pick);
      const held = total((r) => r.held);
      const awaiting = total((r) => r.awaiting_review);
      const reviewed = total((r) => r.reviewed);
      const outcomes = {
        confirmed: total((r) => r.confirmed),
        timely_service: total((r) => r.timely_service),
        partial_service_failure: total((r) => r.partial_service_failure),
        indeterminate: total((r) => r.indeterminate),
      };
      const sample = outcomes.confirmed + outcomes.timely_service + outcomes.partial_service_failure;
      const detected = held + awaiting + reviewed;
      const reasons = new Map<string, number>();
      for (const row of inputs.held.filter((r) => r.detector === detector && inPeriod(r))) {
        reasons.set(row.reason, (reasons.get(row.reason) ?? 0) + Number(row.count));
      }
      const fixedRoute = detector !== "spare";
      const dispatcher = {
        not_observed: total((r) => r.dispatcher_not_observed),
        observed_on_time: total((r) => r.dispatcher_on_time),
        observed_left_late: total((r) => r.dispatcher_left_late),
      };
      const figures: DetectorPeriodFigures = {
        detector,
        cases: {
          detected,
          open: total((r) => r.open),
          closed_by_evidence: total((r) => r.closed_by_evidence),
          held,
          awaiting_review: awaiting,
          reviewed,
          legacy: total((r) => r.legacy),
          evidence_conflicts: total((r) => r.evidence_conflicts),
        },
        outcomes,
        precision: ratio(outcomes.confirmed, sample),
        sample,
        held_reasons: [...reasons].map(([reason, count]) => ({ reason, count }))
          .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
        unknown_rate: ratio(held + outcomes.indeterminate, detected),
        avail: fixedRoute && inputs.avail !== null
          ? {
            corroborated: total((r) => r.avail_corroborated),
            partial: total((r) => r.avail_partial),
            confirmed_without_avail: total((r) => r.confirmed_without_avail),
          }
          : null,
        dispatcher: fixedRoute && inputs.dispatch !== null
          ? {
            ...dispatcher,
            // A dispatcher who saw the trip leave late saw it run: that disagrees too.
            agreement: ratio(dispatcher.not_observed, dispatcher.not_observed + dispatcher.observed_on_time + dispatcher.observed_left_late),
          }
          : null,
        review: {
          reviewed,
          awaiting_review: awaiting,
          average_hours_to_review: reviewed > 0 ? Math.round((total((r) => r.review_minutes) / reviewed / 60) * 10) / 10 : null,
        },
        bar: null,
      };
      if (query.grouping === "week") figures.bar = weekBar(figures, ended);
      return figures;
    });

    let availRecall: ScorecardPeriod["avail_recall"] = null;
    if (inputs.avail !== null) {
      const rows = inputs.avail.filter(inPeriod);
      const whole = sum(rows, (r) => r.whole_misses);
      const caught = sum(rows, (r) => r.caught);
      const notFlagged = sum(rows, (r) => r.linked_not_flagged);
      const unmatched = sum(rows, (r) => r.unmatched);
      availRecall = {
        whole_misses: whole,
        caught,
        linked_not_flagged: notFlagged,
        awaiting_reviewer: sum(rows, (r) => r.awaiting_reviewer),
        unmatched,
        // Probable links are left out until a reviewer places them.
        recall: ratio(caught, caught + notFlagged + unmatched),
        unmatched_rate: ratio(unmatched, whole),
      };
    }

    let dispatcherRecall: ScorecardPeriod["dispatcher_recall"] = null;
    if (inputs.dispatch !== null) {
      const rows = inputs.dispatch.filter(inPeriod);
      const notObserved = sum(rows, (r) => r.not_observed);
      const caught = sum(rows, (r) => r.caught);
      dispatcherRecall = {
        verifications: sum(rows, (r) => r.verifications),
        not_observed: notObserved,
        caught,
        missed: notObserved - caught,
        recall: ratio(caught, notObserved),
      };
    }

    return { start, end, ended, detectors, avail_recall: availRecall, dispatcher_recall: dispatcherRecall };
  });

  return {
    from: query.from,
    to: query.to,
    grouping: query.grouping,
    precision_bar: PRECISION_BAR,
    sources: { avail: inputs.avail !== null, dispatch_log: inputs.dispatch !== null },
    periods,
  };
}

// ---------------------------------------------------------------------------
// Reading it

// A case the detectors raised: what a reviewer was, or will be, asked about.
const FLAGGED = `mtc.lifecycle IN (N'awaiting_evidence', N'ready_for_review', N'reviewed')`;
const count = (predicate: string) => `SUM(CASE WHEN ${predicate} THEN 1 ELSE 0 END)`;
const live = `mtc.legacy = 0`;

// The Avail records that speak for a case: an exact link, or a probable one a
// reviewer placed. A retracted record no longer says anything.
const AVAIL_LINKED = `a.retracted_at IS NULL AND (a.match_confidence = N'exact' OR a.resolution = N'confirmed')`;

export function caseDaySql(sources: { avail: boolean; dispatch_log: boolean }): string {
  const availApply = sources.avail
    ? `OUTER APPLY (SELECT MAX(CASE WHEN a.entire_trip_missed = 1 THEN 1 ELSE 0 END) whole,
                           MAX(CASE WHEN a.entire_trip_missed = 0 THEN 1 ELSE 0 END) partial
                    FROM dbo.AvailEvidenceLinks a
                    WHERE a.trip_id = m.trip_id AND a.service_date = m.service_date AND ${AVAIL_LINKED}) av`
    : `OUTER APPLY (SELECT CAST(NULL AS INT) whole, CAST(NULL AS INT) partial) av`;
  const dispatchJoin = sources.dispatch_log
    ? `LEFT JOIN dbo.TripStartVerifications v ON v.service_date = LEFT(m.service_date, 8) AND v.trip_id = m.trip_id`
    : `OUTER APPLY (SELECT CAST(NULL AS NVARCHAR(20)) observation) v`;
  return `
    SELECT LEFT(m.service_date, 8) service_date, mtc.detector,
      ${count("mtc.legacy = 1")} legacy,
      ${count("mtc.lifecycle = N'open'")} [open],
      ${count("mtc.lifecycle = N'closed_by_evidence'")} closed_by_evidence,
      ${count("mtc.lifecycle = N'awaiting_evidence'")} held,
      ${count("mtc.lifecycle = N'ready_for_review'")} awaiting_review,
      ${count("mtc.lifecycle = N'reviewed'")} reviewed,
      ${count(`${live} AND mtc.review_outcome = N'confirmed_missed_trip'`)} confirmed,
      ${count(`${live} AND mtc.review_outcome = N'timely_service'`)} timely_service,
      ${count(`${live} AND mtc.review_outcome = N'partial_service_failure'`)} partial_service_failure,
      ${count(`${live} AND mtc.review_outcome = N'indeterminate'`)} indeterminate,
      ${count(`${live} AND mtc.evidence_conflict = 1`)} evidence_conflicts,
      ${count(`${FLAGGED} AND av.whole = 1`)} avail_corroborated,
      ${count(`${FLAGGED} AND ISNULL(av.whole, 0) = 0 AND av.partial = 1`)} avail_partial,
      ${count(`${live} AND mtc.review_outcome = N'confirmed_missed_trip' AND ISNULL(av.whole, 0) = 0`)} confirmed_without_avail,
      ${count(`${FLAGGED} AND v.observation = N'not_observed'`)} dispatcher_not_observed,
      ${count(`${FLAGGED} AND v.observation = N'observed_on_time'`)} dispatcher_on_time,
      ${count(`${FLAGGED} AND v.observation = N'observed_left_late'`)} dispatcher_left_late,
      -- Hours from when the case became decidable (its Expected operating
      -- window, else its deadline) to its review. Never negative.
      SUM(CASE WHEN mtc.lifecycle = N'reviewed' AND m.validated_at IS NOT NULL
               THEN CASE WHEN DATEDIFF(MINUTE, COALESCE(m.expected_window_end_at, m.grace_deadline_at), m.validated_at) > 0
                         THEN DATEDIFF(MINUTE, COALESCE(m.expected_window_end_at, m.grace_deadline_at), m.validated_at) ELSE 0 END
               ELSE 0 END) review_minutes
    FROM dbo.MonitoredMissedTrips m ${missedTripCaseSql("m")}
    ${availApply}
    ${dispatchJoin}
    WHERE LEFT(m.service_date, 8) BETWEEN @from AND @to
    GROUP BY LEFT(m.service_date, 8), mtc.detector`;
}

export const HELD_DAY_SQL = `
    SELECT LEFT(m.service_date, 8) service_date, mtc.detector, mtc.held_reason reason, COUNT(*) [count]
    FROM dbo.MonitoredMissedTrips m ${missedTripCaseSql("m")}
    WHERE LEFT(m.service_date, 8) BETWEEN @from AND @to AND mtc.held = 1
    GROUP BY LEFT(m.service_date, 8), mtc.detector, mtc.held_reason`;

// A rejected probable link is a reviewer saying "none of these": unmatched, as
// is an exact link whose case no longer exists.
export const AVAIL_DAY_SQL = `
    SELECT a.calendar_date service_date,
      COUNT(*) whole_misses,
      ${count("c.flagged = 1")} caught,
      ${count("c.flagged = 0")} linked_not_flagged,
      ${count("a.match_confidence = N'probable' AND a.resolution IS NULL")} awaiting_reviewer,
      ${count("c.flagged IS NULL AND NOT (a.match_confidence = N'probable' AND a.resolution IS NULL)")} unmatched
    FROM dbo.AvailEvidenceLinks a
    OUTER APPLY (SELECT MAX(CASE WHEN mtc.legacy = 0 AND ${FLAGGED} THEN 1 ELSE 0 END) flagged
                 FROM dbo.MonitoredMissedTrips m ${missedTripCaseSql("m")}
                 WHERE (a.match_confidence = N'exact' OR a.resolution = N'confirmed')
                   AND m.trip_id = a.trip_id AND m.service_date = a.service_date) c
    WHERE a.entire_trip_missed = 1 AND a.retracted_at IS NULL AND a.calendar_date BETWEEN @from AND @to
    GROUP BY a.calendar_date`;

export const DISPATCH_DAY_SQL = `
    SELECT v.service_date,
      COUNT(*) verifications,
      ${count("v.observation = N'not_observed'")} not_observed,
      ${count("v.observation = N'not_observed' AND c.flagged = 1")} caught
    FROM dbo.TripStartVerifications v
    OUTER APPLY (SELECT MAX(CASE WHEN mtc.legacy = 0 AND ${FLAGGED} THEN 1 ELSE 0 END) flagged
                 FROM dbo.MonitoredMissedTrips m ${missedTripCaseSql("m")}
                 WHERE m.trip_id = v.trip_id AND LEFT(m.service_date, 8) = v.service_date) c
    WHERE v.service_date BETWEEN @from AND @to
    GROUP BY v.service_date`;

async function sourcesPresent(pool: sql.ConnectionPool): Promise<{ avail: boolean; dispatch_log: boolean }> {
  const row = (await pool.request().query<{ avail: number; dispatch_log: number }>(`
    SELECT CASE WHEN OBJECT_ID('dbo.AvailEvidenceLinks','U') IS NULL THEN 0 ELSE 1 END avail,
           CASE WHEN OBJECT_ID('dbo.TripStartVerifications','U') IS NULL THEN 0 ELSE 1 END dispatch_log`)).recordset[0];
  return { avail: row?.avail === 1, dispatch_log: row?.dispatch_log === 1 };
}

export async function readDetectorScorecard(
  pool: sql.ConnectionPool,
  query: ScorecardQuery,
  today: string,
): Promise<DetectorScorecard> {
  const sources = await sourcesPresent(pool);
  const run = async <T>(text: string) => (await pool.request()
    .input("from", sql.Char(8), query.from)
    .input("to", sql.Char(8), query.to)
    .query<T>(text)).recordset;
  const [cases, held, avail, dispatch] = await Promise.all([
    run<CaseDayRow>(caseDaySql(sources)),
    run<HeldDayRow>(HELD_DAY_SQL),
    sources.avail ? run<AvailDayRow>(AVAIL_DAY_SQL) : Promise.resolve(null),
    sources.dispatch_log ? run<DispatchDayRow>(DISPATCH_DAY_SQL) : Promise.resolve(null),
  ]);
  return buildScorecard({ cases, held, avail, dispatch }, query, today);
}
