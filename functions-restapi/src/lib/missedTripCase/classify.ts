// One classification of a Missed-trip case, in TypeScript and in SQL.
//
// Every reader asks the same questions - is this in the review queue, is it
// held, does it count as missed, does it count toward an assessment - and each
// used to answer them with its own WHERE clause over four status columns. They
// now read the answer: classifyMissedTripCase for a row in hand, and
// missedTripCaseSql for a query, which CROSS APPLYs the same columns onto
// MonitoredMissedTrips. missedTripCase.db.contract.test.ts runs both over the
// same rows and fails if they disagree.
import { isPromotedOn, promotionWindowsSql, type PromotionSource, type PromotionWindow } from "./promotion";
import {
  type MissedTripClassification,
  type MissedTripDetector,
  type MissedTripEvidenceFinding,
  type MissedTripLifecycle,
  type MissedTripReviewOutcome,
} from "./types";

// The stored columns classification depends on.
export interface ClassifiableCase {
  /** Service date key (YYYYMMDD); which day's promotion decision applies. */
  service_date: string;
  status: string;
  validation_status: string;
  data_quality_status: string;
  detection_type: string | null;
  source_system: string | null;
  undecided_reason: string | null;
  grace_deadline_at: Date;
  detected_late_arrival_at: Date | null;
  detector_version: string | null;
  expected_window_end_at: Date | null;
}

// Silent no-shows from this detector version carry an Expected operating
// window, and wait for it to end before they are Ready for review. Earlier
// versions' cases have no window and are not held for one.
export const WINDOWED_DETECTOR_VERSION = "gtfs-silent-v4";
export const AWAITING_OPERATING_WINDOW = "awaiting_operating_window";

export function detectorOf(row: Pick<ClassifiableCase, "source_system" | "detection_type">): MissedTripDetector {
  if (row.source_system === "spare") return "spare";
  return row.detection_type === "explicit_cancellation" ? "gtfs_cancellation" : "gtfs_silent_no_show";
}

export function classifyMissedTripCase(
  row: ClassifiableCase,
  promoted: readonly PromotionWindow[] = [],
  now: Date = new Date(),
): MissedTripClassification {
  const legacy = row.data_quality_status === "legacy_unverified";
  const reviewOutcome: MissedTripReviewOutcome | null =
    row.validation_status === "confirmed" ? "confirmed_missed_trip"
      : row.validation_status === "timely_service" || row.validation_status === "false_positive" ? "timely_service"
        : row.validation_status === "partial_service_failure" ? "partial_service_failure"
          : row.validation_status === "indeterminate" ? "indeterminate"
            : null;
  const reviewed = row.validation_status !== "unreviewed";
  const resolved = row.status === "resolved";
  const detector = detectorOf(row);
  const heldColumns = row.undecided_reason !== null || row.data_quality_status === "unknown_data_gap";
  const windowOpen = detector === "gtfs_silent_no_show" && row.detector_version === WINDOWED_DETECTOR_VERSION &&
    row.status === "escalated" && (row.expected_window_end_at === null || row.expected_window_end_at.getTime() > now.getTime());
  const held = !legacy && !reviewed && !resolved && (heldColumns || windowOpen);

  const lifecycle: MissedTripLifecycle =
    legacy ? "legacy"
      : reviewed ? "reviewed"
        : resolved ? "closed_by_evidence"
          : held ? "awaiting_evidence"
            : row.status === "watching" ? "open"
              : "ready_for_review";

  const evidenceFinding: MissedTripEvidenceFinding =
    resolved && !reviewed ? "timely_service"
      : detector === "spare" ? "on_demand_service_failure"
        : detector === "gtfs_cancellation" ? "advance_cancellation"
          : row.data_quality_status === "unknown_data_gap" ? "indeterminate"
            : row.detected_late_arrival_at !== null && row.detected_late_arrival_at.getTime() > row.grace_deadline_at.getTime() ? "late_trip_start"
              : "suspected_no_show";

  const countsAsMissed = !legacy && reviewOutcome === "confirmed_missed_trip";
  return {
    lifecycle,
    evidence_finding: evidenceFinding,
    review_outcome: reviewOutcome,
    detector,
    held_reason: !held ? null
      : row.undecided_reason ?? (row.data_quality_status === "unknown_data_gap" ? "unknown_data_gap" : AWAITING_OPERATING_WINDOW),
    legacy,
    held,
    in_queue: lifecycle === "ready_for_review",
    concluded: reviewed || resolved,
    flagged_missed: lifecycle === "ready_for_review" || countsAsMissed,
    counts_as_missed: countsAsMissed,
    counts_toward_assessment: countsAsMissed && isPromotedOn(promoted, detector, row.service_date),
  };
}

function bit(expression: string): string {
  return `CAST(CASE WHEN ${expression} THEN 1 ELSE 0 END AS BIT)`;
}

