import type { InvocationContext } from "@azure/functions";
import { getPool, sql } from "./db";
import { polygonContains } from "./geofence";
import { detectQualifiedBoundaryMovements } from "./eventBoundaryMovement";
import { publishEventGeofenceNotification } from "./events";
import { detectionWindowSeconds, isStableTransition, nextTransitionConfirmations } from "./eventProcessing";
import { selectMatchingDirectionRule, shouldPublishEventGeofenceNotification, snapshotMatchedDirectionRule, type DirectionRule } from "./eventDirectionRules";

interface Position { vehicle_id: number; route: number | null; service_plan_id: string; latitude: number; longitude: number; heading: number | null; report_timestamp: Date }
interface PreviousPosition { latitude: number; longitude: number; report_timestamp: Date }
interface Fence { id: string; service_plan_id: string; polygon: string; name: string }
interface CrossingEvidence { detectionMethod: "point_confirmed" | "path_interpolated"; sourceFrom: Date | null; sourceTo: Date; displacementMeters: number | null }

async function insertCrossing(input: { pool: Awaited<ReturnType<typeof getPool>>; context: InvocationContext; position: Position; fence: Fence; transition: "enter" | "exit"; evidence: CrossingEvidence }): Promise<void> {
  const { pool, context, position, fence, transition, evidence } = input;
  const ruleRequest = pool.request();
  ruleRequest.input("plan", sql.UniqueIdentifier, fence.service_plan_id);
  ruleRequest.input("fence", sql.UniqueIdentifier, fence.id);
  ruleRequest.input("transition", sql.NVarChar, transition);
  const rules = (await ruleRequest.query<DirectionRule>(`
    SELECT rule.id,rule.geofence_id,rule.name,rule.transition,rule.heading_min,rule.heading_max,rule.destination_label,rule.destination_location_id,rule.message_type,rule.send_mode,rule.sort_order
    FROM (SELECT TOP (1) rules_json FROM EventServicePlanScopeSnapshots snapshot WHERE snapshot.service_plan_id=@plan ORDER BY snapshot.captured_at DESC) scope
    CROSS APPLY OPENJSON(scope.rules_json) WITH (id UNIQUEIDENTIFIER '$.id',geofence_id UNIQUEIDENTIFIER '$.geofence_id',name NVARCHAR(100) '$.name',transition NVARCHAR(10) '$.transition',heading_min FLOAT '$.heading_min',heading_max FLOAT '$.heading_max',destination_label NVARCHAR(200) '$.destination_label',destination_location_id UNIQUEIDENTIFIER '$.destination_location_id',message_type NVARCHAR(30) '$.message_type',send_mode NVARCHAR(10) '$.send_mode',sort_order INT '$.sort_order') rule
    WHERE rule.geofence_id=@fence AND rule.transition=@transition
  `)).recordset;
  const rule = selectMatchingDirectionRule(rules, transition, position.heading);
  const snapshot = rule ? snapshotMatchedDirectionRule(rule) : null;
  const crossing = pool.request();
  crossing.input("vehicle", sql.Int, position.vehicle_id);
  crossing.input("route", sql.Int, position.route);
  crossing.input("plan", sql.UniqueIdentifier, fence.service_plan_id);
  crossing.input("fence", sql.UniqueIdentifier, fence.id);
  crossing.input("transition", sql.NVarChar, transition);
  crossing.input("heading", sql.Float, position.heading);
  crossing.input("label", sql.NVarChar, rule?.destination_label?.trim() || null);
  crossing.input("rule", sql.UniqueIdentifier, snapshot?.matched_rule_id ?? null);
  crossing.input("priority", sql.Int, snapshot?.matched_rule_priority ?? null);
  crossing.input("location", sql.UniqueIdentifier, snapshot?.matched_destination_location_id ?? null);
  crossing.input("messageType", sql.NVarChar, snapshot?.matched_message_type ?? null);
  crossing.input("mode", sql.NVarChar, snapshot?.matched_send_mode ?? null);
  crossing.input("method", sql.NVarChar, evidence.detectionMethod);
  crossing.input("sourceFrom", sql.DateTime2, evidence.sourceFrom);
  crossing.input("sourceTo", sql.DateTime2, evidence.sourceTo);
  crossing.input("displacement", sql.Decimal(10, 1), evidence.displacementMeters);
  crossing.input("crossed", sql.DateTime2, evidence.sourceTo);
  const result = await crossing.query<{ id: number }>(`
    INSERT INTO EventGeofenceCrossings(vehicle_id,route_id,service_plan_id,geofence_id,transition,heading_at_crossing,destination_label,matched_rule_id,matched_rule_priority,matched_destination_location_id,matched_message_type,matched_send_mode,detection_method,source_report_from_at,source_report_to_at,source_displacement_meters,crossed_at)
    OUTPUT INSERTED.id
    VALUES(@vehicle,@route,@plan,@fence,@transition,@heading,@label,@rule,@priority,@location,@messageType,@mode,@method,@sourceFrom,@sourceTo,@displacement,@crossed)
  `);
  if (shouldPublishEventGeofenceNotification(rule)) await publishEventGeofenceNotification(result.recordset[0].id, context);
}

