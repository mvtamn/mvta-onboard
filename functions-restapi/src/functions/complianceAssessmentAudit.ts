import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { periodAuditSelectSql } from "../lib/assessment/audit";
import { COMPLIANCE_READ_ROLES, requireRole } from "../lib/auth";
import { getPool, sql } from "../lib/db";
import { isGuid } from "../lib/validation";

// The trail a dispute is defended with: everything that happened to one
// Assessment Period, its items, its artifacts, and disputes on them. Read
// access follows the scorecard; the rows are append-only and never edited.
app.http("complianceAssessmentAudit", {
  route: "compliance-assessment-audit", methods: ["GET"], authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, COMPLIANCE_READ_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const period = request.query.get("period_id");
    if (!isGuid(period)) return { status: 400, jsonBody: { error: "period_id is required" } };
    const limit = Math.min(500, Math.max(1, Number(request.query.get("limit") ?? 200) || 200));
    const offset = Math.max(0, Number(request.query.get("offset") ?? 0) || 0);
    try {
      const pool = await getPool();
      const req = pool.request();
      req.input("period", sql.UniqueIdentifier, period); req.input("limit", sql.Int, limit); req.input("offset", sql.Int, offset);
      const result = await req.query(`${periodAuditSelectSql("period")} OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`);
      return { status: 200, jsonBody: { entries: result.recordset, diagnostics: { limit, offset, returned_count: result.recordset.length } } };
    } catch (error) { context.error("GET compliance assessment audit failed", error); return { status: 500, jsonBody: { error: "Internal server error" } }; }
  },
});
