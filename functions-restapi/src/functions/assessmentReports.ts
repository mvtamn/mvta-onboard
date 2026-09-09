import { auditSql } from "../lib/assessment/audit";
import { createHash, randomUUID } from "node:crypto";
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { addBusinessDays, assertHolidayCoverage } from "../lib/assessment/businessDays";
import { COMPLIANCE_MANAGER_ROLES, COMPLIANCE_READ_ROLES, COMPLIANCE_WRITE_ROLES, requireRole } from "../lib/auth";
import { buildComplianceReportBlobPath, downloadComplianceReport, uploadComplianceReport } from "../lib/blobStorage";
import { agreementScopeIn } from "../lib/assessment/schemaScope";
import { getPool, sql } from "../lib/db";
import { renderAssessmentReport, type AssessmentReportModel } from "../lib/report/renderAssessmentReport";
import { buildReportModel, type ReportCapRow, type ReportEvidenceRow, type ReportExceptionRow, type ReportItemRow, type ReportOccurrenceRow, type ReportPeriodRow, type ReportStandardRow } from "../lib/report/buildReportModel";
import { isGuid } from "../lib/validation";
import { voidLiveIssuanceProofSql, withPeriodReportLock } from "../lib/assessment/issuanceProof";
import { resolveFinalRequest } from "../lib/assessment/reportLineage";

async function readModel(periodId:string,reportId:string,type:"preliminary"|"final",version:number,issuedAt:Date|null,deadline:Date|null):Promise<AssessmentReportModel>{
  const pool=await getPool();const req=pool.request();req.input("period",sql.UniqueIdentifier,periodId);
  const period=await req.query<ReportPeriodRow>(`SELECT p.*,c.name contractor_name FROM AssessmentPeriods p JOIN Contractors c ON c.id=p.contractor_id WHERE p.id=@period`);
  const p=period.recordset[0];if(!p)throw new Error("Assessment Period not found");
  const rows=await req.query<ReportItemRow>(`SELECT a.*,s.name,s.standard_type FROM PeriodKpiAssessments a JOIN AssessmentPeriodStandards s ON s.period_id=a.period_id AND s.standard_id=a.standard_id WHERE a.period_id=@period ORDER BY s.sort_order`);
  const evidence=await req.query<ReportEvidenceRow>(`SELECT s.name assessment_name,e.caption,e.content_sha256 FROM ComplianceEvidence e JOIN PeriodKpiAssessments a ON a.id=e.assessment_id JOIN AssessmentPeriodStandards s ON s.period_id=a.period_id AND s.standard_id=a.standard_id WHERE a.period_id=@period AND e.visibility='contractor' ORDER BY s.sort_order,e.uploaded_at`);
  // Design §9 sections 6-8 and 11: what was counted, what was removed in the
  // contractor's favour, what they must submit, and where each number came from.
  const occurrences=await req.query<ReportOccurrenceRow>(`SELECT s.name standard_name,o.service_date,o.description,o.quantity,o.qualifier_code,o.attribution,o.review_status,o.source_ref,c.status claim_status,c.event_description claim_description FROM ComplianceOccurrences o JOIN AssessmentPeriods p ON p.contractor_id=o.contractor_id AND p.service_month=o.service_month JOIN AssessmentPeriodStandards s ON s.period_id=p.id AND s.standard_id=o.standard_id LEFT JOIN ExcusableDelayClaims c ON c.id=o.relief_id WHERE p.id=@period AND o.review_status='confirmed' ORDER BY s.sort_order,o.service_date,o.created_at`);
  const exceptions=await req.query<ReportExceptionRow>(`SELECT s.name standard_name,x.reason,x.missing_data_owner,x.remediation_action,x.expected_correction_date FROM AssessmentExceptions x JOIN PeriodKpiAssessments a ON a.id=x.assessment_id JOIN AssessmentPeriodStandards s ON s.period_id=a.period_id AND s.standard_id=a.standard_id WHERE x.period_id=@period ORDER BY s.sort_order,x.authorized_at`);
  const caps=await req.query<ReportCapRow>(`SELECT ISNULL(s.name,'Agreement') standard_name,c.trigger_reason,c.due_at,c.status FROM CorrectiveActionPlans c LEFT JOIN AssessmentPeriodStandards s ON s.period_id=c.period_id AND s.standard_id=c.standard_id WHERE c.period_id=@period ORDER BY c.due_at`);
  const standards=await req.query<ReportStandardRow>(`SELECT s.name,s.standard_type,s.measurement_source,a.data_completeness_pct FROM AssessmentPeriodStandards s LEFT JOIN PeriodKpiAssessments a ON a.period_id=s.period_id AND a.standard_id=s.standard_id WHERE s.period_id=@period ORDER BY s.sort_order`);
  return buildReportModel({reportId,type,version,period:p,rows:rows.recordset,evidence:evidence.recordset,issuedAt,deadline,occurrences:occurrences.recordset,exceptions:exceptions.recordset,caps:caps.recordset,standards:standards.recordset});
}

