import { createHash } from "node:crypto";
import { addBusinessDays, assertHolidayCoverage } from "./businessDays";
import { readModel, type Uploader } from "./generateArtifact";
import { withPeriodReportLock } from "./issuanceProof";
import { agreementScopeIn } from "./schemaScope";
import { uploadComplianceReport } from "../blobStorage";
import { sql } from "../db";
import { renderAssessmentReport } from "../report/renderAssessmentReport";

// Issuance: the live Issuance Proof becomes the Final Assessment (ADR 0029)
// - re-rendered with issuer and the holiday-aware dispute deadline, its own
// bytes kept beside the issued ones - and the period becomes issued, CAPs
// are created, superseded disputes closed, the issuance recorded. Shared by
// the handler and the lifecycle contract test; the uploader and the clock
// are injectable so the test can run without Blob Storage.
export type IssueOutcome = { status: 200; id: string; hash: string; deadline: Date } | { status: 409; error: string };

export async function issueFinal(pool: sql.ConnectionPool, input: { reportId: string; periodId: string; actor: string; recipient: string; deliveryMethod: string; senderAttestation: string; now?: Date; upload?: Uploader }): Promise<IssueOutcome> {
  const { reportId, periodId, actor } = input;
  return withPeriodReportLock(pool,periodId,async tx=>{
    const lookup=new sql.Request(tx);lookup.input("id",sql.UniqueIdentifier,reportId);lookup.input("actor",sql.NVarChar(200),actor);const row=(await lookup.query<any>(`SELECT r.* FROM ComplianceReports r JOIN AssessmentPeriods p ON p.id=r.period_id WHERE r.id=@id AND r.issuance_type='final' AND r.issued_at IS NULL AND r.voided_at IS NULL AND p.status='finalized' AND NOT EXISTS(SELECT 1 FROM PeriodKpiAssessments a WHERE a.period_id=p.id AND a.reviewed_by=@actor)`)).recordset[0];if(!row)return{status:409 as const,error:"Issuance requires a live Issuance Proof and an issuer who did not review any Assessment Item"};
    const issuedAt=input.now??new Date();const calendar=await pool.request().query<{holiday_date:Date}>(`SELECT holiday_date FROM MvtaHolidays`);const coverage=await pool.request().query<{coverage_through:Date}>(`SELECT coverage_through FROM MvtaHolidayCalendarCoverage WHERE id=1`);assertHolidayCoverage(issuedAt,new Date(issuedAt.getTime()+30*86400000),coverage.recordset[0]?.coverage_through??null);const holidays=new Set(calendar.recordset.map(r=>r.holiday_date.toISOString().slice(0,10)));const deadline=addBusinessDays(issuedAt,10,holidays);const capDeadline=addBusinessDays(issuedAt,5,holidays);
    const model=await readModel(pool,row.period_id,row.id,"final",row.version,issuedAt,deadline,capDeadline);model.issuedBy=actor;const html=renderAssessmentReport(model);const hash=createHash("sha256").update(html).digest("hex");const issuedPath=row.blob_path.replace(/\.html$/,`-issued-${issuedAt.getTime()}.html`);await (input.upload??uploadComplianceReport)(issuedPath,html);
    // A report can be issued without the period passing through finalize, so
    // the rule set is locked here too: an issued figure is relied upon exactly
    // as a finalised one is. COALESCE keeps the original lock time if the
    // period was finalised first.
    const issueScope=await agreementScopeIn(tx);const lockOnIssue=issueScope.rulesLock?",rules_locked_at=COALESCE(rules_locked_at,SYSUTCDATETIME())":"";
    const write=new sql.Request(tx);write.input("id",sql.UniqueIdentifier,row.id);write.input("period",sql.UniqueIdentifier,row.period_id);write.input("actor",sql.NVarChar(200),actor);write.input("issued",sql.DateTime2,issuedAt);write.input("deadline",sql.DateTime2,deadline);write.input("cap_deadline",sql.DateTime2,capDeadline);write.input("path",sql.NVarChar(1000),issuedPath);write.input("hash",sql.Char(64),hash);write.input("recipient",sql.NVarChar(320),input.recipient);write.input("method",sql.NVarChar(50),input.deliveryMethod);write.input("attestation",sql.NVarChar(1000),input.senderAttestation);
    const result=await write.query<{changed:number}>(`UPDATE ComplianceReports SET proof_blob_path=blob_path,proof_sha256=content_sha256,issued_at=@issued,issued_by=@actor,dispute_deadline_at=@deadline,blob_path=@path,content_sha256=@hash WHERE id=@id AND issued_at IS NULL AND voided_at IS NULL;DECLARE @changed INT=@@ROWCOUNT;IF @changed=1 BEGIN INSERT FinalIssuanceRecords(report_id,recipient,delivery_method,sender_attestation,issued_by,issued_at,content_sha256) VALUES(@id,@recipient,@method,@attestation,@actor,@issued,@hash);UPDATE AssessmentPeriods SET status='issued'${lockOnIssue} WHERE id=@period;UPDATE PenaltyDisputes SET status='superseded',outcome='superseded',decided_by=@actor,decided_at=@issued,determination_note='Superseded by a corrected Final Assessment' WHERE report_id=(SELECT supersedes_id FROM ComplianceReports WHERE id=@id) AND status IN('submitted','under_review');INSERT CorrectiveActionPlans(contractor_id,standard_id,period_id,trigger_reason,due_at,created_by) SELECT p.contractor_id,a.standard_id,@period,'tier_rule',@cap_deadline,@actor FROM PeriodKpiAssessments a JOIN AssessmentPeriods p ON p.id=a.period_id WHERE a.period_id=@period AND a.cap_required=1 AND NOT EXISTS(SELECT 1 FROM CorrectiveActionPlans c WHERE c.period_id=@period AND c.standard_id=a.standard_id AND c.status<>'withdrawn');INSERT ComplianceAssessmentAudit(entity_type,entity_id,action,actor,after_json) VALUES('report',@id,'issued',@actor,CONCAT('{"content_sha256":"',@hash,'"}'));END SELECT @changed changed;`);
    if(!result.recordset[0]?.changed)return{status:409 as const,error:"Final Assessment was issued concurrently"};return{status:200 as const,id:row.id,hash,deadline};
    });
}
