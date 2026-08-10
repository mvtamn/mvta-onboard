import type { InvocationContext } from "@azure/functions";
import { getPool, sql } from "./db";
import { polygonContains, headingInRange } from "./geofence";
import { publishEventGeofenceNotification } from "./events";
import { detectionWindowSeconds, isStableTransition, nextTransitionConfirmations } from "./eventProcessing";

interface Position { vehicle_id: number; route: number | null; latitude: number; longitude: number; heading: number | null; report_timestamp: Date }
interface Fence { id: string; polygon: string; name: string }

export async function detectEventGeofenceCrossings(context: InvocationContext): Promise<void> {
  const pool = await getPool();
  const configuredInterval = (await pool.request().query<{ seconds: number }>(`SELECT COALESCE(TRY_CONVERT(INT, setting_value), 30) seconds FROM AppSettings WHERE module='event' AND setting_key='poll_interval_seconds'`)).recordset[0]?.seconds ?? 30;
  const windowSeconds = detectionWindowSeconds(configuredInterval);
  const positionRequest = pool.request(); positionRequest.input("windowSeconds", sql.Int, windowSeconds);
  const positions = (await positionRequest.query<Position>(`SELECT p.vehicle_id,p.route,p.latitude,p.longitude,p.heading,p.report_timestamp FROM EventVehicleCurrentPosition p WHERE EXISTS (SELECT 1 FROM EventServicePlanRoutes spr JOIN EventServicePlans sp ON sp.id=spr.service_plan_id WHERE sp.status='active' AND spr.route_id=p.route) AND p.report_timestamp >= DATEADD(SECOND,-@windowSeconds,SYSUTCDATETIME())`)).recordset;
  const fences = (await pool.request().query<Fence>(`SELECT g.id,g.polygon,g.name FROM EventGeofences g WHERE g.is_active=1 AND EXISTS (SELECT 1 FROM EventServicePlanGeofences spg JOIN EventServicePlans sp ON sp.id=spg.service_plan_id WHERE sp.status='active' AND spg.geofence_id=g.id)`)).recordset;
  for (const position of positions) for (const fence of fences) {
    let inside = false; try { inside = polygonContains(fence.polygon, [position.longitude, position.latitude]); } catch { continue; }
    const state = pool.request(); state.input("vehicle", sql.Int, position.vehicle_id); state.input("fence", sql.UniqueIdentifier, fence.id);
    const prior = (await state.query<{ is_inside: boolean; pending_is_inside: boolean | null; pending_confirmations: number; last_report_timestamp: Date | null }>("SELECT is_inside,pending_is_inside,pending_confirmations,last_report_timestamp FROM EventGeofenceVehicleState WHERE vehicle_id=@vehicle AND geofence_id=@fence")).recordset[0];
    if (prior?.last_report_timestamp && new Date(position.report_timestamp).getTime() <= new Date(prior.last_report_timestamp).getTime()) continue;
    if (!prior) {
      const seed = pool.request(); seed.input("vehicle", sql.Int, position.vehicle_id); seed.input("fence", sql.UniqueIdentifier, fence.id); seed.input("inside", sql.Bit, inside); seed.input("reported", sql.DateTime2, position.report_timestamp);
      await seed.query("INSERT INTO EventGeofenceVehicleState(vehicle_id,geofence_id,is_inside,updated_at,last_report_timestamp) VALUES(@vehicle,@fence,@inside,SYSUTCDATETIME(),@reported)");
      continue;
    }
    const confirmations = nextTransitionConfirmations(prior.is_inside, inside, prior.pending_is_inside === inside ? prior.pending_confirmations : 0);
    const stable = isStableTransition(prior.is_inside, inside, prior.pending_is_inside === inside ? prior.pending_confirmations : 0);
    const up = pool.request(); up.input("vehicle", sql.Int, position.vehicle_id); up.input("fence", sql.UniqueIdentifier, fence.id); up.input("inside", sql.Bit, inside); up.input("pending", sql.Bit, inside); up.input("confirmations", sql.Int, confirmations); up.input("reported", sql.DateTime2, position.report_timestamp);
    await up.query(stable
      ? "UPDATE EventGeofenceVehicleState SET is_inside=@inside,pending_is_inside=NULL,pending_confirmations=0,updated_at=SYSUTCDATETIME(),last_report_timestamp=@reported WHERE vehicle_id=@vehicle AND geofence_id=@fence"
      : "UPDATE EventGeofenceVehicleState SET pending_is_inside=@pending,pending_confirmations=@confirmations,updated_at=SYSUTCDATETIME(),last_report_timestamp=@reported WHERE vehicle_id=@vehicle AND geofence_id=@fence");
    if (!stable) continue;
    const transition = inside ? "enter" : "exit"; const ruleReq = pool.request(); ruleReq.input("fence", sql.UniqueIdentifier, fence.id); ruleReq.input("transition", sql.NVarChar, transition); const rules = (await ruleReq.query<{ destination_label: string; heading_min: number; heading_max: number; send_mode: string }>("SELECT destination_label,heading_min,heading_max,send_mode FROM EventGeofenceDirectionRules WHERE geofence_id=@fence AND transition=@transition ORDER BY sort_order,id")).recordset; const rule = rules.find((r) => headingInRange(position.heading, r.heading_min, r.heading_max));
    const crossing = pool.request(); crossing.input("vehicle", sql.Int, position.vehicle_id); crossing.input("fence", sql.UniqueIdentifier, fence.id); crossing.input("transition", sql.NVarChar, transition); crossing.input("heading", sql.Float, position.heading); crossing.input("label", sql.NVarChar, rule?.destination_label ?? null); crossing.input("crossed", sql.DateTime2, position.report_timestamp); const result = await crossing.query<{ id: number }>("INSERT INTO EventGeofenceCrossings(vehicle_id,geofence_id,transition,heading_at_crossing,destination_label,crossed_at) OUTPUT INSERTED.id VALUES(@vehicle,@fence,@transition,@heading,@label,@crossed)"); if (rule) await publishEventGeofenceNotification(result.recordset[0].id, context);
  }
}
