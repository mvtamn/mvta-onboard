// Reading the Missed-trip case queue.
//
// The module already owns every write (index.ts) and every classification
// (classify.ts). Reads were the third act, and they lived inside the HTTP
// handlers: GET /missed-trips carried the list, thirteen totals, the paging
// rules and the occurrence join in its own body, and
// GET /missed-trips-monthly-summary stated the same "what counts as a finding"
// rule again as its own WHERE. Neither could be exercised except over HTTP.
//
// The invariant worth holding is that the list and its totals are one answer:
// a tile must never count rows its list omits. They are two queries over the
// same CROSS APPLY, so nothing but a test can hold that - see the list/totals
// case in missedTripCase.db.contract.test.ts.
//
// Handlers keep the wire shape. This returns a domain value; turning it into
// MissedTripsDiagnostics, with feed health and detection settings beside it,
// stays the handler's business - the module has no reason to know what JSON
// the console expects.
import { sql } from "../db";
import { occurrenceSourceRefSql } from "../occurrenceIntake/sources";
import { missedTripCaseSql } from "./classify";
import type { MissedTripEvidenceFinding, MissedTripLifecycle, MissedTripReviewOutcome } from "./types";

export type CaseView = "queue" | "history" | "all";

export const DEFAULT_CASE_LIMIT = 200;
export const MAX_CASE_LIMIT = 2000;

export interface CaseQuery {
  view: CaseView;
  limit: number;
  offset: number;
}

// The query as asked for over HTTP, clamped. Anything unreadable falls back to
// the default rather than refusing: this is a read-only list, and a bad limit
// in a bookmarked URL should show the first page, not an error.
export function caseQuery(raw: { view?: string | null; limit?: string | null; offset?: string | null }): CaseQuery {
  const view: CaseView = raw.view === "history" || raw.view === "all" ? raw.view : "queue";
  const requestedLimit = Number(raw.limit ?? String(DEFAULT_CASE_LIMIT));
  const limit = Number.isInteger(requestedLimit) ? Math.min(MAX_CASE_LIMIT, Math.max(1, requestedLimit)) : DEFAULT_CASE_LIMIT;
  const requestedOffset = Number(raw.offset ?? "0");
  const offset = Number.isInteger(requestedOffset) ? Math.max(0, requestedOffset) : 0;
  return { view, limit, offset };
}

export interface CaseListRow {
  trip_id: string;
  service_date: string;
  route_id: string;
  scheduled_departure_at: Date;
  grace_deadline_at: Date;
  status: string;
  detection_type: string | null;
  detected_late_arrival_at: Date | null;
  suggested_alert_id: string | null;
  first_seen_watching_at: Date;
  last_checked_at: Date;
  validation_status: string;
  occurrence_review_status?: string | null;
  occurrence_attribution?: string | null;
  occurrence_service_month?: string | null;
  occurrence_period_status?: string | null;
  reason_code: string | null;
  validated_by: string | null;
  validated_at: Date | null;
  notes: string | null;
  detector_version: string | null;
  data_quality_status: string;
  // Why this row is not (yet) a finding - see migration 121. Null on a decided
  // row, and on every row in an environment that has not applied it.
  undecided_reason: string | null;
  source_system: string;
  source_record_id: string | null;
  // The module's classification, CROSS APPLYed onto every row. The handler
  // used to declare a row type without these even though the query returned
  // them, so the console read columns nothing on the server named.
  lifecycle: MissedTripLifecycle;
  evidence_finding: MissedTripEvidenceFinding;
  review_outcome: MissedTripReviewOutcome | null;
  held_reason: string | null;
  in_queue: boolean;
  concluded: boolean;
  // ADR-0035: two exact-matched sources disagree. The console does not render
  // this yet; the queue carries it so it can.
  evidence_conflict: boolean;
  evidence_conflict_reason: string | null;
  condition_late_start: boolean | null;
  condition_superseded: boolean | null;
  condition_late_arrival: boolean | null;
  start_delay_seconds: number | null;
  arrival_delay_seconds: number | null;
  // NB/SB/EB/WB from the static schedule (GtfsTripDirections, migration-007) -
  // same join tripDelays.ts already does for Live Delays. Null whenever the
  // trip isn't in that reference table yet, or the static feed couldn't
  // determine a direction for it.
  direction_label: string | null;
}

