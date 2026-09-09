import { auditSql } from "../lib/assessment/audit";
import { createHash } from "node:crypto";
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { addBusinessDays, assertHolidayCoverage } from "../lib/assessment/businessDays";
import { COMPLIANCE_MANAGER_ROLES, COMPLIANCE_READ_ROLES, COMPLIANCE_WRITE_ROLES, requireRole } from "../lib/auth";
import { downloadComplianceReport, uploadComplianceReport } from "../lib/blobStorage";
import { agreementScopeIn } from "../lib/assessment/schemaScope";
import { getPool, sql } from "../lib/db";
import { renderAssessmentReport } from "../lib/report/renderAssessmentReport";
import { isGuid } from "../lib/validation";
import { generateArtifact, readModel } from "../lib/assessment/generateArtifact";
import { withPeriodReportLock } from "../lib/assessment/issuanceProof";


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
  try{
    const outcome=await generateArtifact(await getPool(),{periodId:body.period_id,type,actor:auth.principal.userDetails??"onboard-console",body});
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
    const model=await readModel(row.period_id,row.id,"final",row.version,issuedAt,deadline,capDeadline);model.issuedBy=actor;const html=renderAssessmentReport(model);const hash=createHash("sha256").update(html).digest("hex");const issuedPath=row.blob_path.replace(/\.html$/,`-issued-${issuedAt.getTime()}.html`);await uploadComplianceReport(issuedPath,html);
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
