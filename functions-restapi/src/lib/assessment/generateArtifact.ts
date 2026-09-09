import { auditSql } from "./audit";
import { createHash, randomUUID } from "node:crypto";
import { buildComplianceReportBlobPath, uploadComplianceReport } from "../blobStorage";
import { getPool, sql } from "../db";
import { renderAssessmentReport, type AssessmentReportModel } from "../report/renderAssessmentReport";
import { buildReportModel, type ReportCapRow, type ReportEvidenceRow, type ReportExceptionRow, type ReportItemRow, type ReportOccurrenceRow, type ReportOtpExclusionRow, type ReportPeriodRow, type ReportStandardRow } from "../report/buildReportModel";
import { voidLiveIssuanceProofSql, withPeriodReportLock } from "./issuanceProof";
import { resolveFinalRequest } from "./reportLineage";

// Rendering an artifact for a period: the model from the rows as they are,
// the HTML, its hash, the blob, the row, the audit. Shared by the create
// handler and the month-boundary timer, under the period's report lock.
export type ArtifactType = "preliminary" | "final";
export type ArtifactOutcome = { status: 201; id: string; version: number; hash: string } | { status: 404 | 409; error: string };

export async function readModel(periodId:string,reportId:string,type:"preliminary"|"final",version:number,issuedAt:Date|null,deadline:Date|null,capDeadline:Date|null=null):Promise<AssessmentReportModel>{
  const pool=await getPool();const req=pool.request();req.input("period",sql.UniqueIdentifier,periodId);
  const period=await req.query<ReportPeriodRow&{contractor_id:string}>(`SELECT p.*,c.name contractor_name FROM AssessmentPeriods p JOIN Contractors c ON c.id=p.contractor_id WHERE p.id=@period`);
  const p=period.recordset[0];if(!p)throw new Error("Assessment Period not found");req.input("contractor",sql.UniqueIdentifier,p.contractor_id);req.input("month",sql.Char(6),p.service_month);
  const rows=await req.query<ReportItemRow>(`SELECT a.*,s.name,s.standard_type FROM PeriodKpiAssessments a JOIN AssessmentPeriodStandards s ON s.period_id=a.period_id AND s.standard_id=a.standard_id WHERE a.period_id=@period ORDER BY s.sort_order`);
  const evidence=await req.query<ReportEvidenceRow>(`SELECT s.name assessment_name,e.caption,e.content_sha256 FROM ComplianceEvidence e JOIN PeriodKpiAssessments a ON a.id=e.assessment_id JOIN AssessmentPeriodStandards s ON s.period_id=a.period_id AND s.standard_id=a.standard_id WHERE a.period_id=@period AND e.visibility='contractor' ORDER BY s.sort_order,e.uploaded_at`);
  // Design §9 sections 6-8 and 11: what was counted, what was removed in the
  // contractor's favour, what they must submit, and where each number came from.
  const occurrences=await req.query<ReportOccurrenceRow>(`SELECT s.name standard_name,o.service_date,o.description,o.quantity,o.qualifier_code,o.attribution,o.source_ref,c.status claim_status,c.event_description claim_description,(SELECT STRING_AGG(CONVERT(VARCHAR(MAX),e.content_sha256),'|') FROM ComplianceEvidence e WHERE e.occurrence_id=o.id) evidence_hashes FROM ComplianceOccurrences o JOIN AssessmentPeriodStandards s ON s.period_id=@period AND s.standard_id=o.standard_id LEFT JOIN ExcusableDelayClaims c ON c.id=o.relief_id WHERE o.contractor_id=@contractor AND o.service_month=@month AND o.review_status='confirmed' ORDER BY s.sort_order,o.service_date,o.created_at`);
  const exceptions=await req.query<ReportExceptionRow>(`SELECT s.name standard_name,x.reason,x.missing_data_owner,x.remediation_action,x.expected_correction_date FROM AssessmentExceptions x JOIN PeriodKpiAssessments a ON a.id=x.assessment_id JOIN AssessmentPeriodStandards s ON s.period_id=a.period_id AND s.standard_id=a.standard_id WHERE x.period_id=@period ORDER BY s.sort_order,x.authorized_at`);
  // The determination lives on the item; the plan row appears at issue.
  const caps=await req.query<ReportCapRow>(`SELECT s.name standard_name,c.trigger_reason,c.due_at,c.status,a.cap_reason FROM PeriodKpiAssessments a JOIN AssessmentPeriodStandards s ON s.period_id=a.period_id AND s.standard_id=a.standard_id LEFT JOIN CorrectiveActionPlans c ON c.period_id=a.period_id AND c.standard_id=a.standard_id WHERE a.period_id=@period AND (a.cap_required=1 OR c.id IS NOT NULL) ORDER BY s.sort_order`);
  const standards=await req.query<ReportStandardRow>(`SELECT s.name,s.standard_type,s.measurement_source,a.data_completeness_pct,a.assessment_outcome FROM AssessmentPeriodStandards s LEFT JOIN PeriodKpiAssessments a ON a.period_id=s.period_id AND a.standard_id=s.standard_id WHERE s.period_id=@period ORDER BY s.sort_order`);
  const otpExclusions=await req.query<ReportOtpExclusionRow>(`SELECT ISNULL(x.reason_code,'unspecified') reason_code,COUNT(*) stop_count FROM OtpStopExclusions x WHERE x.service_month=@month AND x.status='approved' GROUP BY x.reason_code ORDER BY stop_count DESC`);
  return buildReportModel({reportId,type,version,period:p,rows:rows.recordset,evidence:evidence.recordset,issuedAt,deadline,schedules:{occurrences:occurrences.recordset,exceptions:exceptions.recordset,caps:caps.recordset,standards:standards.recordset,otpExclusions:otpExclusions.recordset,capDeadline}});
}

