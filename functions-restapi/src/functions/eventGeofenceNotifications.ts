import { app, type HttpRequest } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, EVENT_AVL_NOTIFICATION_ROLES, STAFF_READ_ROLES } from "../lib/auth";
import { isTransientNotificationFailure, retryDelaySeconds } from "../lib/eventNotificationPolicy";

async function send(req: HttpRequest) {
  const auth = requireRole(req, EVENT_AVL_NOTIFICATION_ROLES);
  if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  const pool = await getPool(); const id = req.params.id;
  const row = (await pool.request().input("id", sql.UniqueIdentifier, id).query<{ message_body: string; status: string; created_at: Date; attempt_count: number }>("SELECT message_body,status,created_at,attempt_count FROM EventGeofenceNotifications WHERE id=@id")).recordset[0];
  if (!row) return { status: 404, jsonBody: { error: "Notification not found" } };
  if (!["pending", "acknowledged"].includes(row.status)) return { status: 409, jsonBody: { error: "Notification is no longer actionable" } };
  if (Date.now() - new Date(row.created_at).getTime() >= 24 * 60 * 60 * 1000) {
    await pool.request().input("id", sql.UniqueIdentifier, id).query("UPDATE EventGeofenceNotifications SET status='expired',last_error='Manual review window expired' WHERE id=@id AND status IN ('pending','acknowledged')");
    return { status: 409, jsonBody: { error: "Notification has expired" } };
  }
  const webhook = process.env.TEAMS_EVENT_WEBHOOK_URL;
  if (!webhook) {
    await pool.request().input("id", sql.UniqueIdentifier, id).query("UPDATE EventGeofenceNotifications SET last_error='Teams webhook is not configured',attempt_count=attempt_count+1,next_attempt_at=DATEADD(HOUR,1,SYSUTCDATETIME()) WHERE id=@id AND status IN ('pending','acknowledged')");
    return { status: 503, jsonBody: { error: "Teams webhook is not configured" } };
  }
  let response: Response;
  try { response = await fetch(webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: row.message_body }) }); }
  catch { response = new Response(null, { status: 599 }); }
  const status = isTransientNotificationFailure(response.status) ? "pending" : "failed";
  const update = pool.request(); update.input("id", sql.UniqueIdentifier, id); update.input("status", sql.NVarChar, status); update.input("error", sql.NVarChar, `Teams webhook returned ${response.status}`); update.input("delay", sql.Int, retryDelaySeconds(row.attempt_count + 1)); update.input("by", sql.NVarChar, auth.principal.userDetails ?? "system");
  if (response.ok) { await update.query("UPDATE EventGeofenceNotifications SET status='sent',sent_by=@by,sent_at=SYSUTCDATETIME(),attempt_count=attempt_count+1,last_error=NULL,next_attempt_at=NULL WHERE id=@id AND status IN ('pending','acknowledged')"); return { status: 200, jsonBody: { ok: true } }; }
  await update.query("UPDATE EventGeofenceNotifications SET status=@status,attempt_count=attempt_count+1,last_error=@error,next_attempt_at=CASE WHEN @status='pending' THEN DATEADD(SECOND,@delay,SYSUTCDATETIME()) ELSE NULL END WHERE id=@id AND status IN ('pending','acknowledged')");
  return { status: isTransientNotificationFailure(response.status) ? 503 : 502, jsonBody: { error: "Teams webhook rejected the notification" } };
}

async function dismiss(req: HttpRequest) {
  const auth = requireRole(req, EVENT_AVL_NOTIFICATION_ROLES); if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  const pool = await getPool(); const r = pool.request(); r.input("id", sql.UniqueIdentifier, req.params.id); r.input("by", sql.NVarChar, auth.principal.userDetails ?? "system");
  const out = await r.query("UPDATE EventGeofenceNotifications SET status='dismissed',sent_by=@by WHERE id=@id AND status IN ('pending','acknowledged')"); return out.rowsAffected[0] ? { status: 200, jsonBody: { ok: true } } : { status: 409, jsonBody: { error: "Notification is no longer actionable" } };
}

async function acknowledge(req: HttpRequest) {
  const auth = requireRole(req, EVENT_AVL_NOTIFICATION_ROLES); if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  const pool = await getPool(); const r = pool.request(); r.input("id", sql.UniqueIdentifier, req.params.id); r.input("by", sql.NVarChar, auth.principal.userDetails ?? "system");
  const out = await r.query("UPDATE EventGeofenceNotifications SET status='acknowledged',acknowledged_by=@by,acknowledged_at=SYSUTCDATETIME() WHERE id=@id AND status='pending'");
  return out.rowsAffected[0] ? { status: 200, jsonBody: { ok: true } } : { status: 409, jsonBody: { error: "Notification is no longer pending" } };
}

app.http("eventGeofenceNotifications", { route: "event-geofence-notifications", methods: ["GET"], authLevel: "anonymous", handler: async (req: HttpRequest) => {
  const auth = requireRole(req, STAFF_READ_ROLES); if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  const pool = await getPool();
  await pool.request().query("UPDATE EventGeofenceNotifications SET status='expired',last_error='Manual review window expired' WHERE status='pending' AND created_at <= DATEADD(HOUR,-24,SYSUTCDATETIME())");
  const r = pool.request(); r.input("status", sql.NVarChar, req.query.get("status") ?? "pending");
  const eventId = req.query.get("event_id");
  const servicePlanId = req.query.get("service_plan_id");
  if (eventId) r.input("event", sql.UniqueIdentifier, eventId);
  if (servicePlanId) r.input("plan", sql.UniqueIdentifier, servicePlanId);
  return { status: 200, jsonBody: { notifications: (await r.query(`
    SELECT TOP (200) n.*
    FROM EventGeofenceNotifications n
    JOIN EventGeofenceCrossings c ON c.id=n.crossing_id
    WHERE ${req.query.get("status") === "all" ? "1=1" : "n.status=@status"} ${eventId ? "AND (EXISTS (SELECT 1 FROM EventServicePlans p WHERE p.id=c.service_plan_id AND p.event_id=@event) OR (c.service_plan_id IS NULL AND EXISTS (SELECT 1 FROM EventServicePlanGeofences pg JOIN EventServicePlans p ON p.id=pg.service_plan_id WHERE pg.geofence_id=c.geofence_id AND p.event_id=@event)))" : ""} ${servicePlanId ? "AND (c.service_plan_id=@plan OR (c.service_plan_id IS NULL AND EXISTS (SELECT 1 FROM EventServicePlanGeofences pg WHERE pg.geofence_id=c.geofence_id AND pg.service_plan_id=@plan)))" : ""}
    ORDER BY n.created_at DESC`)).recordset } };
} });
app.http("eventGeofenceNotificationSend", { route: "event-geofence-notifications/{id}/send", methods: ["POST"], authLevel: "anonymous", handler: send });
app.http("eventGeofenceNotificationDismiss", { route: "event-geofence-notifications/{id}/dismiss", methods: ["POST"], authLevel: "anonymous", handler: dismiss });
app.http("eventGeofenceNotificationAcknowledge", { route: "event-geofence-notifications/{id}/acknowledge", methods: ["POST"], authLevel: "anonymous", handler: acknowledge });
