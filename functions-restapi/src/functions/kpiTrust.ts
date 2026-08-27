// GET /kpi-trust - staff-only, PII-free current usability of feed-backed KPIs.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { requireRole, STAFF_READ_ROLES } from "../lib/auth";
import { getPool } from "../lib/db";
import { resolveKpiTrust, type KpiFeedHealth } from "../lib/kpiTrust";

app.http("kpiTrust", {
  route: "kpi-trust",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, STAFF_READ_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    try {
      const pool = await getPool();
      const table = await pool.request().query<{ ready: number }>(`
        SELECT CASE WHEN OBJECT_ID('dbo.MissedTripFeedHealth', 'U') IS NULL THEN 0 ELSE 1 END AS ready
      `);
      const records = table.recordset[0]?.ready === 1
        ? (await pool.request().query<KpiFeedHealth>(`
            SELECT feed_name, last_success_at, last_entity_count, source_timestamp_at
            FROM MissedTripFeedHealth
          `)).recordset
        : [];
      return { status: 200, jsonBody: { checked_at: new Date().toISOString(), streams: resolveKpiTrust(records) } };
    } catch (error) {
      context.error("GET /kpi-trust failed:", error);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
