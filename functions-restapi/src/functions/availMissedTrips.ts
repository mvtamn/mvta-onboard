// GET /avail-missed-trips - Avail Missed Trips By Route/Stop/Day incident
// records, backing the OTP Compliance console module's Monthly Assessments
// page. Distinct from GET /missed-trips (gtfsMissedTripsPoll.ts's real-time
// GTFS-based no-show/cancellation detection) - this is Avail's own vendor-
// reported, contractually-scoped compliance feed. Any staff role, plus the
// dedicated OCC.Compliance role, can read; all writes come from
// availMissedTripsPoll.ts. Accepts an optional ?month=YYYYMM query param
// (default: current month).
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, STAFF_READ_ROLES } from "../lib/auth";
import { serviceMonthOf } from "../lib/otpMonthlyFeed";

interface AvailMissedTripRow {
  service_month: string;
  calendar_date: string;
  route_id: number;
  route_desc: string | null;
  route_internet_name: string | null;
  departure_stop_id: number | null;
  departure_stop_name: string | null;
  arrival_stop_id: number | null;
  arrival_stop_name: string | null;
  departure_missed: boolean;
  arrival_missed: boolean;
  entire_trip_missed: boolean;
  departure_trip_start_time: Date | null;
  ingested_at: Date;
}

interface AvailMissedTripsRouteRollup {
  route_id: number;
  route_desc: string | null;
  incident_count: number;
  entire_trip_missed_count: number;
}

function resolveMonth(request: HttpRequest): string {
  const param = request.query.get("month");
  return param && /^\d{6}$/.test(param) ? param : serviceMonthOf(new Date());
}

app.http("availMissedTripsList", {
  route: "avail-missed-trips",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, [...STAFF_READ_ROLES, "OCC.Compliance"]);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }

    const serviceMonth = resolveMonth(request);
    const configured = Boolean(
      process.env.AVAIL_MISSED_TRIPS_URL?.trim() && process.env.AVAIL_AVL_REPORTS_API_KEY?.trim(),
    );

    try {
      const pool = await getPool();

      const tableCheck = await pool.request().query<{ table_exists: number }>(`
        SELECT CASE WHEN OBJECT_ID('dbo.AvailMissedTripsRouteStopDay', 'U') IS NULL
          THEN 0 ELSE 1 END AS table_exists
      `);
      if (tableCheck.recordset[0]?.table_exists !== 1) {
        return {
          status: 200,
          jsonBody: {
            incidents: [],
            routes: [],
            diagnostics: {
              configured,
              table_ready: false,
              service_month: serviceMonth,
              record_count: 0,
              entire_trip_missed_count: 0,
            },
          },
        };
      }

      const req = pool.request();
      req.input("service_month", sql.Char(6), serviceMonth);
      const incidentsResult = await req.query<AvailMissedTripRow>(`
        SELECT service_month, calendar_date, route_id, route_desc, route_internet_name,
               departure_stop_id, departure_stop_name, arrival_stop_id, arrival_stop_name,
               departure_missed, arrival_missed, entire_trip_missed,
               departure_trip_start_time, ingested_at
        FROM AvailMissedTripsRouteStopDay
        WHERE service_month = @service_month
        ORDER BY calendar_date DESC, route_id
      `);

      const routesReq = pool.request();
      routesReq.input("service_month", sql.Char(6), serviceMonth);
      const routesResult = await routesReq.query<AvailMissedTripsRouteRollup>(`
        SELECT route_id, MAX(route_desc) AS route_desc,
               COUNT(*) AS incident_count,
               SUM(CASE WHEN entire_trip_missed = 1 THEN 1 ELSE 0 END) AS entire_trip_missed_count
        FROM AvailMissedTripsRouteStopDay
        WHERE service_month = @service_month
        GROUP BY route_id
        ORDER BY incident_count DESC
      `);

      const incidents = incidentsResult.recordset;

      return {
        status: 200,
        jsonBody: {
          incidents,
          routes: routesResult.recordset,
          diagnostics: {
            configured,
            table_ready: true,
            service_month: serviceMonth,
            record_count: incidents.length,
            entire_trip_missed_count: incidents.filter((i) => i.entire_trip_missed).length,
          },
        },
      };
    } catch (err) {
      context.error("GET /avail-missed-trips failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
