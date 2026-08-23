import { app, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { formatEventGeofenceMessage, formatTeamsWebhookPayload, isTransientNotificationFailure, isWithinMovementNotificationCooldown, MOVEMENT_NOTIFICATION_COOLDOWN_REASON, retryDelaySeconds, shouldAutomaticallyDeliver } from "../lib/eventNotificationPolicy";

interface CrossingMessage { crossing_id: number }

async function deliver(notificationId: string, body: string, attemptCount: number, context: InvocationContext): Promise<boolean> {
  const pool = await getPool();
  const webhook = process.env.TEAMS_EVENT_WEBHOOK_URL;
  if (!webhook) {
    await pool.request().input("id", sql.UniqueIdentifier, notificationId).query("UPDATE EventGeofenceNotifications SET last_error='Teams webhook is not configured',next_attempt_at=DATEADD(HOUR,1,SYSUTCDATETIME()) WHERE id=@id AND status='pending'");
    return false;
  }
  let response: Response;
  try {
    response = await fetch(webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(formatTeamsWebhookPayload(body)) });
  } catch (err) {
    context.error("Teams event notification failed", err);
    response = new Response(null, { status: 599 });
  }
  const request = pool.request(); request.input("id", sql.UniqueIdentifier, notificationId); request.input("status", sql.NVarChar, isTransientNotificationFailure(response.status) ? "pending" : "failed"); request.input("error", sql.NVarChar, `Teams webhook returned ${response.status}`); request.input("delay", sql.Int, retryDelaySeconds(attemptCount + 1));
  if (response.ok) await request.query("UPDATE EventGeofenceNotifications SET status='sent',sent_by=NULL,sent_at=SYSUTCDATETIME(),attempt_count=attempt_count+1,last_error=NULL,next_attempt_at=NULL WHERE id=@id AND status='pending'");
  else await request.query("UPDATE EventGeofenceNotifications SET status=@status,attempt_count=attempt_count+1,last_error=@error,next_attempt_at=CASE WHEN @status='pending' THEN DATEADD(SECOND,@delay,SYSUTCDATETIME()) ELSE NULL END WHERE id=@id AND status='pending'");
  return !response.ok && isTransientNotificationFailure(response.status);
}

app.serviceBusQueue("eventGeofenceNotify", { connection: "ServiceBusConnection", queueName: "event-geofence-notifications", handler: async (message: unknown, context: InvocationContext) => {
  const id = (message as CrossingMessage).crossing_id; const pool = await getPool();
  const existing = await pool.request().input("crossing", sql.BigInt, id).query<{ id: string; message_body: string; status: string; attempt_count: number; created_at: Date; send_mode: "manual" | "auto"; service_plan_id: string | null; matched_rule_id: string | null }>("SELECT TOP 1 n.id,n.message_body,n.status,n.attempt_count,n.created_at,n.send_mode,c.service_plan_id,c.matched_rule_id FROM EventGeofenceNotifications n JOIN EventGeofenceCrossings c ON c.id=n.crossing_id WHERE n.crossing_id=@crossing");
  if (existing.recordset[0]) {
    const current = existing.recordset[0];
    if (current.status !== "pending") return;
    if (Date.now() - new Date(current.created_at).getTime() >= 24 * 60 * 60 * 1000) {
      await pool.request().input("id", sql.UniqueIdentifier, current.id).query("UPDATE EventGeofenceNotifications SET status='expired',last_error='Automatic retry window expired',next_attempt_at=NULL WHERE id=@id AND status='pending'");
      return;
    }
    const operational = (await pool.request().input("plan", sql.UniqueIdentifier, current.service_plan_id).query<{ automatic_teams_enabled: boolean }>("SELECT automatic_teams_enabled FROM EventOperationalMessaging WHERE service_plan_id=@plan")).recordset[0];
    if (shouldAutomaticallyDeliver(Boolean(operational?.automatic_teams_enabled), current.matched_rule_id) && await deliver(current.id, current.message_body, current.attempt_count, context)) throw new Error(`Transient Teams failure for event notification ${current.id}`);
    return;
  }
  const row = (await pool.request().input("id", sql.BigInt, id).query("SELECT c.vehicle_id,c.route_id,c.service_plan_id,c.geofence_id,c.transition,c.matched_rule_id,c.crossed_at,g.name geofence_name,g.purpose geofence_purpose,c.destination_label,c.matched_message_type message_type,c.matched_send_mode send_mode,l.name location_name FROM EventGeofenceCrossings c JOIN EventGeofences g ON g.id=c.geofence_id LEFT JOIN EventLocations l ON l.id=c.matched_destination_location_id WHERE c.id=@id")).recordset[0] as { vehicle_id: number; route_id: number | null; service_plan_id: string | null; geofence_id: string; matched_rule_id: string | null; crossed_at: Date; transition: "enter" | "exit"; geofence_name: string; geofence_purpose: string | null; destination_label: string | null; message_type: "departing" | "passed" | "arriving_soon" | "custom" | null; location_name: string | null; send_mode: "manual" | "auto" | null } | undefined;
  if (!row) return;
  const mode = row.send_mode ?? "manual";
  const body = formatEventGeofenceMessage({ ...row, message_type: row.message_type ?? "custom" });
  const previous = row.service_plan_id ? (await pool.request()
    .input("vehicle", sql.Int, row.vehicle_id).input("plan", sql.UniqueIdentifier, row.service_plan_id)
    .input("fence", sql.UniqueIdentifier, row.geofence_id).input("transition", sql.NVarChar, row.transition)
    .input("crossed", sql.DateTime2, row.crossed_at)
    .input("cooldownReason", sql.NVarChar, MOVEMENT_NOTIFICATION_COOLDOWN_REASON)
    .query<{ crossed_at: Date }>(`SELECT TOP (1) c.crossed_at FROM EventGeofenceNotifications n JOIN EventGeofenceCrossings c ON c.id=n.crossing_id WHERE c.vehicle_id=@vehicle AND c.service_plan_id=@plan AND c.geofence_id=@fence AND c.transition=@transition AND NOT (n.status='dismissed' AND n.last_error=@cooldownReason) AND c.crossed_at < @crossed ORDER BY c.crossed_at DESC`)).recordset[0] : undefined;
  const suppressed = isWithinMovementNotificationCooldown(previous?.crossed_at ?? null, row.crossed_at);
  const insert = pool.request(); insert.input("crossing", sql.BigInt, id); insert.input("mode", sql.NVarChar, mode); insert.input("body", sql.NVarChar, body); insert.input("status", sql.NVarChar, suppressed ? "dismissed" : "pending"); insert.input("error", sql.NVarChar, suppressed ? MOVEMENT_NOTIFICATION_COOLDOWN_REASON : null);
  let notification: { id: string };
  try { notification = (await insert.query<{ id: string }>("INSERT INTO EventGeofenceNotifications(crossing_id,send_mode,message_body,status,last_error) OUTPUT INSERTED.id VALUES(@crossing,@mode,@body,@status,@error)")).recordset[0]; }
  catch { return; }
  if (suppressed) return;
  const operational = row.service_plan_id ? (await pool.request().input("plan", sql.UniqueIdentifier, row.service_plan_id).query<{ automatic_teams_enabled: boolean }>("SELECT automatic_teams_enabled FROM EventOperationalMessaging WHERE service_plan_id=@plan")).recordset[0] : undefined;
  if (shouldAutomaticallyDeliver(Boolean(operational?.automatic_teams_enabled), row.matched_rule_id) && await deliver(notification.id, body, 0, context)) throw new Error(`Transient Teams failure for event notification ${notification.id}`);
} });