export async function generateArtifact(pool: sql.ConnectionPool, input: { periodId: string; type: ArtifactType; actor: string; body?: Record<string, unknown> }): Promise<ArtifactOutcome> {
  const { periodId, type, actor } = input; const body = input.body ?? {};
  return withPeriodReportLock(pool,periodId,async tx=>{
      const state=new sql.Request(tx);state.input("period",sql.UniqueIdentifier,periodId);
      const info=await state.query<any>(`SELECT p.*,(SELECT TOP 1 r.id FROM ComplianceReports r WHERE r.period_id=p.supersedes_period_id AND r.issuance_type='final' AND r.issued_at IS NOT NULL ORDER BY r.issued_at DESC) latest_issued_final FROM AssessmentPeriods p WHERE p.id=@period`);const p=info.recordset[0];
      if(!p)return{status:404 as const,error:"Assessment Period not found"};
      if(type==="preliminary"&&p.status!=="in_review")return{status:409 as const,error:"A Validation Draft requires a reviewed Assessment Period"};
      if(type==="final"&&p.status!=="finalized")return{status:409 as const,error:"An Issuance Proof requires a Finalized Assessment"};
      const lineage=type==="final"?resolveFinalRequest({supersedesPeriodId:p.supersedes_period_id??null,latestIssuedFinalOfSupersededPeriod:p.latest_issued_final??null},body):{ok:true as const,supersedesId:null,supersedeReason:null};
      if(!lineage.ok)return{status:409 as const,error:lineage.error};
      const versionReq=new sql.Request(tx);versionReq.input("period",sql.UniqueIdentifier,periodId);versionReq.input("type",sql.NVarChar(20),type);versionReq.input("actor",sql.NVarChar(200),actor);
      const version=(await versionReq.query<{version:number}>(`${type==="final"?voidLiveIssuanceProofSql("period","actor"):""}
        SELECT ISNULL(MAX(version),0)+1 version FROM ComplianceReports WHERE period_id=@period AND issuance_type=@type`)).recordset[0].version;
      const id=randomUUID();const model=await readModel(periodId,id,type,version,null,null);const html=renderAssessmentReport(model);const hash=createHash("sha256").update(html).digest("hex");const path=buildComplianceReportBlobPath(periodId,id);await uploadComplianceReport(path,html);
      const write=new sql.Request(tx);write.input("id",sql.UniqueIdentifier,id);write.input("period",sql.UniqueIdentifier,periodId);write.input("contractor",sql.UniqueIdentifier,p.contractor_id);write.input("month",sql.Char(6),p.service_month);write.input("type",sql.NVarChar(20),type);write.input("version",sql.Int,version);write.input("supersedes",sql.UniqueIdentifier,lineage.supersedesId);write.input("reason",sql.NVarChar(500),lineage.supersedeReason);write.input("path",sql.NVarChar(1000),path);write.input("hash",sql.Char(64),hash);write.input("total",sql.Decimal(12,2),model.assessedTotal);write.input("actor",sql.NVarChar(200),actor);
      await write.query(`INSERT ComplianceReports(id,period_id,contractor_id,service_month,issuance_type,version,supersedes_id,blob_path,content_sha256,assessed_total,supersede_reason,generated_by) VALUES(@id,@period,@contractor,@month,@type,@version,@supersedes,@path,@hash,@total,@reason,@actor);${auditSql("report","@id",type==="final"?"issuance_proof_prepared":"draft_generated","actor",{after:"CONCAT('{\"content_sha256\":\"',@hash,'\"}')"})}`);
      return{status:201 as const,id,version,hash};
    });
}