app.http("assessmentReportsList",{route:"assessment-reports",methods:["GET"],authLevel:"anonymous",handler:async(request,context)=>{
  const auth=requireRole(request,COMPLIANCE_READ_ROLES);if(!auth.authorized)return{status:auth.status,jsonBody:{error:auth.message}};
  const period=request.query.get("period_id");if(!isGuid(period))return{status:400,jsonBody:{error:"period_id is required"}};
  try{const pool=await getPool();const req=pool.request();req.input("period",sql.UniqueIdentifier,period);const result=await req.query(`SELECT id,period_id,service_month,issuance_type,version,supersedes_id,content_sha256,proof_sha256,assessed_total,issued_at,issued_by,voided_at,voided_by,dispute_deadline_at,supersede_reason,generated_by,generated_at FROM ComplianceReports WHERE period_id=@period ORDER BY generated_at DESC`);return{status:200,jsonBody:{reports:result.recordset}};}catch(error){context.error("GET assessment reports failed",error);return{status:500,jsonBody:{error:"Internal server error"}};}
}});

// A Validation Draft is freely regenerable (ADR 0009). A 'final' row that is
// not yet issued is an Issuance Proof: one live per period, the prior one
// voided on Prepare, and never a supersession target. Which Final a proof will
// supersede is derived from the period's lineage, not taken from the client
// (ADR 0029). The whole thing runs under the period's report lock so two
// clicks cannot allocate one version or leave a blob no row points at.
app.http("assessmentReportsCreate",{route:"assessment-reports",methods:["POST"],authLevel:"anonymous",handler:async(request,context)=>{
  let body:Record<string,unknown>;try{body=await request.json() as Record<string,unknown>;}catch{return{status:400,jsonBody:{error:"Request body must be valid JSON"}};}
  const type=body.issuance_type;if(type!=="preliminary"&&type!=="final")return{status:400,jsonBody:{error:"issuance_type must be preliminary or final"}};
  const auth=requireRole(request,type==="final"?COMPLIANCE_MANAGER_ROLES:COMPLIANCE_WRITE_ROLES);if(!auth.authorized)return{status:auth.status,jsonBody:{error:auth.message}};
  if(!isGuid(body.period_id))return{status:400,jsonBody:{error:"period_id is required"}};
  const periodId=body.period_id;const actor=auth.principal.userDetails??"onboard-console";
  try{
    const pool=await getPool();
    const outcome=await withPeriodReportLock(pool,periodId,async tx=>{
      const state=new sql.Request(tx);state.input("period",sql.UniqueIdentifier,periodId);
      const info=await state.query<any>(`SELECT p.*,(SELECT TOP 1 r.id FROM ComplianceReports r WHERE r.period_id=p.supersedes_period_id AND r.issuance_type='final' AND r.issued_at IS NOT NULL ORDER BY r.issued_at DESC) latest_issued_final FROM AssessmentPeriods p WHERE p.id=@period`);const p=info.recordset[0];
      if(!p)return{status:404,error:"Assessment Period not found"};
      if(type==="preliminary"&&p.status!=="in_review")return{status:409,error:"A Validation Draft requires a reviewed Assessment Period"};
      if(type==="final"&&p.status!=="finalized")return{status:409,error:"An Issuance Proof requires a Finalized Assessment"};
      const lineage=type==="final"?resolveFinalRequest({supersedesPeriodId:p.supersedes_period_id??null,latestIssuedFinalOfSupersededPeriod:p.latest_issued_final??null},body):{ok:true as const,supersedesId:null,supersedeReason:null};
      if(!lineage.ok)return{status:409,error:lineage.error};
      const versionReq=new sql.Request(tx);versionReq.input("period",sql.UniqueIdentifier,periodId);versionReq.input("type",sql.NVarChar(20),type);versionReq.input("actor",sql.NVarChar(200),actor);
      const version=(await versionReq.query<{version:number}>(`${type==="final"?voidLiveIssuanceProofSql("period","actor"):""}
        SELECT ISNULL(MAX(version),0)+1 version FROM ComplianceReports WHERE period_id=@period AND issuance_type=@type`)).recordset[0].version;
      const id=randomUUID();const model=await readModel(periodId,id,type,version,null,null);const html=renderAssessmentReport(model);const hash=createHash("sha256").update(html).digest("hex");const path=buildComplianceReportBlobPath(periodId,id);await uploadComplianceReport(path,html);
      const write=new sql.Request(tx);write.input("id",sql.UniqueIdentifier,id);write.input("period",sql.UniqueIdentifier,periodId);write.input("contractor",sql.UniqueIdentifier,p.contractor_id);write.input("month",sql.Char(6),p.service_month);write.input("type",sql.NVarChar(20),type);write.input("version",sql.Int,version);write.input("supersedes",sql.UniqueIdentifier,lineage.supersedesId);write.input("reason",sql.NVarChar(500),lineage.supersedeReason);write.input("path",sql.NVarChar(1000),path);write.input("hash",sql.Char(64),hash);write.input("total",sql.Decimal(12,2),model.assessedTotal);write.input("actor",sql.NVarChar(200),actor);
      await write.query(`INSERT ComplianceReports(id,period_id,contractor_id,service_month,issuance_type,version,supersedes_id,blob_path,content_sha256,assessed_total,supersede_reason,generated_by) VALUES(@id,@period,@contractor,@month,@type,@version,@supersedes,@path,@hash,@total,@reason,@actor);${auditSql("report","@id",type==="final"?"issuance_proof_prepared":"draft_generated","actor",{after:"CONCAT('{\"content_sha256\":\"',@hash,'\"}')"})}`);
      return{status:201,id,version,hash};
    });
    if(outcome.status!==201)return{status:outcome.status,jsonBody:{error:outcome.error}};
    return{status:201,jsonBody:{id:outcome.id,version:outcome.version,content_sha256:outcome.hash}};
  }catch(error){context.error("POST assessment report failed",error);return{status:409,jsonBody:{error:error instanceof Error?error.message:"Report generation failed"}};}
}});

