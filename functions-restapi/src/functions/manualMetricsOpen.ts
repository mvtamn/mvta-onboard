import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { COMPLIANCE_READ_ROLES, requireRole } from "../lib/auth";
import { getPool, sql } from "../lib/db";
import { isGuid, isServiceMonth } from "../lib/validation";

// What is still missing for a month, by owner: every hand-entered standard
// the month scores that has no ManualMetricEntries row for it. Grouped by the assigned_to value and its account (migration 113) so
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
    const contractor = request.query.get("contractor_id"), periodId = request.query.get("period_id");
    try {
      const pool = await getPool(); const req = pool.request(); req.input("month", sql.Char(6), month);
      req.input("contractor", sql.UniqueIdentifier, isGuid(contractor) ? contractor : null); req.input("period", sql.UniqueIdentifier, isGuid(periodId) ? periodId : null);
      // For an opened month the frozen Assessment Rule Set is what counts
      // (ADR 0006); before one is opened, the Agreement effective for the month.
      const result = await req.query(`
        SELECT s.id standard_id,s.code,s.name,s.assigned_to,s.responsible_team,c.id contractor_id,c.name contractor_name,r.principal_upn
        FROM (
          SELECT ps.standard_id,p.contractor_id FROM AssessmentPeriodStandards ps JOIN AssessmentPeriods p ON p.id=ps.period_id WHERE p.id=@period AND ps.standard_type='threshold' AND ps.measurement_source IN ('manual_entry','structured_import')
          UNION
          SELECT ags.standard_id,a.contractor_id FROM AgreementStandards ags JOIN PerformanceAgreements a ON a.id=ags.agreement_id JOIN ContractorPerformanceStandards cs ON cs.id=ags.standard_id
            WHERE @period IS NULL AND ags.is_scored=1 AND ags.effective_start_date<=CONCAT(@month,'01') AND (ags.effective_end_date IS NULL OR ags.effective_end_date>=CONCAT(@month,'01'))
              AND CONCAT(@month,'01') BETWEEN CONVERT(char(8),a.starts_on,112) AND CONVERT(char(8),a.ends_on,112)
              AND cs.standard_type='threshold' AND cs.measurement_source IN ('manual_entry','structured_import')
        ) x
        JOIN ContractorPerformanceStandards s ON s.id=x.standard_id
        JOIN Contractors c ON c.id=x.contractor_id
        LEFT JOIN ReferenceValues r ON r.domain='assigned_to' AND r.value=s.assigned_to
        WHERE (@contractor IS NULL OR c.id=@contractor)
          AND NOT EXISTS(SELECT 1 FROM ManualMetricEntries m WHERE m.standard_id=s.id AND m.contractor_id=c.id AND m.service_month=@month AND m.superseded_by IS NULL)
        ORDER BY s.assigned_to,s.sort_order`);
      return { status: 200, jsonBody: { open: result.recordset, service_month: month } };
    } catch (error) { context.error("GET manual-metrics/open failed", error); return { status: 500, jsonBody: { error: "Internal server error" } }; }
  },
});
