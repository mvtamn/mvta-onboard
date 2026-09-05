// GET /on-demand-departures - Spare duty departure history, backing the
// On-Demand view of the console's Garage Departures module (Compliance tab).
// The on-demand counterpart of GET /fixed-route-departures, with the same
// diagnostics shape so the console reads both through one state model. Same
// readers; visibility only - all writes come from onDemandDeparturesPoll.ts.
// Accepts an optional ?days= query param to scope the trend window (default 14).
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, STAFF_READ_ROLES } from "../lib/auth";
import { agencyServiceDate } from "../lib/missedTripTime";
import { onDemandDeparturesEnabled } from "../lib/onDemandDepartures";
import { garageDepartureVarianceSeconds } from "./complianceCandidatesPoll";

const DEFAULT_TREND_DAYS = 14;

interface OnDemandDepartureRow {
  service_date: string;
  duty_id: string;
  duty_identifier: string | null;
  driver_id: string | null;
  vehicle_id: string | null;
  duty_status: string | null;
  departure_scheduled: Date | null;
  scheduled_source: string | null;
  departure_actual: Date | null;
  departure_source: string | null;
  updated_at: Date;
  departure_delta_seconds: number | null;
  // Scheduled to have left more than the variance allowance ago, and no
  // departure recorded from either source. The same shape as a fixed-route
  // run with no pullout actual.
  no_departure: boolean;
}

app.http("onDemandDeparturesList", {
  route: "on-demand-departures",
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

    try {
      const pool = await getPool();
      const tableCheck = await pool.request().query<{ table_exists: number }>(`
        SELECT CASE WHEN OBJECT_ID('dbo.OnDemandDepartures', 'U') IS NULL THEN 0 ELSE 1 END AS table_exists
      `);
      const configured = onDemandDeparturesEnabled() && Boolean(process.env.SPARE_API_KEY?.trim());
      const empty = {
        configured, table_ready: false, record_count: 0, late_count: 0, no_departure_count: 0,
        avg_delta_seconds: null as number | null, variance_seconds: varianceSeconds,
      };
      if (tableCheck.recordset[0]?.table_exists !== 1) {
        return { status: 200, jsonBody: { departures: [], diagnostics: empty } };
      }

      const req = pool.request();
      // Agency-local, to match the service_date the poll stores.
      req.input("cutoff_date", sql.Char(8), agencyServiceDate(new Date(), -days).serviceDate);
      req.input("variance_seconds", sql.Int, varianceSeconds);
      const result = await req.query<OnDemandDepartureRow>(`
        SELECT service_date, duty_id, duty_identifier, driver_id, vehicle_id, duty_status,
               departure_scheduled, scheduled_source, departure_actual, departure_source, updated_at,
               CASE WHEN departure_scheduled IS NOT NULL AND departure_actual IS NOT NULL
                 THEN DATEDIFF(SECOND, departure_scheduled, departure_actual) ELSE NULL END AS departure_delta_seconds,
               CAST(CASE WHEN departure_actual IS NULL AND departure_scheduled IS NOT NULL
                 AND DATEADD(SECOND, @variance_seconds, departure_scheduled) < SYSUTCDATETIME()
                 AND ISNULL(duty_status, '') <> 'cancelled' THEN 1 ELSE 0 END AS BIT) AS no_departure
        FROM OnDemandDepartures
        WHERE service_date >= @cutoff_date
        ORDER BY service_date DESC, departure_scheduled, duty_id
      `);
      const departures = result.recordset;
      const withDelta = departures.filter((d) => d.departure_delta_seconds !== null);
      const avgDeltaSeconds = withDelta.length > 0
        ? Math.round(withDelta.reduce((sum, d) => sum + (d.departure_delta_seconds ?? 0), 0) / withDelta.length)
        : null;

      return {
        status: 200,
        jsonBody: {
          departures,
          diagnostics: {
            ...empty,
            table_ready: true,
            record_count: departures.length,
            late_count: departures.filter((d) => (d.departure_delta_seconds ?? 0) > varianceSeconds).length,
            no_departure_count: departures.filter((d) => d.no_departure).length,
            avg_delta_seconds: avgDeltaSeconds,
          },
        },
      };
    } catch (err) {
      context.error("GET /on-demand-departures failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
