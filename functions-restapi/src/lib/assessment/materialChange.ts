import { voidLiveIssuanceProofSql } from "./issuanceProof";

// A Material Assessment Change is a post-sharing change to an Assessment
// Item (status, evidence, tier, penalty, exception, or total). It withdraws
// the Shared Validation Draft, ends the Validation Window, and puts the month
// back through recompute and re-share (ADR 0009); a live Issuance Proof
// rendered from the pre-change state is voided with it (ADR 0029). Before
// sharing, the same write is just a write - nothing to withdraw.
//
// Every handler that records new information against a shared month -
// evidence, exceptions - runs this one fragment, so what a change touches is
// decided once. Reopen and Prepare void the proof on their own terms and are
// not material changes. `periodParam` and
// `actorParam` name parameters the caller has already bound.
export const MATERIAL_CHANGE_STATUSES = ["in_validation", "finalized"] as const;

export function materialChangeSql(periodParam: string, actorParam: string): string {
  return `
        UPDATE ValidationDraftShares SET superseded_at=SYSUTCDATETIME() WHERE period_id=@${periodParam} AND superseded_at IS NULL;
        UPDATE AssessmentPeriods SET input_revision=input_revision+1,status=CASE WHEN status IN('in_review','in_validation','finalized') THEN 'stale' ELSE status END,validation_shared_at=NULL,validation_ends_on=NULL,validation_shared_by=NULL,validation_recipient=NULL,validation_method=NULL,validation_attestation=NULL WHERE id=@${periodParam} AND status<>'issued';
        ${voidLiveIssuanceProofSql(periodParam, actorParam)}`;
}

// An Assessable Input for one contractor's month changed: an occurrence was
// raised, resolved, or given a figure. A shared month takes the material
// change above; a drafting month has its revision bumped (and a reviewed one
// goes stale); a finalized or issued month is never touched - callers refuse
// the write before it happens. `contractorParam`, `monthParam` and
// `actorParam` name parameters the caller has already bound.
export function assessableInputChangedSql(contractorParam: string, monthParam: string, actorParam: string): string {
  return `
        DECLARE @shared_period UNIQUEIDENTIFIER=(SELECT id FROM AssessmentPeriods WHERE contractor_id=@${contractorParam} AND service_month=@${monthParam} AND status='in_validation');
        IF @shared_period IS NOT NULL
        BEGIN
        ${materialChangeSql("shared_period", actorParam)}
        END
        ELSE
          UPDATE AssessmentPeriods SET input_revision=input_revision+1,status=CASE WHEN status IN('in_review','stale') THEN 'stale' ELSE status END
          WHERE contractor_id=@${contractorParam} AND service_month=@${monthParam} AND status IN('open','in_review','stale','reopened');`;
}
