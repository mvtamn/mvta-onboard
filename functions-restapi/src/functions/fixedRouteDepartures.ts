// GET /fixed-route-departures - Avail Pullout compliance history, backing
// the console's Fixed Route Departures view (Compliance tab). Any staff
// role, plus the dedicated OCC.Compliance role, can read; this is visibility
// only - all writes come from fixedRouteDeparturesPoll.ts. Accepts an
// optional ?days= query param to scope the trend window (default 14).
//
// Every row carries an outcome judged by the same rule the compliance
// candidate poll raises occurrences from (lib/fixedRouteDepartureOutcome.ts),
// and the diagnostics count by that rule, so what staff see here is what
// reaches the assessment queue. The allowance and the settled-day boundary
// the counts used are returned alongside them so the console can label the
// numbers without re-deriving either.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, STAFF_READ_ROLES } from "../lib/auth";
import { agencyServiceDate } from "../lib/missedTripTime";
import { fixedRouteDepartureOutcome, type FixedRouteDepartureOutcome } from "../lib/fixedRouteDepartureOutcome";
import { garageDepartureVarianceSeconds, settledServiceDateExclusive } from "./complianceCandidatesPoll";

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

interface FixedRouteDepartureDiagnostics {
  configured: boolean;
  table_ready: boolean;
  record_count: number;
  // Rows whose service day is over, and so have been judged.
  settled_count: number;
  // Settled runs that departed more than the allowance late.
  late_count: number;
  // Settled runs that never departed.
  no_departure_count: number;
  // Over settled runs that departed, whatever their outcome.
  avg_delta_seconds: number | null;
  variance_seconds: number;
  // Exclusive: rows dated on or after this service date are not judged yet.
  settled_before: string;
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
    const varianceSeconds = garageDepartureVarianceSeconds();
    const settledBefore = settledServiceDateExclusive();

    try {
      const pool = await getPool();

      const tableCheck = await pool.request().query<{ table_exists: number }>(`
        SELECT CASE WHEN OBJECT_ID('dbo.FixedRouteDepartures', 'U') IS NULL
          THEN 0 ELSE 1 END AS table_exists
      `);
      const configured = Boolean(
        process.env.AVAIL_PULLOUT_URL?.trim() && process.env.AVAIL_AVL_REPORTS_API_KEY?.trim(),
      );
      const empty: FixedRouteDepartureDiagnostics = {
        configured, table_ready: false, record_count: 0, settled_count: 0, late_count: 0, no_departure_count: 0,
        avg_delta_seconds: null, variance_seconds: varianceSeconds, settled_before: settledBefore,
      };
      if (tableCheck.recordset[0]?.table_exists !== 1) {
        return { status: 200, jsonBody: { departures: [], diagnostics: empty } };
      }

      const req = pool.request();
      // Agency-local, to match the service_date the poller stores - a UTC
      // cutoff would move the window edge by a day for part of each day.
      req.input("cutoff_date", sql.Char(8), agencyServiceDate(new Date(), -days).serviceDate);
      // Newest day first, then block and run; the console groups by day and
      // orders within a day itself, so the rows arrive in one stable order.
      const result = await req.query<FixedRouteDepartureRow>(`
        SELECT service_date, block, run, checkin_scheduled, checkin_actual,
               login_scheduled, login_actual, pullout_scheduled, pullout_actual,
               pullout_status, operator_name, logon_id, vehicle_label, updated_at,
               CASE WHEN pullout_scheduled IS NOT NULL AND pullout_actual IS NOT NULL
                 THEN DATEDIFF(SECOND, pullout_scheduled, pullout_actual)
                 ELSE NULL END AS pullout_delta_seconds
        FROM FixedRouteDepartures
        WHERE service_date >= @cutoff_date
        ORDER BY service_date DESC, block, run
      `);
      const departures: Array<FixedRouteDepartureRow & { outcome: FixedRouteDepartureOutcome }> = result.recordset.map((row) => ({
        ...row,
        outcome: fixedRouteDepartureOutcome(row, varianceSeconds, settledBefore),
      }));
      const settled = departures.filter((d) => d.outcome !== "not_settled");
      const departed = settled.filter((d) => d.pullout_delta_seconds !== null);
      const avgDeltaSeconds = departed.length > 0
        ? Math.round(departed.reduce((sum, d) => sum + (d.pullout_delta_seconds ?? 0), 0) / departed.length)
        : null;

      const diagnostics: FixedRouteDepartureDiagnostics = {
        ...empty,
        table_ready: true,
        record_count: departures.length,
        settled_count: settled.length,
        late_count: settled.filter((d) => d.outcome === "late").length,
        no_departure_count: settled.filter((d) => d.outcome === "no_departure").length,
        avg_delta_seconds: avgDeltaSeconds,
      };
      return { status: 200, jsonBody: { departures, diagnostics } };
    } catch (err) {
      context.error("GET /fixed-route-departures failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
