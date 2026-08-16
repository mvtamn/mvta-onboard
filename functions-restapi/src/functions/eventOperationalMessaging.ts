import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { EVENT_AVL_WRITE_ROLES, requireRole, STAFF_READ_ROLES } from "../lib/auth";

function responseFor(servicePlanId: string, row: { automatic_teams_enabled: boolean; updated_by: string | null; updated_at: Date } | undefined) {
  return {
    service_plan_id: servicePlanId,
    automatic_teams_enabled: Boolean(row?.automatic_teams_enabled),
    teams_configured: Boolean(process.env.TEAMS_EVENT_WEBHOOK_URL),
    teams_destination: process.env.TEAMS_EVENT_CHANNEL_NAME ?? "Configured Teams channel",
    updated_by: row?.updated_by ?? null,
    updated_at: row?.updated_at ?? null,
  };
}

app.http("eventOperationalMessaging", {
  route: "event-operational-messaging",
  methods: ["GET", "PATCH"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(req, req.method === "GET" ? STAFF_READ_ROLES : EVENT_AVL_WRITE_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const servicePlanId = req.query.get("service_plan_id");
    if (!servicePlanId) return { status: 400, jsonBody: { error: "service_plan_id is required" } };
    try {
      const pool = await getPool();
      const plan = (await pool.request().input("plan", sql.UniqueIdentifier, servicePlanId).query<{ id: string; status: string }>("SELECT id,status FROM EventServicePlans WHERE id=@plan")).recordset[0];
      if (!plan) return { status: 404, jsonBody: { error: "Operating period not found" } };
      if (req.method === "GET") {
        const row = (await pool.request().input("plan", sql.UniqueIdentifier, servicePlanId).query<{ automatic_teams_enabled: boolean; updated_by: string | null; updated_at: Date }>("SELECT automatic_teams_enabled,updated_by,updated_at FROM EventOperationalMessaging WHERE service_plan_id=@plan")).recordset[0];
        return { status: 200, jsonBody: responseFor(servicePlanId, row) };
      }
      if (plan.status !== "active") return { status: 409, jsonBody: { error: "Teams delivery can only be changed for an active operating period" } };
      let body: unknown;
      try { body = await req.json(); } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON" } }; }
      if (typeof (body as { automatic_teams_enabled?: unknown }).automatic_teams_enabled !== "boolean") return { status: 400, jsonBody: { error: "automatic_teams_enabled must be boolean" } };
      const enabled = (body as { automatic_teams_enabled: boolean }).automatic_teams_enabled;
      const actor = auth.principal.userDetails ?? "system";
      const request = pool.request(); request.input("plan", sql.UniqueIdentifier, servicePlanId); request.input("enabled", sql.Bit, enabled); request.input("by", sql.NVarChar, actor);
      const row = (await request.query<{ automatic_teams_enabled: boolean; updated_by: string | null; updated_at: Date }>(`
        MERGE EventOperationalMessaging WITH (HOLDLOCK) AS target
        USING (SELECT @plan service_plan_id) AS source ON target.service_plan_id=source.service_plan_id
        WHEN MATCHED THEN UPDATE SET automatic_teams_enabled=@enabled,updated_by=@by,updated_at=SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT(service_plan_id,automatic_teams_enabled,updated_by) VALUES(@plan,@enabled,@by)
        OUTPUT INSERTED.automatic_teams_enabled,INSERTED.updated_by,INSERTED.updated_at;
      `)).recordset[0];
      return { status: 200, jsonBody: responseFor(servicePlanId, row) };
    } catch (error) {
      context.error(`${req.method} /event-operational-messaging failed:`, error);
      return { status: 500, jsonBody: { error: "Unable to update Event AVL messaging controls" } };
    }
  },
});