async function streamReport(request:HttpRequest,attachment:boolean,context:InvocationContext){
  const auth=requireRole(request,COMPLIANCE_READ_ROLES);if(!auth.authorized)return{status:auth.status,jsonBody:{error:auth.message}};if(!isGuid(request.params.id))return{status:400,jsonBody:{error:"Invalid report id"}};
  try{const pool=await getPool();const req=pool.request();req.input("id",sql.UniqueIdentifier,request.params.id);const row=(await req.query<any>(`SELECT blob_path,content_sha256,service_month,issuance_type,version FROM ComplianceReports WHERE id=@id`)).recordset[0];if(!row)return{status:404,jsonBody:{error:"Report not found"}};const bytes=await downloadComplianceReport(row.blob_path);if(createHash("sha256").update(bytes).digest("hex")!==row.content_sha256)throw new Error("Archived report hash mismatch");return{status:200,headers:{"content-type":"text/html; charset=utf-8","content-disposition":`${attachment?"attachment":"inline"}; filename="assessment-${row.service_month}-${row.issuance_type}-v${row.version}.html"`},body:bytes};}catch(error){context.error("GET assessment report content failed",error);return{status:500,jsonBody:{error:"Unable to retrieve verified report"}};}
}
app.http("assessmentReportHtml",{route:"assessment-reports/{id}/html",methods:["GET"],authLevel:"anonymous",handler:(r,c)=>streamReport(r,false,c)});
app.http("assessmentReportDownload",{route:"assessment-reports/{id}/download",methods:["GET"],authLevel:"anonymous",handler:(r,c)=>streamReport(r,true,c)});

