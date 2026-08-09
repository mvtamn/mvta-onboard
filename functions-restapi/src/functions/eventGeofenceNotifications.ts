import { app, type HttpRequest } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, PUBLISH_ROLES, STAFF_READ_ROLES } from "../lib/auth";

async function change(req: HttpRequest, status: "sent" | "dismissed") {
  const auth = requireRole(req, PUBLISH_ROLES);
  if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  const pool = await getPool();
  const r = pool.request();
  r.input("id", sql.UniqueIdentifier, req.params.id); r.input("status", sql.NVarChar, status); r.input("by", sql.NVarChar, auth.principal.userDetails ?? "system");
  if (status === "sent") {
    const pending = await pool.request().input("id", sql.UniqueIdentifier, req.params.id).query<{ message_body: string }>("SELECT message_body FROM EventGeofenceNotifications WHERE id=@id AND status='pending'");
    if (!pending.recordset[0]) return { status: 409, jsonBody: { error: "Notification is no longer pending" } };
    const webhook = process.env.TEAMS_EVENT_WEBHOOK_URL;
    if (!webhook) return { status: 503, jsonBody: { error: "Teams webhook is not configured" } };
    const response = await fetch(webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: pending.recordset[0].message_body }) });
    if (!response.ok) return { status: 502, jsonBody: { error: "Teams webhook rejected the notification" } };
  }
  const out = await r.query("UPDATE EventGeofenceNotifications SET status=@status, sent_by=CASE WHEN @status='sent' THEN @by ELSE sent_by END, sent_at=CASE WHEN @status='sent' THEN SYSUTCDATETIME() ELSE sent_at END WHERE id=@id AND status='pending'");
  return out.rowsAffected[0] ? { status: 200, jsonBody: { ok: true } } : { status: 409, jsonBody: { error: "Notification is no longer pending" } };
}
app.http("eventGeofenceNotifications", {
  route: "event-geofence-notifications", methods: ["GET"], authLevel: "anonymous",
  handler: async (req: HttpRequest) => {
    const auth = requireRole(req, STAFF_READ_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const r = (await getPool()).request(); r.input("status", sql.NVarChar, req.query.get("status") ?? "pending");
    return { status: 200, jsonBody: { notifications: (await r.query("SELECT * FROM EventGeofenceNotifications WHERE status=@status ORDER BY created_at DESC")).recordset } };
  },
});
app.http("eventGeofenceNotificationSend", { route: "event-geofence-notifications/{id}/send", methods: ["POST"], authLevel: "anonymous", handler: async (req) => change(req, "sent") });
app.http("eventGeofenceNotificationDismiss", { route: "event-geofence-notifications/{id}/dismiss", methods: ["POST"], authLevel: "anonymous", handler: async (req) => change(req, "dismissed") });