export interface CaseTotals {
  total_count: number;
  active_count: number;
  resolved_count: number;
  queue_count: number;
  history_count: number;
  legacy_count: number;
  data_gap_count: number;
  confirmed_count: number;
  false_positive_count: number;
  routes_affected_count: number;
  last_checked_at: Date | null;
  pending_confirmation_count: number;
  held_undecided_count: number;
}

export interface MissedTripsSummaryRow {
  service_month: string;
  route_id: string;
  source_system: string;
  detection_type: string | null;
  detector: string;
  lifecycle: string;
  evidence_finding: string;
  review_outcome: string | null;
  counts_as_missed: boolean;
  counts_toward_assessment: boolean;
  trip_count: number;
}

/** Whether this environment has the tables the queue reads. */
export interface CaseTablesReady {
  /** MonitoredMissedTrips exists. Nothing can be read without it. */
  cases: boolean;
  /**
   * ComplianceOccurrences exists, so a case can say where it landed in the
   * performance assessment. Absent, the list is returned without those
   * columns rather than failing.
   */
  occurrences: boolean;
}

// Both probes in one round trip. Each handler used to ask separately.
export async function caseTablesReady(pool: sql.ConnectionPool): Promise<CaseTablesReady> {
  const result = await pool.request().query<{ cases: number; occurrences: number }>(`
    SELECT CASE WHEN OBJECT_ID('dbo.MonitoredMissedTrips', 'U') IS NULL THEN 0 ELSE 1 END AS cases,
           CASE WHEN OBJECT_ID('dbo.ComplianceOccurrences', 'U') IS NULL THEN 0 ELSE 1 END AS occurrences
  `);
  const row = result.recordset[0];
  return { cases: row?.cases === 1, occurrences: row?.occurrences === 1 };
}

export type CaseReadResult =
  | { ready: false }
  | { ready: true; cases: CaseListRow[]; totals: CaseTotals };

// Legacy missed-trip records stay out of the queue: they came from the
// superseded detector and their outcome is unknown, not false. Held cases
// (Awaiting evidence) stay out too - waiting on a second poll, or silent for a
// reason other than the trip. Both remain available in view=all.
function viewFilter(view: CaseView): string {
  return view === "queue" ? "WHERE mtc.in_queue = 1"
    : view === "history" ? "WHERE mtc.concluded = 1"
      : "";
}

