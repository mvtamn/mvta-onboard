// GET /kpi-trust - any OnBoard role, PII-free current usability of feed-backed KPIs.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { requireAnyOnBoardAccess } from "../lib/access/require";
import { getPool } from "../lib/db";
import { loadKpiTrust } from "../lib/kpiTrustStore";

app.http("kpiTrust", {
  route: "kpi-trust",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = await requireAnyOnBoardAccess(request);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    try {
      const pool = await getPool();
      return { status: 200, jsonBody: { checked_at: new Date().toISOString(), streams: await loadKpiTrust(pool) } };
    } catch (error) {
      context.error("GET /kpi-trust failed:", error);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
