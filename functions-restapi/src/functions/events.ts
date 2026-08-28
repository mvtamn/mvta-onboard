import { app, type HttpRequest } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole } from "../lib/auth";
import { eventOperatingContextRoles } from "../lib/eventOperatingContextAuth";

async function authorized(req: HttpRequest) {
  return requireRole(req, eventOperatingContextRoles(req.method));
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

app.http("eventById", {
  route: "events/{id}",
  methods: ["GET", "PATCH"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest) => {
    const auth = await authorized(req);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const pool = await getPool();
    const id = req.params.id;
    if (req.method === "GET") {
      const event = (await pool.request().input("id", sql.UniqueIdentifier, id).query("SELECT * FROM Events WHERE id=@id")).recordset[0];
      return event ? { status: 200, jsonBody: event } : { status: 404, jsonBody: { error: "Event not found" } };
    }
    const body = await req.json() as Record<string, unknown>;
    const fields: string[] = [];
    const request = pool.request().input("id", sql.UniqueIdentifier, id).input("by", sql.NVarChar, auth.principal.userDetails ?? "system");
    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim()) return { status: 400, jsonBody: { error: "name must not be empty" } };
      request.input("name", sql.NVarChar, body.name.trim()); fields.push("name=@name");
    }
    if (body.description !== undefined) { request.input("description", sql.NVarChar, typeof body.description === "string" ? body.description.trim() || null : null); fields.push("description=@description"); }
    if (body.owning_team !== undefined) { request.input("team", sql.NVarChar, typeof body.owning_team === "string" ? body.owning_team.trim() || null : null); fields.push("owning_team=@team"); }
    if (!fields.length) return { status: 400, jsonBody: { error: "At least one Event field is required" } };
    fields.push("updated_by=@by", "updated_at=SYSUTCDATETIME()");
    const updated = (await request.query(`UPDATE Events SET ${fields.join(",")} OUTPUT INSERTED.* WHERE id=@id`)).recordset[0];
    return updated ? { status: 200, jsonBody: updated } : { status: 404, jsonBody: { error: "Event not found" } };
  },
});
