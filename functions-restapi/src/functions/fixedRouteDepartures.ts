// GET /fixed-route-departures - Avail Pullout compliance history, backing
// the console's Fixed Route Departures view (Compliance tab). Any staff
// role, plus the dedicated OCC.Compliance role, can read; this is visibility
// only - all writes come from fixedRouteDeparturesPoll.ts. Accepts an
// optional ?days= query param to scope the trend window (default 14).
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, STAFF_READ_ROLES } from "../lib/auth";

const DEFAULT_TREND_DAYS = 14;

interface FixedRouteDepartureRow {
  service_date: string;
  block: number;
  run: number;
  checkin_scheduled: Date | null;
  checkin_actual: Date | null;
  login_scheduled: Date | null;
  login_actual: Date | null;
  pullout_scheduled: Date | null;
  pullout_actual: Date | null;
  pullout_status: string | null;
  operator_name: string | null;
  logon_id: number | null;
  vehicle_label: string | null;
  updated_at: Date;
  pullout_delta_seconds: number | null;
}

app.http("fixedRouteDeparturesList", {
  route: "fixed-route-departures",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, [...STAFF_READ_ROLES, "OCC.Compliance"]);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }

    const daysParam = Number(request.query.get("days"));
    const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 365) : DEFAULT_TREND_DAYS;

    try {
      const pool = await getPool();

      const tableCheck = await pool.request().query<{ table_exists: number }>(`
        SELECT CASE WHEN OBJECT_ID('dbo.FixedRouteDepartures', 'U') IS NULL
          THEN 0 ELSE 1 END AS table_exists
      `);
      const configured = Boolean(
        process.env.AVAIL_PULLOUT_URL?.trim() && process.env.AVAIL_AVL_REPORTS_API_KEY?.trim(),
      );
      if (tableCheck.recordset[0]?.table_exists !== 1) {
        return {
          status: 200,
          jsonBody: {
            departures: [],
            diagnostics: { configured, table_ready: false, record_count: 0, late_count: 0, expired_count: 0, avg_delta_seconds: null },
          },
        };
      }

      const req = pool.request();
      req.input("cutoff_date", sql.Char(8), cutoffDate(days));
      const result = await req.query<FixedRouteDepartureRow>(`
        SELECT service_date, block, run, checkin_scheduled, checkin_actual,
               login_scheduled, login_actual, pullout_scheduled, pullout_actual,
               pullout_status, operator_name, logon_id, vehicle_label, updated_at,
               CASE WHEN pullout_scheduled IS NOT NULL AND pullout_actual IS NOT NULL
                 THEN DATEDIFF(SECOND, pullout_scheduled, pullout_actual)
                 ELSE NULL END AS pullout_delta_seconds
        FROM FixedRouteDepartures
        WHERE service_date >= @cutoff_date
        ORDER BY
          CASE pullout_status WHEN 'Expired Pullout' THEN 0 WHEN 'Late Relief' THEN 1 ELSE 2 END,
          service_date DESC, block, run
      `);
      const departures = result.recordset;
      const withDelta = departures.filter((d) => d.pullout_delta_seconds !== null);
      const avgDeltaSeconds =
        withDelta.length > 0
          ? Math.round(withDelta.reduce((sum, d) => sum + (d.pullout_delta_seconds ?? 0), 0) / withDelta.length)
          : null;

      return {
        status: 200,
        jsonBody: {
          departures,
          diagnostics: {
            configured,
            table_ready: true,
            record_count: departures.length,
            late_count: departures.filter((d) => d.pullout_status === "Late Relief").length,
            expired_count: departures.filter((d) => d.pullout_status === "Expired Pullout").length,
            avg_delta_seconds: avgDeltaSeconds,
          },
        },
      };
    } catch (err) {
      context.error("GET /fixed-route-departures failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

function cutoffDate(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}
