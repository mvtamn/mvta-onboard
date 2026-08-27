import { app, type HttpRequest } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, EVENT_AVL_NOTIFICATION_ROLES, STAFF_READ_ROLES } from "../lib/auth";
import { formatTeamsWebhookPayload, isTransientNotificationFailure } from "../lib/eventNotificationPolicy";
import { claimEventNotification, EVENT_NOTIFICATION_DELIVERY_LEASE_MINUTES, finishEventNotificationDelivery } from "../lib/eventNotificationDelivery";

async function send(req: HttpRequest) {
  const auth = requireRole(req, EVENT_AVL_NOTIFICATION_ROLES);
  if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  const pool = await getPool(); const id = req.params.id;
  const row = (await pool.request().input("id", sql.UniqueIdentifier, id).query<{ status: string; created_at: Date; delivery_claimed_at: Date | null }>("SELECT status,created_at,delivery_claimed_at FROM EventGeofenceNotifications WHERE id=@id")).recordset[0];
  if (!row) return { status: 404, jsonBody: { error: "Notification not found" } };
  const staleDeliveryLease = row.status === "sending" && row.delivery_claimed_at !== null && Date.now() - new Date(row.delivery_claimed_at).getTime() >= EVENT_NOTIFICATION_DELIVERY_LEASE_MINUTES * 60 * 1000;
  if (!["pending", "acknowledged"].includes(row.status) && !staleDeliveryLease) return { status: 409, jsonBody: { error: "Notification is already being delivered or is no longer actionable" } };
  if (Date.now() - new Date(row.created_at).getTime() >= 24 * 60 * 60 * 1000) {
    await pool.request().input("id", sql.UniqueIdentifier, id).query("UPDATE EventGeofenceNotifications SET status='expired',last_error='Manual review window expired' WHERE id=@id AND status IN ('pending','acknowledged')");
    return { status: 409, jsonBody: { error: "Notification has expired" } };
  }
  const webhook = process.env.TEAMS_EVENT_WEBHOOK_URL;
  if (!webhook) {
    await pool.request().input("id", sql.UniqueIdentifier, id).query("UPDATE EventGeofenceNotifications SET last_error='Teams webhook is not configured',attempt_count=attempt_count+1,next_attempt_at=DATEADD(HOUR,1,SYSUTCDATETIME()) WHERE id=@id AND status IN ('pending','acknowledged')");
    return { status: 503, jsonBody: { error: "Teams webhook is not configured" } };
  }
  const claim = await claimEventNotification(pool, id, "manual");
  if (!claim) return { status: 409, jsonBody: { error: "Notification is already being delivered or is no longer actionable" } };
  let response: Response;
  try { response = await fetch(webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(formatTeamsWebhookPayload(claim.message_body)), signal: AbortSignal.timeout(30_000) }); }
  catch { response = new Response(null, { status: 599 }); }
  const status = isTransientNotificationFailure(response.status) ? "pending" : "failed";
  await finishEventNotificationDelivery(pool, claim, response.ok ? "sent" : status, response.ok ? null : `Teams webhook returned ${response.status}`, auth.principal.userDetails ?? "system");
  if (response.ok) return { status: 200, jsonBody: { ok: true } };
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
  await pool.request().query("UPDATE EventGeofenceNotifications SET status='expired',last_error='Manual review window expired',delivery_claim_token=NULL,delivery_claimed_at=NULL WHERE status IN ('pending','acknowledged','sending') AND created_at <= DATEADD(HOUR,-24,SYSUTCDATETIME())");
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
