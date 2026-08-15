import { app, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { formatEventGeofenceMessage, isTransientNotificationFailure, retryDelaySeconds } from "../lib/eventNotificationPolicy";

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
    response = await fetch(webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: body }) });
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
  const existing = await pool.request().input("crossing", sql.BigInt, id).query<{ id: string; message_body: string; status: string; attempt_count: number; created_at: Date }>("SELECT TOP 1 id,message_body,status,attempt_count,created_at FROM EventGeofenceNotifications WHERE crossing_id=@crossing");
  if (existing.recordset[0]) {
    const current = existing.recordset[0];
    if (current.status !== "pending") return;
    if (Date.now() - new Date(current.created_at).getTime() >= 24 * 60 * 60 * 1000) {
      await pool.request().input("id", sql.UniqueIdentifier, current.id).query("UPDATE EventGeofenceNotifications SET status='expired',last_error='Automatic retry window expired',next_attempt_at=NULL WHERE id=@id AND status='pending'");
      return;
    }
    if (await deliver(current.id, current.message_body, current.attempt_count, context)) throw new Error(`Transient Teams failure for event notification ${current.id}`);
    return;
  }
  const row = (await pool.request().input("id", sql.BigInt, id).query("SELECT c.vehicle_id,c.route_id,c.transition,g.name geofence_name,c.destination_label,c.matched_send_mode send_mode FROM EventGeofenceCrossings c JOIN EventGeofences g ON g.id=c.geofence_id WHERE c.id=@id")).recordset[0] as { vehicle_id: number; route_id: number | null; transition: "enter" | "exit"; geofence_name: string; destination_label: string | null; send_mode: "manual" | "auto" | null } | undefined;
  if (!row?.send_mode) return;
  const body = formatEventGeofenceMessage(row);
  const insert = pool.request(); insert.input("crossing", sql.BigInt, id); insert.input("mode", sql.NVarChar, row.send_mode); insert.input("body", sql.NVarChar, body);
  let notification: { id: string };
  try { notification = (await insert.query<{ id: string }>("INSERT INTO EventGeofenceNotifications(crossing_id,send_mode,message_body,status) OUTPUT INSERTED.id VALUES(@crossing,@mode,@body,'pending')")).recordset[0]; }
  catch { return; }
  if (row.send_mode === "auto" && await deliver(notification.id, body, 0, context)) throw new Error(`Transient Teams failure for event notification ${notification.id}`);
} });
