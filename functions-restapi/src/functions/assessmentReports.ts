import { auditSql } from "../lib/assessment/audit";
import { createHash } from "node:crypto";
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { COMPLIANCE_MANAGER_ROLES, COMPLIANCE_READ_ROLES, COMPLIANCE_WRITE_ROLES, requireRole } from "../lib/auth";
import { downloadComplianceReport } from "../lib/blobStorage";
import { getPool, sql } from "../lib/db";
import { isGuid } from "../lib/validation";
import { generateArtifact } from "../lib/assessment/generateArtifact";
import { issueFinal } from "../lib/assessment/issueFinal";


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
    const pool=await getPool();const which=pool.request();which.input("id",sql.UniqueIdentifier,request.params.id);const periodOf=(await which.query<{period_id:string}>(`SELECT period_id FROM ComplianceReports WHERE id=@id`)).recordset[0];if(!periodOf)return{status:404,jsonBody:{error:"Report not found"}};
    const outcome=await issueFinal(pool,{reportId:request.params.id,periodId:periodOf.period_id,actor:auth.principal.userDetails??"onboard-console",recipient:String(body.recipient),deliveryMethod:String(body.delivery_method),senderAttestation:String(body.sender_attestation)});
    if(outcome.status!==200)return{status:outcome.status,jsonBody:{error:outcome.error}};
    return{status:200,jsonBody:{id:outcome.id,status:"issued",content_sha256:outcome.hash,dispute_deadline_at:outcome.deadline.toISOString()}};
  }catch(error){context.error("POST issue report failed",error);return{status:409,jsonBody:{error:error instanceof Error?error.message:"Final Assessment issuance failed"}};}
}});
