// GET /event-vehicle-positions - the latest known position for every
// vehicle position from the shared AVL projection, backing the console's
// Event AVL view. OCC.Admin can read it;
// plan membership classifies vehicles for the selected Event or operating
// period, but does not hide active vehicles from the shared AVL feed.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, STAFF_READ_ROLES } from "../lib/auth";
import { classifyEventScopeException } from "../lib/eventScopeExceptions";
import { polygonContains } from "../lib/geofence";
import { classifyVehicleZone, type VehicleZoneFence } from "../lib/eventVehicleZone";

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
  service_plan_names: string;
  service_plan_ids: string;
  speed_mph: number | null;
  report_timestamp: Date;
  updated_at: Date;
  report_age_seconds: number;
  is_stale: boolean;
  is_in_active_scope: boolean;
  other_scope_name: string | null;
  proposal_id: string | null;
  proposal_status: "proposed" | "accepted" | "applied" | "rejected" | null;
  zone_id: string | null;
  zone_name: string | null;
  zone_purpose: "staging" | "corridor" | "venue" | "other" | null;
  zone_status: "At venue" | "Staged" | "In corridor" | "In zone" | "Outside monitored zones";
}

app.http("eventVehiclePositionsList", {
  route: "event-vehicle-positions",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, STAFF_READ_ROLES);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }
    try {
      const pool = await getPool();
      const eventId = request.query.get("event_id");
      const servicePlanId = request.query.get("service_plan_id");

      const tableCheck = await pool.request().query<{ table_exists: number }>(`
        SELECT CASE WHEN OBJECT_ID('dbo.EventVehicleCurrentPosition', 'U') IS NULL
          THEN 0 ELSE 1 END AS table_exists
      `);
      if (tableCheck.recordset[0]?.table_exists !== 1) {
        return {
          status: 200,
          jsonBody: { vehicles: [], unassigned_vehicles: [], scope_exceptions: [], diagnostics: { table_ready: false, vehicle_count: 0, last_report_at: null } },
        };
      }

      const positionRequest = pool.request();
      positionRequest.input("eventId", sql.UniqueIdentifier, eventId || null);
      positionRequest.input("servicePlanId", sql.UniqueIdentifier, servicePlanId || null);
      const result = await positionRequest.query<EventVehiclePositionRow>(`
        SELECT p.vehicle_id, p.route, rc.route_label, rc.route_category,
               p.latitude, p.longitude, p.heading, avl.direction,
               NULLIF(avl.block, 0) AS block, NULLIF(avl.run, 0) AS run,
               assignment.operator_name,
               CASE WHEN assignment.operator_name IS NOT NULL THEN 'Avail Pullout Reports' END AS operator_source,
               COALESCE(plans.service_plan_names, '') AS service_plan_names,
               COALESCE(plans.service_plan_ids, '') AS service_plan_ids,
               other_scope.service_plan_name AS other_scope_name,
               proposal.id AS proposal_id,
               proposal.status AS proposal_status,
               CAST(CASE WHEN EXISTS (
                 SELECT 1
                 FROM EventServicePlans scope_plan
                 CROSS APPLY (SELECT TOP (1) routes_json,geofences_json FROM EventServicePlanScopeSnapshots snapshot WHERE snapshot.service_plan_id=scope_plan.id ORDER BY snapshot.captured_at DESC) scope
                 CROSS APPLY OPENJSON(scope.routes_json) WITH (route_id INT '$.route_id') scope_route
                 WHERE scope_route.route_id = p.route
                   AND scope_plan.status = 'active'
                   AND (@eventId IS NULL OR scope_plan.event_id = @eventId)
                   AND (@servicePlanId IS NULL OR scope_plan.id = @servicePlanId)
                   AND ((scope_plan.start_at IS NOT NULL AND scope_plan.end_at IS NOT NULL AND SYSUTCDATETIME() >= scope_plan.start_at AND SYSUTCDATETIME() <= scope_plan.end_at)
                     OR (scope_plan.start_at IS NULL AND scope_plan.end_at IS NULL AND (scope_plan.start_date IS NULL OR scope_plan.start_date <= CONVERT(DATE, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'Central Standard Time')) AND (scope_plan.end_date IS NULL OR scope_plan.end_date >= CONVERT(DATE, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'Central Standard Time'))))
                   AND EXISTS (
                     SELECT 1
                     FROM OPENJSON(scope.geofences_json) WITH (geofence_id UNIQUEIDENTIFIER '$.geofence_id',is_active BIT '$.is_active') scope_geofence
                     CROSS APPLY (SELECT TOP (1) 1 has_rule FROM (SELECT TOP (1) rules_json FROM EventServicePlanScopeSnapshots snapshot WHERE snapshot.service_plan_id=scope_plan.id ORDER BY snapshot.captured_at DESC) rule_scope CROSS APPLY OPENJSON(rule_scope.rules_json) WITH (geofence_id UNIQUEIDENTIFIER '$.geofence_id') scope_rule WHERE scope_rule.geofence_id=scope_geofence.geofence_id) scope_rule
                     WHERE scope_geofence.is_active = 1
                   )
               ) THEN 1 ELSE 0 END AS bit) AS is_in_active_scope,
               CAST(COALESCE(
                 position.speed_mps * 2.236936,
                 CASE WHEN previous.report_timestamp IS NOT NULL
                   AND DATEDIFF(SECOND, previous.report_timestamp, p.report_timestamp) BETWEEN 5 AND 300
                 THEN geography::Point(p.latitude, p.longitude, 4326)
                   .STDistance(geography::Point(previous.latitude, previous.longitude, 4326))
                   / DATEDIFF(SECOND, previous.report_timestamp, p.report_timestamp) * 2.236936
                 END
               ) AS DECIMAL(7,1)) AS speed_mph,
               p.report_timestamp, p.updated_at,
               age.report_age_seconds,
               CAST(CASE WHEN age.report_age_seconds >= 180 THEN 1 ELSE 0 END AS bit) AS is_stale
        FROM EventVehicleCurrentPosition p
        LEFT JOIN RouteClassification rc ON rc.route_id = p.route
          AND rc.route_category = 'SpecialEvent'
          AND rc.is_active = 1
          AND (rc.effective_start_date IS NULL OR rc.effective_start_date <= CONVERT(CHAR(8), SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'Central Standard Time', 112))
          AND (rc.effective_end_date IS NULL OR rc.effective_end_date >= CONVERT(CHAR(8), SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'Central Standard Time', 112))
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
          SELECT STRING_AGG(CONVERT(NVARCHAR(MAX), sp.name), ' | ') AS service_plan_names,
                 STRING_AGG(CONVERT(NVARCHAR(MAX), CONVERT(NVARCHAR(36), sp.id)), ',') AS service_plan_ids
          FROM EventServicePlans sp
          CROSS APPLY (SELECT TOP (1) routes_json FROM EventServicePlanScopeSnapshots snapshot WHERE snapshot.service_plan_id = sp.id ORDER BY snapshot.captured_at DESC) scope
          CROSS APPLY OPENJSON(scope.routes_json) scope_route
          WHERE TRY_CONVERT(INT, JSON_VALUE(scope_route.value, '$.route_id')) = p.route
            AND sp.status = 'active'
            AND (@eventId IS NULL OR sp.event_id = @eventId)
            AND (@servicePlanId IS NULL OR sp.id = @servicePlanId)
            AND (sp.start_date IS NULL OR sp.start_date <= CONVERT(CHAR(8), SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'Central Standard Time', 112))
            AND (sp.end_date IS NULL OR sp.end_date >= CONVERT(CHAR(8), SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'Central Standard Time', 112))
        ) plans
        OUTER APPLY (
          SELECT TOP (1) sp.name AS service_plan_name
          FROM EventServicePlans sp
          CROSS APPLY (SELECT TOP (1) routes_json FROM EventServicePlanScopeSnapshots snapshot WHERE snapshot.service_plan_id = sp.id ORDER BY snapshot.captured_at DESC) scope
          CROSS APPLY OPENJSON(scope.routes_json) scope_route
          WHERE TRY_CONVERT(INT, JSON_VALUE(scope_route.value, '$.route_id')) = p.route
            AND sp.status = 'active'
            AND @servicePlanId IS NOT NULL
            AND sp.id <> @servicePlanId
            AND (sp.start_date IS NULL OR sp.start_date <= CONVERT(CHAR(8), SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'Central Standard Time', 112))
            AND (sp.end_date IS NULL OR sp.end_date >= CONVERT(CHAR(8), SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'Central Standard Time', 112))
          ORDER BY sp.start_date, sp.name
        ) other_scope
        OUTER APPLY (
          SELECT TOP (1) a.id, a.status
          FROM EventVehicleAssignments a
          WHERE a.vehicle_id = p.vehicle_id
            AND a.event_id = @eventId
            AND a.service_plan_id = @servicePlanId
          ORDER BY a.requested_at DESC
        ) proposal
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
        CROSS APPLY (SELECT DATEDIFF(SECOND, p.report_timestamp, SYSUTCDATETIME()) AS report_age_seconds) age
          WHERE p.report_timestamp >= DATEADD(MINUTE, -15, SYSUTCDATETIME())
          AND p.latitude BETWEEN 43.0 AND 46.0
          AND p.longitude BETWEEN -95.5 AND -92.0
        ORDER BY p.route, p.vehicle_id
      `);
      const fenceRequest = pool.request();
      fenceRequest.input("eventId", sql.UniqueIdentifier, eventId || null);
      fenceRequest.input("servicePlanId", sql.UniqueIdentifier, servicePlanId || null);
      const fences = (await fenceRequest.query<(VehicleZoneFence & { service_plan_id: string })>(`
        SELECT sp.id service_plan_id, f.geofence_id id, f.name, f.polygon, COALESCE(f.purpose, 'other') purpose, f.is_active
        FROM EventServicePlans sp
        CROSS APPLY (SELECT TOP (1) geofences_json FROM EventServicePlanScopeSnapshots s WHERE s.service_plan_id=sp.id ORDER BY s.captured_at DESC) scope
        CROSS APPLY OPENJSON(scope.geofences_json) WITH (geofence_id UNIQUEIDENTIFIER '$.geofence_id',name NVARCHAR(150) '$.name',polygon NVARCHAR(MAX) '$.polygon',purpose NVARCHAR(20) '$.purpose',is_active BIT '$.is_active') f
        WHERE sp.status='active' AND (@eventId IS NULL OR sp.event_id=@eventId) AND (@servicePlanId IS NULL OR sp.id=@servicePlanId)
      `)).recordset;
      const outsideZones = { zone_id: null, zone_name: null, zone_purpose: null, zone_status: "Outside monitored zones" as const };
      const allVehicles = result.recordset.map((row) => ({
        ...row,
        service_plan_names: row.service_plan_names ? row.service_plan_names.split(" | ") : [],
        service_plan_ids: row.service_plan_ids ? row.service_plan_ids.split(",") : [],
        ...((() => {
          const planId = servicePlanId || (row.service_plan_ids ? row.service_plan_ids.split(",")[0] : undefined);
          return planId ? classifyVehicleZone(row, fences.filter((fence) => fence.service_plan_id === planId), polygonContains) : outsideZones;
        })()),
      }));
      const unassignedVehicles = allVehicles.filter((row) => row.service_plan_ids.length === 0);
      const scopeExceptions = servicePlanId
        ? allVehicles.flatMap((vehicle) => {
          const category = classifyEventScopeException({
            route_category: vehicle.route_category,
            operator_name: vehicle.operator_name,
            block: vehicle.block,
            run: vehicle.run,
            is_stale: vehicle.is_stale,
            is_in_active_scope: vehicle.is_in_active_scope,
            has_other_active_scope: Boolean(vehicle.other_scope_name),
          });
          return category ? [{
            ...vehicle,
            category,
            evidence: {
              route: vehicle.route,
              route_label: vehicle.route_label,
              operator_name: vehicle.operator_name,
              block: vehicle.block,
              run: vehicle.run,
              report_timestamp: vehicle.report_timestamp,
              report_age_seconds: vehicle.report_age_seconds,
              other_scope: vehicle.other_scope_name,
            },
            action_eligible: category === "needs_scope_review" && !["proposed", "accepted", "applied"].includes(vehicle.proposal_status ?? ""),
            proposal_id: vehicle.proposal_id,
            proposal_status: vehicle.proposal_status,
          }] : [];
        })
        : [];
      const lastReportAt = allVehicles.reduce<Date | null>(
        (latest, row) => (!latest || row.report_timestamp > latest ? row.report_timestamp : latest),
        null,
      );

      return {
        status: 200,
        jsonBody: {
          vehicles: allVehicles,
          unassigned_vehicles: unassignedVehicles,
          scope_exceptions: scopeExceptions,
          diagnostics: {
            table_ready: true,
            vehicle_count: allVehicles.length,
            managed_vehicle_count: allVehicles.length - unassignedVehicles.length,
            unassigned_vehicle_count: unassignedVehicles.length,
            last_report_at: lastReportAt?.toISOString() ?? null,
            source: "shared_avl_projection",
            stale_vehicle_count: allVehicles.filter((row) => row.is_stale).length,
          },
        },
      };
    } catch (err) {
      context.error("GET /event-vehicle-positions failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
