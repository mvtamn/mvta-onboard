import type { InvocationContext } from "@azure/functions";
import { getPool, sql } from "./db";
import { polygonContains, headingInRange } from "./geofence";
import { publishEventGeofenceNotification } from "./events";

interface Position { vehicle_id: number; latitude: number; longitude: number; heading: number | null }
interface Fence { id: string; polygon: string; name: string }

export async function detectEventGeofenceCrossings(context: InvocationContext): Promise<void> {
  const pool = await getPool();
  const positions = (await pool.request().query<Position>(`SELECT p.vehicle_id,p.latitude,p.longitude,p.heading FROM EventVehicleCurrentPosition p WHERE EXISTS (SELECT 1 FROM EventServicePlanRoutes spr JOIN EventServicePlans sp ON sp.id=spr.service_plan_id WHERE sp.status='active' AND spr.route_id=p.route) AND p.report_timestamp >= DATEADD(MINUTE,-3,SYSUTCDATETIME())`)).recordset;
  const fences = (await pool.request().query<Fence>(`SELECT g.id,g.polygon,g.name FROM EventGeofences g WHERE g.is_active=1 AND EXISTS (SELECT 1 FROM EventServicePlanGeofences spg JOIN EventServicePlans sp ON sp.id=spg.service_plan_id WHERE sp.status='active' AND spg.geofence_id=g.id)`)).recordset;
  for (const position of positions) for (const fence of fences) {
    let inside = false; try { inside = polygonContains(fence.polygon, [position.longitude, position.latitude]); } catch { continue; }
    const state = pool.request(); state.input("vehicle", sql.Int, position.vehicle_id); state.input("fence", sql.UniqueIdentifier, fence.id); const prior = (await state.query<{ is_inside: boolean }>("SELECT is_inside FROM EventGeofenceVehicleState WHERE vehicle_id=@vehicle AND geofence_id=@fence")).recordset[0];
    const up = pool.request(); up.input("vehicle", sql.Int, position.vehicle_id); up.input("fence", sql.UniqueIdentifier, fence.id); up.input("inside", sql.Bit, inside); await up.query("MERGE EventGeofenceVehicleState WITH(HOLDLOCK) AS t USING(SELECT @vehicle vehicle_id,@fence geofence_id) s ON t.vehicle_id=s.vehicle_id AND t.geofence_id=s.geofence_id WHEN MATCHED THEN UPDATE SET is_inside=@inside,updated_at=SYSUTCDATETIME() WHEN NOT MATCHED THEN INSERT(vehicle_id,geofence_id,is_inside) VALUES(@vehicle,@fence,@inside);");
    if (!prior || prior.is_inside === inside) continue;
    const transition = inside ? "enter" : "exit"; const ruleReq = pool.request(); ruleReq.input("fence", sql.UniqueIdentifier, fence.id); ruleReq.input("transition", sql.NVarChar, transition); const rules = (await ruleReq.query<{ destination_label: string; heading_min: number; heading_max: number; send_mode: string }>("SELECT destination_label,heading_min,heading_max,send_mode FROM EventGeofenceDirectionRules WHERE geofence_id=@fence AND transition=@transition ORDER BY sort_order,id")).recordset; const rule = rules.find((r) => headingInRange(position.heading, r.heading_min, r.heading_max));
    const crossing = pool.request(); crossing.input("vehicle", sql.Int, position.vehicle_id); crossing.input("fence", sql.UniqueIdentifier, fence.id); crossing.input("transition", sql.NVarChar, transition); crossing.input("heading", sql.Float, position.heading); crossing.input("label", sql.NVarChar, rule?.destination_label ?? null); const result = await crossing.query<{ id: number }>("INSERT INTO EventGeofenceCrossings(vehicle_id,geofence_id,transition,heading_at_crossing,destination_label) OUTPUT INSERTED.id VALUES(@vehicle,@fence,@transition,@heading,@label)"); await publishEventGeofenceNotification(result.recordset[0].id, context);
  }
}
