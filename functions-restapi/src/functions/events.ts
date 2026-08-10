import { app, type HttpRequest } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, ADMIN_ROLES } from "../lib/auth";

async function authorized(req: HttpRequest) {
  return requireRole(req, ADMIN_ROLES);
}

app.http("events", {
  route: "events",
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest) => {
    const auth = await authorized(req);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const pool = await getPool();
    if (req.method === "GET") {
      const events = (await pool.request().query("SELECT * FROM Events ORDER BY created_at DESC")).recordset;
      return { status: 200, jsonBody: { events } };
    }
    const body = await req.json() as Record<string, unknown>;
    if (typeof body.name !== "string" || !body.name.trim()) return { status: 400, jsonBody: { error: "name is required" } };
    const request = pool.request();
    request.input("name", sql.NVarChar, body.name.trim());
    request.input("description", sql.NVarChar, typeof body.description === "string" ? body.description : null);
    request.input("team", sql.NVarChar, typeof body.owning_team === "string" ? body.owning_team : null);
    request.input("by", sql.NVarChar, auth.principal.userDetails ?? "system");
    const event = (await request.query("INSERT INTO Events(name,description,owning_team,created_by,updated_by) OUTPUT INSERTED.* VALUES(@name,@description,@team,@by,@by)")).recordset[0];
    return { status: 201, jsonBody: event };
  },
});