async function previousPosition(pool: Awaited<ReturnType<typeof getPool>>, position: Position): Promise<PreviousPosition | undefined> {
  const request = pool.request();
  request.input("vehicle", sql.Int, position.vehicle_id);
  request.input("reported", sql.DateTime2, position.report_timestamp);
  return (await request.query<PreviousPosition>(`
    SELECT TOP (1) latitude,longitude,report_timestamp
    FROM EventVehiclePositionHistory
    WHERE vehicle_id=@vehicle AND report_timestamp < @reported
    ORDER BY report_timestamp DESC
  `)).recordset[0];
}

function displacementMeters(previous: PreviousPosition | undefined, position: Position): number | null {
  if (!previous) return null;
  const radians = Math.PI / 180;
  const latitude = (position.latitude - previous.latitude) * radians;
  const longitude = (position.longitude - previous.longitude) * radians;
  const h = Math.sin(latitude / 2) ** 2 + Math.cos(previous.latitude * radians) * Math.cos(position.latitude * radians) * Math.sin(longitude / 2) ** 2;
  return Math.round(2 * 6_371_000 * Math.asin(Math.sqrt(h)) * 10) / 10;
}

export async function detectEventGeofenceCrossings(context: InvocationContext): Promise<void> {
  const pool = await getPool();
  const configuredInterval = (await pool.request().query<{ seconds: number }>(`SELECT COALESCE(TRY_CONVERT(INT, setting_value), 30) seconds FROM AppSettings WHERE module='event' AND setting_key='poll_interval_seconds'`)).recordset[0]?.seconds ?? 30;
  const windowSeconds = detectionWindowSeconds(configuredInterval);
  const positionRequest = pool.request();
  positionRequest.input("windowSeconds", sql.Int, windowSeconds);
  const activePeriod = "((sp.start_at IS NOT NULL AND sp.end_at IS NOT NULL AND SYSUTCDATETIME() >= sp.start_at AND SYSUTCDATETIME() <= sp.end_at) OR (sp.start_at IS NULL AND sp.end_at IS NULL AND (sp.start_date IS NULL OR sp.start_date <= CONVERT(DATE, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'Central Standard Time')) AND (sp.end_date IS NULL OR sp.end_date >= CONVERT(DATE, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'Central Standard Time'))))";
  const positions = (await positionRequest.query<Position>(`SELECT DISTINCT p.vehicle_id,p.route,sp.id service_plan_id,p.latitude,p.longitude,p.heading,p.report_timestamp FROM EventVehicleCurrentPosition p JOIN EventServicePlans sp ON sp.status='active' AND ${activePeriod} WHERE p.report_timestamp >= DATEADD(SECOND,-@windowSeconds,SYSUTCDATETIME()) AND EXISTS (SELECT 1 FROM (SELECT TOP (1) routes_json FROM EventServicePlanScopeSnapshots snapshot WHERE snapshot.service_plan_id=sp.id ORDER BY snapshot.captured_at DESC) scope CROSS APPLY OPENJSON(scope.routes_json) WITH (route_id INT '$.route_id') route_scope WHERE route_scope.route_id=p.route)`)).recordset;
  const fences = (await pool.request().query<Fence>(`SELECT sp.id service_plan_id,scope_fence.geofence_id id,scope_fence.polygon,scope_fence.name FROM EventServicePlans sp CROSS APPLY (SELECT TOP (1) geofences_json FROM EventServicePlanScopeSnapshots snapshot WHERE snapshot.service_plan_id=sp.id ORDER BY snapshot.captured_at DESC) scope CROSS APPLY OPENJSON(scope.geofences_json) WITH (geofence_id UNIQUEIDENTIFIER '$.geofence_id',polygon NVARCHAR(MAX) '$.polygon',name NVARCHAR(150) '$.name',is_active BIT '$.is_active') scope_fence WHERE sp.status='active' AND ${activePeriod} AND scope_fence.is_active=1`)).recordset;

  for (const position of positions) {
    const priorPosition = await previousPosition(pool, position);
    for (const fence of fences.filter((candidate) => candidate.service_plan_id === position.service_plan_id)) {
      let inside = false;
      try { inside = polygonContains(fence.polygon, [position.longitude, position.latitude]); } catch { continue; }
      const stateRequest = pool.request();
      stateRequest.input("vehicle", sql.Int, position.vehicle_id);
      stateRequest.input("fence", sql.UniqueIdentifier, fence.id);
      const prior = (await stateRequest.query<{ is_inside: boolean; pending_is_inside: boolean | null; pending_confirmations: number; last_report_timestamp: Date | null }>("SELECT is_inside,pending_is_inside,pending_confirmations,last_report_timestamp FROM EventGeofenceVehicleState WHERE vehicle_id=@vehicle AND geofence_id=@fence")).recordset[0];
      if (prior?.last_report_timestamp && new Date(position.report_timestamp).getTime() <= new Date(prior.last_report_timestamp).getTime()) continue;
      if (!prior) {
        const seed = pool.request();
        seed.input("vehicle", sql.Int, position.vehicle_id); seed.input("fence", sql.UniqueIdentifier, fence.id); seed.input("inside", sql.Bit, inside); seed.input("reported", sql.DateTime2, position.report_timestamp);
        await seed.query("INSERT INTO EventGeofenceVehicleState(vehicle_id,geofence_id,is_inside,updated_at,last_report_timestamp) VALUES(@vehicle,@fence,@inside,SYSUTCDATETIME(),@reported)");
        continue;
      }

      const interpolated = priorPosition ? detectQualifiedBoundaryMovements(fence.polygon, { previous: priorPosition, current: position, pollIntervalSeconds: configuredInterval }) : [];
      if (interpolated.length) {
        const update = pool.request();
        update.input("vehicle", sql.Int, position.vehicle_id); update.input("fence", sql.UniqueIdentifier, fence.id); update.input("inside", sql.Bit, inside); update.input("reported", sql.DateTime2, position.report_timestamp);
        await update.query("UPDATE EventGeofenceVehicleState SET is_inside=@inside,pending_is_inside=NULL,pending_confirmations=0,updated_at=SYSUTCDATETIME(),last_report_timestamp=@reported WHERE vehicle_id=@vehicle AND geofence_id=@fence");
        for (const movement of interpolated) await insertCrossing({
          pool, context, position, fence, transition: movement.transition,
          evidence: { detectionMethod: movement.detection_method, sourceFrom: new Date(movement.source_report_from_at), sourceTo: new Date(movement.source_report_to_at), displacementMeters: movement.source_displacement_meters },
        });
        continue;
      }

      const pending = prior.pending_is_inside === inside ? prior.pending_confirmations : 0;
      const confirmations = nextTransitionConfirmations(prior.is_inside, inside, pending);
      const stable = isStableTransition(prior.is_inside, inside, pending);
      const update = pool.request();
      update.input("vehicle", sql.Int, position.vehicle_id); update.input("fence", sql.UniqueIdentifier, fence.id); update.input("inside", sql.Bit, inside); update.input("pending", sql.Bit, inside); update.input("confirmations", sql.Int, confirmations); update.input("reported", sql.DateTime2, position.report_timestamp);
      await update.query(stable
        ? "UPDATE EventGeofenceVehicleState SET is_inside=@inside,pending_is_inside=NULL,pending_confirmations=0,updated_at=SYSUTCDATETIME(),last_report_timestamp=@reported WHERE vehicle_id=@vehicle AND geofence_id=@fence"
        : "UPDATE EventGeofenceVehicleState SET pending_is_inside=@pending,pending_confirmations=@confirmations,updated_at=SYSUTCDATETIME(),last_report_timestamp=@reported WHERE vehicle_id=@vehicle AND geofence_id=@fence");
      if (!stable) continue;
      await insertCrossing({
        pool, context, position, fence, transition: inside ? "enter" : "exit",
        evidence: { detectionMethod: "point_confirmed", sourceFrom: priorPosition?.report_timestamp ?? null, sourceTo: position.report_timestamp, displacementMeters: displacementMeters(priorPosition, position) },
      });
    }
  }
}