app.http("assessmentReportIssue",{route:"assessment-reports/{id}/issue",methods:["POST"],authLevel:"anonymous",handler:async(request,context)=>{
  const auth=requireRole(request,COMPLIANCE_MANAGER_ROLES);if(!auth.authorized)return{status:auth.status,jsonBody:{error:auth.message}};if(!isGuid(request.params.id))return{status:400,jsonBody:{error:"Invalid report id"}};
  let body:Record<string,unknown>;try{body=await request.json() as Record<string,unknown>;}catch{return{status:400,jsonBody:{error:"Request body must be valid JSON"}};}
  if(![body.recipient,body.delivery_method,body.sender_attestation].every(value=>typeof value==="string"&&value.trim()))return{status:400,jsonBody:{error:"recipient, delivery_method, and sender_attestation are required"}};
  try{
    const pool=await getPool();const actor=auth.principal.userDetails??"onboard-console";const which=pool.request();which.input("id",sql.UniqueIdentifier,request.params.id);const periodOf=(await which.query<{period_id:string}>(`SELECT period_id FROM ComplianceReports WHERE id=@id`)).recordset[0];if(!periodOf)return{status:404,jsonBody:{error:"Report not found"}};
    const outcome=await withPeriodReportLock(pool,periodOf.period_id,async tx=>{
    const lookup=new sql.Request(tx);lookup.input("id",sql.UniqueIdentifier,request.params.id);lookup.input("actor",sql.NVarChar(200),actor);const row=(await lookup.query<any>(`SELECT r.* FROM ComplianceReports r JOIN AssessmentPeriods p ON p.id=r.period_id WHERE r.id=@id AND r.issuance_type='final' AND r.issued_at IS NULL AND r.voided_at IS NULL AND p.status='finalized' AND NOT EXISTS(SELECT 1 FROM PeriodKpiAssessments a WHERE a.period_id=p.id AND a.reviewed_by=@actor)`)).recordset[0];if(!row)return{status:409 as const,error:"Issuance requires a live Issuance Proof and an issuer who did not review any Assessment Item"};
    const issuedAt=new Date();const calendar=await pool.request().query<{holiday_date:Date}>(`SELECT holiday_date FROM MvtaHolidays`);const coverage=await pool.request().query<{coverage_through:Date}>(`SELECT coverage_through FROM MvtaHolidayCalendarCoverage WHERE id=1`);assertHolidayCoverage(issuedAt,new Date(issuedAt.getTime()+30*86400000),coverage.recordset[0]?.coverage_through??null);const holidays=new Set(calendar.recordset.map(r=>r.holiday_date.toISOString().slice(0,10)));const deadline=addBusinessDays(issuedAt,10,holidays);const capDeadline=addBusinessDays(issuedAt,5,holidays);
    const model=await readModel(row.period_id,row.id,"final",row.version,issuedAt,deadline);model.issuedBy=actor;const html=renderAssessmentReport(model);const hash=createHash("sha256").update(html).digest("hex");const issuedPath=row.blob_path.replace(/\.html$/,`-issued-${issuedAt.getTime()}.html`);await uploadComplianceReport(issuedPath,html);
    // A report can be issued without the period passing through finalize, so
    // the rule set is locked here too: an issued figure is relied upon exactly
    // as a finalised one is. COALESCE keeps the original lock time if the
    // period was finalised first.
    const issueScope=await agreementScopeIn(tx);const lockOnIssue=issueScope.rulesLock?",rules_locked_at=COALESCE(rules_locked_at,SYSUTCDATETIME())":"";
    const write=new sql.Request(tx);write.input("id",sql.UniqueIdentifier,row.id);write.input("period",sql.UniqueIdentifier,row.period_id);write.input("actor",sql.NVarChar(200),actor);write.input("issued",sql.DateTime2,issuedAt);write.input("deadline",sql.DateTime2,deadline);write.input("cap_deadline",sql.DateTime2,capDeadline);write.input("path",sql.NVarChar(1000),issuedPath);write.input("hash",sql.Char(64),hash);write.input("recipient",sql.NVarChar(320),body.recipient);write.input("method",sql.NVarChar(50),body.delivery_method);write.input("attestation",sql.NVarChar(1000),body.sender_attestation);
    const result=await write.query<{changed:number}>(`UPDATE ComplianceReports SET proof_blob_path=blob_path,proof_sha256=content_sha256,issued_at=@issued,issued_by=@actor,dispute_deadline_at=@deadline,blob_path=@path,content_sha256=@hash WHERE id=@id AND issued_at IS NULL AND voided_at IS NULL;DECLARE @changed INT=@@ROWCOUNT;IF @changed=1 BEGIN INSERT FinalIssuanceRecords(report_id,recipient,delivery_method,sender_attestation,issued_by,issued_at,content_sha256) VALUES(@id,@recipient,@method,@attestation,@actor,@issued,@hash);UPDATE AssessmentPeriods SET status='issued'${lockOnIssue} WHERE id=@period;UPDATE PenaltyDisputes SET status='superseded',outcome='superseded',decided_by=@actor,decided_at=@issued,determination_note='Superseded by a corrected Final Assessment' WHERE report_id=(SELECT supersedes_id FROM ComplianceReports WHERE id=@id) AND status IN('submitted','under_review');INSERT CorrectiveActionPlans(contractor_id,standard_id,period_id,trigger_reason,due_at,created_by) SELECT p.contractor_id,a.standard_id,@period,'tier_rule',@cap_deadline,@actor FROM PeriodKpiAssessments a JOIN AssessmentPeriods p ON p.id=a.period_id WHERE a.period_id=@period AND a.cap_required=1 AND NOT EXISTS(SELECT 1 FROM CorrectiveActionPlans c WHERE c.period_id=@period AND c.standard_id=a.standard_id);INSERT ComplianceAssessmentAudit(entity_type,entity_id,action,actor,after_json) VALUES('report',@id,'issued',@actor,CONCAT('{"content_sha256":"',@hash,'"}'));END SELECT @changed changed;`);
    if(!result.recordset[0]?.changed)return{status:409 as const,error:"Final Assessment was issued concurrently"};return{status:200 as const,id:row.id,hash,deadline};
    });
    if(outcome.status!==200)return{status:outcome.status,jsonBody:{error:outcome.error}};
    return{status:200,jsonBody:{id:outcome.id,status:"issued",content_sha256:outcome.hash,dispute_deadline_at:outcome.deadline.toISOString()}};
  }catch(error){context.error("POST issue report failed",error);return{status:409,jsonBody:{error:error instanceof Error?error.message:"Final Assessment issuance failed"}};}
}});