// CROSS APPLYs the classification onto `alias` (a MonitoredMissedTrips row) as
// `as`: SELECT ... FROM MonitoredMissedTrips m ${missedTripCaseSql("m")}
// WHERE mtc.in_queue = 1. Boolean columns are BIT. `promoted` is the promotion
// history compiled into spans (promotion.ts); it reaches SQL as literals, and
// no windows means every detector is still in Shadow detection - which is the
// right default only for a query that does not read counts_toward_assessment.
export function missedTripCaseSql(alias: string, as = "mtc", promoted: PromotionSource = []): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(as)) {
    throw new TypeError("missedTripCaseSql aliases must be plain identifiers");
  }
  const base = `${as}_base`;
  const promotedPredicate = `(${promotionWindowsSql(`${base}.detector`, `${alias}.service_date`, promoted)})`;
  return `
    CROSS APPLY (SELECT
      CASE WHEN ${alias}.data_quality_status = N'legacy_unverified' THEN 1 ELSE 0 END AS legacy,
      CASE WHEN ${alias}.validation_status <> N'unreviewed' THEN 1 ELSE 0 END AS reviewed,
      CASE WHEN ${alias}.status = N'resolved' THEN 1 ELSE 0 END AS resolved,
      CASE WHEN ${alias}.data_quality_status <> N'legacy_unverified' AND ${alias}.validation_status = N'unreviewed'
                AND ${alias}.status <> N'resolved'
                AND (${alias}.undecided_reason IS NOT NULL OR ${alias}.data_quality_status = N'unknown_data_gap'
                  OR (ISNULL(${alias}.source_system, N'gtfs') <> N'spare' AND ISNULL(${alias}.detection_type, N'') <> N'explicit_cancellation'
                      AND ${alias}.detector_version = N'${WINDOWED_DETECTOR_VERSION}' AND ${alias}.status = N'escalated'
                      AND (${alias}.expected_window_end_at IS NULL OR ${alias}.expected_window_end_at > SYSUTCDATETIME())))
           THEN 1 ELSE 0 END AS held,
      CASE WHEN ${alias}.source_system = N'spare' THEN N'spare'
           WHEN ${alias}.detection_type = N'explicit_cancellation' THEN N'gtfs_cancellation'
           ELSE N'gtfs_silent_no_show' END AS detector,
      CASE ${alias}.validation_status WHEN N'confirmed' THEN N'confirmed_missed_trip'
           WHEN N'timely_service' THEN N'timely_service' WHEN N'false_positive' THEN N'timely_service'
           WHEN N'partial_service_failure' THEN N'partial_service_failure'
           WHEN N'indeterminate' THEN N'indeterminate' END AS review_outcome
    ) ${base}
    CROSS APPLY (SELECT
      CASE WHEN ${base}.legacy = 1 THEN N'legacy'
           WHEN ${base}.reviewed = 1 THEN N'reviewed'
           WHEN ${base}.resolved = 1 THEN N'closed_by_evidence'
           WHEN ${base}.held = 1 THEN N'awaiting_evidence'
           WHEN ${alias}.status = N'watching' THEN N'open'
           ELSE N'ready_for_review' END AS lifecycle,
      CASE WHEN ${base}.resolved = 1 AND ${base}.reviewed = 0 THEN N'timely_service'
           WHEN ${base}.detector = N'spare' THEN N'on_demand_service_failure'
           WHEN ${base}.detector = N'gtfs_cancellation' THEN N'advance_cancellation'
           WHEN ${alias}.data_quality_status = N'unknown_data_gap' THEN N'indeterminate'
           WHEN ${alias}.detected_late_arrival_at > ${alias}.grace_deadline_at THEN N'late_trip_start'
           ELSE N'suspected_no_show' END AS evidence_finding,
      ${base}.review_outcome AS review_outcome,
      ${base}.detector AS detector,
      CASE WHEN ${base}.held = 1 THEN COALESCE(${alias}.undecided_reason,
             CASE WHEN ${alias}.data_quality_status = N'unknown_data_gap' THEN N'unknown_data_gap' END,
             N'${AWAITING_OPERATING_WINDOW}') END AS held_reason,
      CAST(${base}.legacy AS BIT) AS legacy,
      CAST(${base}.held AS BIT) AS held,
      ${bit(`${base}.legacy = 0 AND ${base}.reviewed = 0 AND ${base}.resolved = 0 AND ${base}.held = 0 AND ${alias}.status <> N'watching'`)} AS in_queue,
      ${bit(`${base}.reviewed = 1 OR ${base}.resolved = 1`)} AS concluded,
      ${bit(`${base}.legacy = 0 AND ((${base}.reviewed = 0 AND ${base}.resolved = 0 AND ${base}.held = 0 AND ${alias}.status <> N'watching') OR ${base}.review_outcome = N'confirmed_missed_trip')`)} AS flagged_missed,
      ${bit(`${base}.legacy = 0 AND ${base}.review_outcome = N'confirmed_missed_trip'`)} AS counts_as_missed,
      ${bit(`${base}.legacy = 0 AND ${base}.review_outcome = N'confirmed_missed_trip' AND ${promotedPredicate}`)} AS counts_toward_assessment
    ) ${as}`;
}

// The case's reference on a ComplianceOccurrence. Shared by the review-time
// occurrence link and the candidate poll so the two can never drift.
export function missedTripSourceRefSql(alias: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new TypeError("missedTripSourceRefSql alias must be a plain identifier");
  return `CONCAT(N'MonitoredMissedTrips:',ISNULL(${alias}.source_system,N'gtfs'),N':',ISNULL(${alias}.source_record_id,${alias}.trip_id),N'|',${alias}.service_date)`;
}
