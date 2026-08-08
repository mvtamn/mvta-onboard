import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { COMPLIANCE_MANAGER_ROLES, COMPLIANCE_READ_ROLES, requireRole } from "../lib/auth";
import { getPool, sql } from "../lib/db";
import { isGuid, validateManagerAssessmentAction } from "../lib/validation";

app.http("periodAssessmentsList", { route: "period-assessments", methods: ["GET"], authLevel: "anonymous", handler: async (request: HttpRequest, context: InvocationContext) => {
  const auth=requireRole(request,COMPLIANCE_READ_ROLES); if(!auth.authorized)return{status:auth.status,jsonBody:{error:auth.message}};
  const period=request.query.get("period_id"); if(!isGuid(period))return{status:400,jsonBody:{error:"period_id is required"}};
  try{const pool=await getPool();const req=pool.request();req.input("period",sql.UniqueIdentifier,period);const rows=await req.query(`SELECT a.*,s.code,s.name,s.standard_type,s.priority FROM PeriodKpiAssessments a JOIN ContractorPerformanceStandards s ON s.id=a.standard_id WHERE a.period_id=@period ORDER BY s.sort_order`);return{status:200,jsonBody:{assessments:rows.recordset,diagnostics:{table_ready:true}}};}
  catch(error){context.error("GET /period-assessments failed",error);return{status:500,jsonBody:{error:"Internal server error"}};}
}});

app.http("periodAssessmentPatch", { route: "period-assessments/{id}", methods: ["PATCH"], authLevel: "anonymous", handler: async (request: HttpRequest, context: InvocationContext) => {
  const auth=requireRole(request,COMPLIANCE_MANAGER_ROLES);if(!auth.authorized)return{status:auth.status,jsonBody:{error:auth.message}};if(!isGuid(request.params.id))return{status:400,jsonBody:{error:"Invalid assessment id"}};
  let body:Record<string,unknown>;try{body=await request.json() as Record<string,unknown>;}catch{return{status:400,jsonBody:{error:"Request body must be valid JSON"}};}const errors=validateManagerAssessmentAction(body);if(errors.length)return{status:400,jsonBody:{error:"Validation failed",details:errors}};
  try{const pool=await getPool();const req=pool.request();req.input("id",sql.UniqueIdentifier,request.params.id);req.input("action",sql.NVarChar(20),body.manager_action);req.input("reason",sql.NVarChar(1000),body.manager_reason??null);req.input("amount",sql.Decimal(12,2),body.manager_action==="waived"?0:body.final_amount??null);req.input("actor",sql.NVarChar(200),auth.principal.userDetails??"onboard-console");
    const result=await req.query<{changed:number}>(`UPDATE a SET manager_action=@action,manager_reason=@reason,final_amount=CASE WHEN @action='confirmed' THEN proposed_amount ELSE @amount END,reviewed_input_sha256=input_sha256,reviewed_by=@actor,reviewed_at=SYSUTCDATETIME() FROM PeriodKpiAssessments a JOIN AssessmentPeriods p ON p.id=a.period_id WHERE a.id=@id AND p.status='in_review' AND p.computed_revision=p.input_revision; SELECT @@ROWCOUNT changed;`);if(!result.recordset[0]?.changed)return{status:409,jsonBody:{error:"Assessment is stale or period is not in review"}};return{status:200,jsonBody:{id:request.params.id}};}
  catch(error){context.error("PATCH /period-assessments failed",error);return{status:500,jsonBody:{error:"Internal server error"}};}
}});
