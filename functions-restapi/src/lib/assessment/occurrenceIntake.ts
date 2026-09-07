// Turning a reviewed observation into a compliance occurrence, at the moment
// it is reviewed.
//
// The pipeline used to be: a reviewer confirms a missed trip in Compliance; the
// candidate poll notices, some minutes later, and raises an occurrence marked
// `candidate` / `undetermined`; someone opens the Performance Assessment module
// and answers a second question - was this the contractor's error - before it
// counts. Two modules, two sittings, and nothing in Compliance ever said the
// first decision had gone anywhere.
//
// The second question is a real one: Attachment G's excusable-delay relief
// turns on it, and it is not the same question as "did the trip get missed".
// So it stays a decision - it just gets asked at the same sitting, and the
// answer lands the occurrence in that service month directly. The poll remains
// as the backstop for rows confirmed before this existed, and dedupes on
// source_ref, so nothing is raised twice.
//
// What this deliberately does NOT do is fail a review because the assessment
// side is not set up. Whether a trip was missed is a fact about service; it
// does not stop being true because no Performance Agreement exists or the month
// is already closed. Every such case returns a reason the caller reports, and
// the review itself still commits.
import type { Transaction } from "mssql";
import { sql } from "../db";

export type OccurrenceAttribution = "contractor_error" | "excusable" | "mvta_directed" | "undetermined";
export type OccurrenceReviewStatus = "candidate" | "confirmed" | "dismissed";

export type OccurrenceLinkOutcome =
  | { linked: true; occurrence_id: string; service_month: string; review_status: OccurrenceReviewStatus; standard_code: string }
  | { linked: false; reason: "no_contractor" | "no_agreement" | "outside_agreement" | "period_finalized" | "standard_not_assigned" | "schema_not_ready" };

// How a review answer becomes an occurrence's state.
//
// `undetermined` is not a refusal to decide - it is the reviewer saying the
// attribution needs a separate look, which is exactly what the Assessment
// module's occurrence queue is for. It stays a candidate there.
export function occurrenceStateFor(
  validationStatus: "confirmed" | "false_positive",
  attribution: OccurrenceAttribution,
): { review_status: OccurrenceReviewStatus; attribution: OccurrenceAttribution } {
  if (validationStatus === "false_positive") return { review_status: "dismissed", attribution: "undetermined" };
  if (attribution === "contractor_error") return { review_status: "confirmed", attribution };
  if (attribution === "undetermined") return { review_status: "candidate", attribution };
  return { review_status: "dismissed", attribution };
}

// Mirrors the CONCAT in complianceCandidatesPoll.ts clause for clause. Both
// sides must produce the same string or the poll would raise a second
// occurrence for a trip this endpoint already raised - UX_CO_SourceRef would
// then reject the poll's whole MERGE rather than just the duplicate row.
const MISSED_TRIP_SOURCE_REF =
  `CONCAT(N'MonitoredMissedTrips:',ISNULL(m.source_system,N'gtfs'),N':',ISNULL(m.source_record_id,m.trip_id),N'|',m.service_date)`;

interface MissedTripReview {
  tripId: string;
  serviceDate: string;
  validationStatus: "confirmed" | "false_positive";
  attribution: OccurrenceAttribution;
  actor: string;
  note: string | null;
}

