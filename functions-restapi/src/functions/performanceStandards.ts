import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { COMPLIANCE_READ_ROLES, requireRole } from "../lib/auth";
import { getPool } from "../lib/db";

app.http("performanceStandardsList", {
  route: "performance-standards",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, COMPLIANCE_READ_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    try {
      const pool = await getPool();
      const ready = await pool.request().query<{ ready: number }>(`
        SELECT CASE WHEN OBJECT_ID('dbo.ContractorPerformanceStandards','U') IS NULL THEN 0 ELSE 1 END ready
      `);
      if (!ready.recordset[0]?.ready) {
        return { status: 200, jsonBody: { standards: [], tiers: [], diagnostics: { table_ready: false } } };
      }
      const [standards, tiers] = await Promise.all([
        pool.request().query(`SELECT * FROM ContractorPerformanceStandards ORDER BY sort_order`),
        pool.request().query(`SELECT * FROM ContractorStandardTiers ORDER BY standard_id, tier_order`),
      ]);
      return { status: 200, jsonBody: { standards: standards.recordset, tiers: tiers.recordset, diagnostics: { table_ready: true } } };
    } catch (error) {
      context.error("GET /performance-standards failed", error);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
