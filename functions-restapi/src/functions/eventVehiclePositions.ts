// GET /event-vehicle-positions - the latest known position for every
// vehicle classified as SpecialEvent in RouteClassification, backing the
// console's Event Monitoring view's new "Event bus positions (live)" panel.
// Distinct from GET /avail-avl (every vehicle, unfiltered) - this is the
// subset that matters for the still-unbuilt Special Event Vehicle
// Monitoring module (MVTA_ONBOARD_MANUAL.md §18). OCC.Admin can read;
// this is visibility only - all writes come from availAvlPoll.ts's
// classification step (Part A2). Correctly returns zero vehicles until a
// real RouteClassification row exists for an active event - expected, not
// a bug.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { requireRole, ADMIN_ROLES } from "../lib/auth";

// route_label/route_category come from RouteClassification, NOT GtfsRoutes -
// a SpecialEvent RouteID is by definition absent from the GTFS static
// schedule (and therefore from GTFS-RT), so GTFS can never name one. The
// classification row is the only place a friendly name for an event route
// exists at all. Nullable because the poller's SpecialEvent filter and this
// read are separate queries: a row can survive in
// EventVehicleCurrentPosition for one poll cycle after its classification
// is deleted.
interface EventVehiclePositionRow {
  vehicle_id: number;
  route: number | null;
  route_label: string | null;
  route_category: string | null;
  latitude: number;
  longitude: number;
  heading: number | null;
  direction: string | null;
  block: number | null;
  run: number | null;
  operator_name: string | null;
  operator_source: string | null;
  speed_mph: number | null;
  report_timestamp: Date;
  updated_at: Date;
}

app.http("eventVehiclePositionsList", {
  route: "event-vehicle-positions",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, ADMIN_ROLES);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }
    try {
      const pool = await getPool();

      const tableCheck = await pool.request().query<{ table_exists: number }>(`
        SELECT CASE WHEN OBJECT_ID('dbo.EventVehicleCurrentPosition', 'U') IS NULL
          THEN 0 ELSE 1 END AS table_exists
      `);
      if (tableCheck.recordset[0]?.table_exists !== 1) {
        return {
          status: 200,
          jsonBody: { vehicles: [], diagnostics: { table_ready: false, vehicle_count: 0, last_report_at: null } },
        };
      }

      const result = await pool.request().query<EventVehiclePositionRow>(`
        SELECT p.vehicle_id, p.route, rc.route_label, rc.route_category,
               p.latitude, p.longitude, p.heading, avl.direction,
               NULLIF(avl.block, 0) AS block, NULLIF(avl.run, 0) AS run,
               assignment.operator_name,
               CASE WHEN assignment.operator_name IS NOT NULL THEN 'Avail Pullout Reports' END AS operator_source,
               CAST(COALESCE(
                 position.speed_mps * 2.236936,
                 CASE WHEN previous.report_timestamp IS NOT NULL
                   AND DATEDIFF(SECOND, previous.report_timestamp, p.report_timestamp) BETWEEN 5 AND 300
                 THEN geography::Point(p.latitude, p.longitude, 4326)
                   .STDistance(geography::Point(previous.latitude, previous.longitude, 4326))
                   / DATEDIFF(SECOND, previous.report_timestamp, p.report_timestamp) * 2.236936
                 END
               ) AS DECIMAL(7,1)) AS speed_mph,
               p.report_timestamp, p.updated_at
        FROM EventVehicleCurrentPosition p
        INNER JOIN RouteClassification rc ON rc.route_id = p.route
          AND rc.route_category = 'SpecialEvent'
          AND rc.is_active = 1
          AND (rc.effective_start_date IS NULL OR rc.effective_start_date <= CONVERT(CHAR(8), GETDATE(), 112))
          AND (rc.effective_end_date IS NULL OR rc.effective_end_date >= CONVERT(CHAR(8), GETDATE(), 112))
        LEFT JOIN AvailAvlVehiclePositions avl
          ON avl.vehicle_id = p.vehicle_id AND avl.route = p.route
        OUTER APPLY (
          SELECT TOP (1) d.operator_name
          FROM FixedRouteDepartures d
          WHERE ((d.block = avl.block AND d.run = avl.run)
              OR TRY_CONVERT(INT, d.vehicle_label) = p.vehicle_id)
            AND d.service_date >= CONVERT(CHAR(8), DATEADD(DAY, -1, GETDATE()), 112)
          ORDER BY d.service_date DESC, d.updated_at DESC
        ) assignment
        OUTER APPLY (
          SELECT TOP (1) m.speed_mps
          FROM MonitoredTripDelays m
          WHERE m.vehicle_id = CONVERT(NVARCHAR(50), p.vehicle_id)
            AND m.position_updated_at >= DATEADD(MINUTE, -3, SYSUTCDATETIME())
          ORDER BY m.position_updated_at DESC
        ) position
        OUTER APPLY (
          SELECT TOP (1) h.latitude, h.longitude, h.report_timestamp
          FROM EventVehiclePositionHistory h
          WHERE h.vehicle_id = p.vehicle_id
            AND h.report_timestamp < p.report_timestamp
          ORDER BY h.report_timestamp DESC
        ) previous
        WHERE p.report_timestamp >= DATEADD(MINUTE, -3, SYSUTCDATETIME())
          AND p.latitude BETWEEN 43.0 AND 46.0
          AND p.longitude BETWEEN -95.5 AND -92.0
        ORDER BY p.route, p.vehicle_id
      `);
      const vehicles = result.recordset;
      const lastReportAt = vehicles.reduce<Date | null>(
        (latest, row) => (!latest || row.report_timestamp > latest ? row.report_timestamp : latest),
        null,
      );

      return {
        status: 200,
        jsonBody: {
          vehicles,
          diagnostics: {
            table_ready: true,
            vehicle_count: vehicles.length,
            last_report_at: lastReportAt?.toISOString() ?? null,
          },
        },
      };
    } catch (err) {
      context.error("GET /event-vehicle-positions failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