export async function readMissedTripCases(pool: sql.ConnectionPool, query: CaseQuery): Promise<CaseReadResult> {
  const ready = await caseTablesReady(pool);
  if (!ready.cases) return { ready: false };

  // Where each reviewed trip ended up in the performance assessment. The join
  // is by source_ref, the one reference lib/occurrenceIntake builds.
  const occurrenceColumns = ready.occurrences
    ? `,
           occ.review_status AS occurrence_review_status,
           occ.attribution AS occurrence_attribution,
           occ.service_month AS occurrence_service_month,
           period.status AS occurrence_period_status`
    : "";
  const occurrenceJoin = ready.occurrences
    ? `
    LEFT JOIN ComplianceOccurrences occ
      ON occ.source_ref = ${occurrenceSourceRefSql("missed_trip", "mmt")}
    LEFT JOIN AssessmentPeriods period
      ON period.contractor_id = occ.contractor_id AND period.service_month = occ.service_month`
    : "";

  const listReq = pool.request();
  listReq.input("offset", sql.Int, query.offset);
  listReq.input("limit", sql.Int, query.limit);
  const result = await listReq.query<CaseListRow>(`
    SELECT mmt.trip_id, mmt.service_date, mmt.route_id, mmt.scheduled_departure_at,
           mmt.grace_deadline_at, mmt.status, mmt.detection_type, mmt.detected_late_arrival_at,
           mmt.suggested_alert_id, mmt.first_seen_watching_at, mmt.last_checked_at,
           mmt.validation_status, mmt.reason_code, mmt.validated_by, mmt.validated_at, mmt.notes,
           mmt.detector_version, mmt.data_quality_status, mmt.undecided_reason,
           mtc.lifecycle, mtc.evidence_finding, mtc.review_outcome, mtc.held_reason, mtc.in_queue, mtc.concluded,
           mtc.evidence_conflict, mmt.evidence_conflict_reason,
           mmt.source_system, mmt.source_record_id,
           sme.condition_late_start, sme.condition_superseded, sme.condition_late_arrival,
           sme.start_delay_seconds, sme.arrival_delay_seconds,
           td.direction_label${occurrenceColumns}
    FROM MonitoredMissedTrips mmt ${missedTripCaseSql("mmt")}
    LEFT JOIN GtfsTripDirections td ON td.trip_id = mmt.trip_id
    LEFT JOIN SpareMissedTripEvaluations sme
      ON mmt.source_system = 'spare' AND sme.request_id = mmt.source_record_id${occurrenceJoin}
    ${viewFilter(query.view)}
    ORDER BY
      CASE mmt.validation_status WHEN 'unreviewed' THEN 0 ELSE 1 END,
      CASE mmt.status WHEN 'escalated' THEN 0 WHEN 'watching' THEN 1 ELSE 2 END,
      mmt.scheduled_departure_at DESC
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
  `);

  // The same CROSS APPLY the list read, so a tile cannot count rows the list
  // omits. The contract test asserts that over real rows.
  const totals = await pool.request().query<CaseTotals>(`
    SELECT
      COUNT(*) AS total_count,
      SUM(CASE WHEN mtc.concluded = 0 THEN 1 ELSE 0 END) AS active_count,
      SUM(CASE WHEN mtc.concluded = 1 THEN 1 ELSE 0 END) AS resolved_count,
      SUM(CAST(mtc.in_queue AS INT)) AS queue_count,
      SUM(CAST(mtc.concluded AS INT)) AS history_count,
      SUM(CAST(mtc.legacy AS INT)) AS legacy_count,
      -- Trips the detector could not decide because the evidence was not
      -- there to decide them, so the console can say how much went
      -- unmeasured instead of silently under-counting.
      SUM(CASE WHEN mtc.evidence_finding = N'indeterminate' THEN 1 ELSE 0 END) AS data_gap_count,
      SUM(CASE WHEN mtc.review_outcome = N'confirmed_missed_trip' THEN 1 ELSE 0 END) AS confirmed_count,
      SUM(CASE WHEN mtc.review_outcome = N'timely_service' THEN 1 ELSE 0 END) AS false_positive_count,
      COUNT(DISTINCT CASE WHEN mtc.flagged_missed = 1 THEN mmt.route_id END) AS routes_affected_count,
      MAX(mmt.last_checked_at) AS last_checked_at,
      SUM(CASE WHEN mtc.held_reason = N'awaiting_confirmation' THEN 1 ELSE 0 END) AS pending_confirmation_count,
      SUM(CASE WHEN mtc.held = 1 AND mtc.held_reason <> N'awaiting_confirmation' THEN 1 ELSE 0 END) AS held_undecided_count
    FROM MonitoredMissedTrips mmt ${missedTripCaseSql("mmt")}
  `);

  return { ready: true, cases: result.recordset, totals: totals.recordset[0] };
}

/** How many cases the chosen view holds, for the paging footer. */
export function viewCount(view: CaseView, totals: CaseTotals | undefined): number {
  return view === "queue" ? totals?.queue_count ?? 0
    : view === "history" ? totals?.history_count ?? 0
      : totals?.total_count ?? 0;
}

export type MonthlySummaryResult =
  | { ready: false }
  | { ready: true; summary: MissedTripsSummaryRow[] };

// The monthly rollup of cases that are findings - Ready for review or
// Reviewed. Held, open, closed-by-evidence and Legacy missed-trip records are
// excluded. The bucket is the module's own classification, not the stored
// validation_status: the console used to read that raw column and decide for
// itself what "confirmed" and "timely service" meant.
export async function readMissedTripMonthlySummary(pool: sql.ConnectionPool): Promise<MonthlySummaryResult> {
  if (!(await caseTablesReady(pool)).cases) return { ready: false };
  const result = await pool.request().query<MissedTripsSummaryRow>(`
    SELECT
      LEFT(m.service_date, 6) AS service_month,
      m.route_id,
      m.source_system,
      m.detection_type,
      mtc.detector,
      mtc.lifecycle,
      mtc.evidence_finding,
      mtc.review_outcome,
      mtc.counts_as_missed,
      mtc.counts_toward_assessment,
      COUNT(*) AS trip_count
    FROM MonitoredMissedTrips m ${missedTripCaseSql("m")}
    WHERE mtc.lifecycle IN (N'ready_for_review', N'reviewed')
    GROUP BY LEFT(m.service_date, 6), m.route_id, m.source_system, m.detection_type,
      mtc.detector, mtc.lifecycle, mtc.evidence_finding, mtc.review_outcome,
      mtc.counts_as_missed, mtc.counts_toward_assessment
    ORDER BY service_month DESC, route_id
  `);
  return { ready: true, summary: result.recordset };
}
