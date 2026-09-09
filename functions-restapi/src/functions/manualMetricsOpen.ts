import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { COMPLIANCE_READ_ROLES, requireRole } from "../lib/auth";
import { getPool, sql } from "../lib/db";
import { isServiceMonth } from "../lib/validation";

// What is still missing for a month, by owner: every hand-entered standard
// the active Agreement scores that has no ManualMetricEntries row for the
// month. Grouped by the assigned_to value and its account (migration 113) so
// the console can show a signed-in owner their own list. Six of the nine
// scored standards are hand-entered; "no data" has meant "nobody typed it
// in" without saying whose turn it was.
app.http("manualMetricsOpen", {
  route: "manual-metrics/open", methods: ["GET"], authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, COMPLIANCE_READ_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const month = request.query.get("service_month");
    if (!isServiceMonth(month)) return { status: 400, jsonBody: { error: "service_month is required" } };
    try {
      const pool = await getPool(); const req = pool.request(); req.input("month", sql.Char(6), month);
      const result = await req.query(`
        SELECT s.id standard_id,s.code,s.name,s.assigned_to,s.responsible_team,c.id contractor_id,c.name contractor_name,
          (SELECT TOP 1 principal_upn FROM ReferenceValues r WHERE r.domain='assigned_to' AND r.value=s.assigned_to) principal_upn
        FROM ContractorPerformanceStandards s
        JOIN AgreementStandards ags ON ags.standard_id=s.id AND ags.is_scored=1 AND ags.effective_start_date<=CONCAT(@month,'01') AND (ags.effective_end_date IS NULL OR ags.effective_end_date>=CONCAT(@month,'01'))
        JOIN PerformanceAgreements a ON a.id=ags.agreement_id AND a.is_active=1
        JOIN Contractors c ON c.id=a.contractor_id AND c.is_active=1
        WHERE s.standard_type='threshold' AND s.measurement_source IN ('manual_entry','structured_import')
          AND NOT EXISTS(SELECT 1 FROM ManualMetricEntries m WHERE m.standard_id=s.id AND m.contractor_id=c.id AND m.service_month=@month AND m.superseded_by IS NULL)
        ORDER BY s.assigned_to,s.sort_order`);
      return { status: 200, jsonBody: { open: result.recordset, service_month: month } };
    } catch (error) { context.error("GET manual-metrics/open failed", error); return { status: 500, jsonBody: { error: "Internal server error" } }; }
  },
});