export async function linkMissedTripOccurrence(tx: Transaction, review: MissedTripReview): Promise<OccurrenceLinkOutcome> {
  const state = occurrenceStateFor(review.validationStatus, review.attribution);

  const ready = new sql.Request(tx);
  const readyResult = await ready.query<{ ready: number }>(`
    SELECT CASE WHEN OBJECT_ID('dbo.ComplianceOccurrences','U') IS NULL
                  OR OBJECT_ID('dbo.PerformanceAgreements','U') IS NULL THEN 0 ELSE 1 END ready
  `);
  if (!readyResult.recordset[0]?.ready) return { linked: false, reason: "schema_not_ready" };

  const context = new sql.Request(tx);
  context.input("date", sql.Char(8), review.serviceDate);
  const contextResult = await context.query<{
    contractor_id: string | null; agreement_id: string | null; in_window: number;
    standard_id: string | null; assigned: number; period_finalized: number;
  }>(`
    DECLARE @contractor UNIQUEIDENTIFIER=(SELECT TOP 1 id FROM Contractors WHERE is_active=1 ORDER BY updated_at DESC);
    DECLARE @agreement UNIQUEIDENTIFIER,@starts DATE,@ends DATE;
    SELECT TOP 1 @agreement=id,@starts=starts_on,@ends=ends_on FROM PerformanceAgreements WHERE contractor_id=@contractor AND is_active=1;
    SELECT @contractor contractor_id,@agreement agreement_id,
      CONVERT(int,CASE WHEN @starts IS NOT NULL AND CONVERT(date,@date,112) BETWEEN @starts AND @ends THEN 1 ELSE 0 END) in_window,
      (SELECT TOP 1 id FROM ContractorPerformanceStandards WHERE code='MISSED_TRIPS_FR') standard_id,
      CONVERT(int,CASE WHEN OBJECT_ID('dbo.AgreementStandards','U') IS NULL THEN 1
        WHEN EXISTS(SELECT 1 FROM AgreementStandards ags
                    JOIN ContractorPerformanceStandards s ON s.id=ags.standard_id AND s.code='MISSED_TRIPS_FR'
                    WHERE ags.agreement_id=@agreement AND ags.is_scored=1
                      AND ags.effective_start_date<=@date
                      AND (ags.effective_end_date IS NULL OR ags.effective_end_date>=@date)) THEN 1 ELSE 0 END) assigned,
      CONVERT(int,CASE WHEN EXISTS(SELECT 1 FROM AssessmentPeriods WHERE contractor_id=@contractor
        AND service_month=LEFT(@date,6) AND status IN('finalized','issued')) THEN 1 ELSE 0 END) period_finalized;
  `);
  const row = contextResult.recordset[0];
  if (!row?.contractor_id) return { linked: false, reason: "no_contractor" };
  if (!row.agreement_id) return { linked: false, reason: "no_agreement" };
  if (!row.in_window) return { linked: false, reason: "outside_agreement" };
  if (!row.standard_id || !row.assigned) return { linked: false, reason: "standard_not_assigned" };
  // A finalized or issued month is a document MVTA has put in front of the
  // contractor, and Attachment G's dispute clock runs from it. Restating it is
  // a manager reopening the period with a logged reason, never a side effect of
  // someone reviewing a trip.
  if (row.period_finalized) return { linked: false, reason: "period_finalized" };

  const write = new sql.Request(tx);
  write.input("trip_id", sql.NVarChar(200), review.tripId);
  write.input("date", sql.Char(8), review.serviceDate);
  write.input("contractor", sql.UniqueIdentifier, row.contractor_id);
  write.input("standard", sql.UniqueIdentifier, row.standard_id);
  write.input("status", sql.NVarChar(20), state.review_status);
  write.input("attribution", sql.NVarChar(30), state.attribution);
  write.input("reason", sql.NVarChar(1000), review.note);
  write.input("actor", sql.NVarChar(200), review.actor);
  const written = await write.query<{ id: string; service_month: string }>(`
    MERGE ComplianceOccurrences WITH (HOLDLOCK) target
    USING (
      SELECT ${MISSED_TRIP_SOURCE_REF} source_ref,
        CONCAT(N'Missed trip ',m.trip_id,N' on route ',m.route_id) description,
        LEFT(m.service_date,8) service_date
      FROM MonitoredMissedTrips m
      WHERE m.trip_id=@trip_id AND m.service_date=@date
    ) source ON target.source_ref=source.source_ref
    WHEN MATCHED THEN UPDATE SET review_status=@status,attribution=@attribution,
      dismiss_reason=CASE WHEN @status='dismissed' THEN @reason ELSE NULL END,
      reviewed_by=@actor,reviewed_at=SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT(standard_id,contractor_id,service_date,quantity,description,source,source_ref,
      review_status,attribution,dismiss_reason,reviewed_by,reviewed_at,created_by)
      VALUES(@standard,@contractor,source.service_date,1,source.description,'auto_candidate',source.source_ref,
        @status,@attribution,CASE WHEN @status='dismissed' THEN @reason ELSE NULL END,@actor,SYSUTCDATETIME(),@actor)
    OUTPUT inserted.id, inserted.service_month;
  `);
  const occurrence = written.recordset[0];
  // No MonitoredMissedTrips row means the caller validated a trip that does not
  // exist; the caller checks that first, so this is belt-and-braces.
  if (!occurrence) return { linked: false, reason: "schema_not_ready" };

  const stale = new sql.Request(tx);
  stale.input("contractor", sql.UniqueIdentifier, row.contractor_id);
  stale.input("month", sql.Char(6), occurrence.service_month);
  await stale.query(`
    UPDATE AssessmentPeriods SET input_revision=input_revision+1,
      status=CASE WHEN status IN('in_review','stale') THEN 'stale' ELSE status END
    WHERE contractor_id=@contractor AND service_month=@month AND status<>'finalized';
  `);

  return {
    linked: true, occurrence_id: occurrence.id, service_month: occurrence.service_month,
    review_status: state.review_status, standard_code: "MISSED_TRIPS_FR",
  };
}

// What the console tells the reviewer when the occurrence did not land. Each
// one names the thing to fix, because "not linked" on its own sends someone
// hunting through two modules for a cause.
export const OCCURRENCE_LINK_EXPLANATIONS: Record<Exclude<OccurrenceLinkOutcome, { linked: true }>["reason"], string> = {
  no_contractor: "The review was saved, but no active contractor is configured, so it was not added to a performance assessment.",
  no_agreement: "The review was saved, but no active Performance Agreement covers this contractor. Create one under Administration > Performance Standards.",
  outside_agreement: "The review was saved. This service date falls outside the active Performance Agreement's term, so it is not assessed.",
  standard_not_assigned: "The review was saved, but Missed Trips is not a scored standard on the active Agreement for this month.",
  period_finalized: "The review was saved. That month's assessment is already finalized, so it was not changed - reopen the period to restate it.",
  schema_not_ready: "The review was saved, but the performance assessment tables are not available in this environment.",
};
