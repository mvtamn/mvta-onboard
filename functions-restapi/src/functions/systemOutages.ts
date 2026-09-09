import { randomUUID } from "node:crypto";
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { auditSql } from "../lib/assessment/audit";
import { COMPLIANCE_READ_ROLES, COMPLIANCE_WRITE_ROLES, requireRole } from "../lib/auth";
import { getPool, sql } from "../lib/db";
import { agencyDate } from "../lib/assessment/relief";
import { isGuid, isServiceMonth } from "../lib/validation";

// Attachment G's data protocol: observations made while the observing system
// was down are excluded from penalty calculation. A window is logged when the
// outage is noticed and ended when it ends; scoring and the report exclude
// occurrences whose system and service date fall inside one (lib/assessment/relief).
const SYSTEMS = ["Avail_CAD_AVL", "ITMS", "MDT", "Spare", "Other"] as const;

app.http("systemOutagesList", {
  route: "system-outages", methods: ["GET"], authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, COMPLIANCE_READ_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const month = request.query.get("service_month");
    try {
      const pool = await getPool(); const req = pool.request();
      let where = "";
      // Windows that touch any agency day of the month.
      if (isServiceMonth(month)) { req.input("from", sql.Char(8), `${month}01`); where = `WHERE ${agencyDate("started_at")}<=EOMONTH(CONVERT(date,@from,112)) AND (ended_at IS NULL OR ${agencyDate("ended_at")}>=CONVERT(date,@from,112))`; }
      const result = await req.query(`SELECT * FROM SystemOutageWindows ${where} ORDER BY started_at DESC`);
      return { status: 200, jsonBody: { outages: result.recordset } };
    } catch (error) { context.error("GET system outages failed", error); return { status: 500, jsonBody: { error: "Internal server error" } }; }
  },
});

app.http("systemOutagesCreate", {
  route: "system-outages", methods: ["POST"], authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, COMPLIANCE_WRITE_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    let body: Record<string, unknown>; try { body = await request.json() as Record<string, unknown>; } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON" } }; }
    const started = new Date(String(body.started_at)); const ended = body.ended_at ? new Date(String(body.ended_at)) : null;
    if (!SYSTEMS.includes(body.system as never) || Number.isNaN(started.getTime()) || (ended && (Number.isNaN(ended.getTime()) || ended <= started)) || typeof body.scope_note !== "string" || !body.scope_note.trim())
      return { status: 400, jsonBody: { error: `system (${SYSTEMS.join(", ")}), started_at, scope_note, and an ended_at after started_at if known are required` } };
    try {
      const pool = await getPool(); const req = pool.request(); const id = randomUUID();
      req.input("id", sql.UniqueIdentifier, id); req.input("system", sql.NVarChar(50), body.system); req.input("started", sql.DateTime2, started); req.input("ended", sql.DateTime2, ended); req.input("note", sql.NVarChar(1000), body.scope_note); req.input("actor", sql.NVarChar(200), auth.principal.userDetails ?? "onboard-console");
      await req.query(`INSERT SystemOutageWindows(id,system,started_at,ended_at,scope_note,logged_by) VALUES(@id,@system,@started,@ended,@note,@actor);${auditSql("outage", "@id", "outage_logged", "actor", { after: "(SELECT @system system,@started started_at,@ended ended_at FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)" })}`);
      return { status: 201, jsonBody: { id } };
    } catch (error) { context.error("POST system outage failed", error); return { status: 500, jsonBody: { error: "Internal server error" } }; }
  },
});

app.http("systemOutagePatch", {
  route: "system-outages/{id}", methods: ["PATCH"], authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, COMPLIANCE_WRITE_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    if (!isGuid(request.params.id)) return { status: 400, jsonBody: { error: "Invalid outage id" } };
    let body: Record<string, unknown>; try { body = await request.json() as Record<string, unknown>; } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON" } }; }
    const ended = body.ended_at ? new Date(String(body.ended_at)) : null;
    if (ended && Number.isNaN(ended.getTime())) return { status: 400, jsonBody: { error: "ended_at must be a date" } };
    if (!ended && typeof body.scope_note !== "string") return { status: 400, jsonBody: { error: "ended_at or scope_note is required" } };
    try {
      const pool = await getPool(); const req = pool.request();
      req.input("id", sql.UniqueIdentifier, request.params.id); req.input("ended", sql.DateTime2, ended); req.input("note", sql.NVarChar(1000), typeof body.scope_note === "string" ? body.scope_note : null); req.input("actor", sql.NVarChar(200), auth.principal.userDetails ?? "onboard-console");
      const result = await req.query<{ changed: number }>(`UPDATE SystemOutageWindows SET ended_at=ISNULL(@ended,ended_at),scope_note=ISNULL(@note,scope_note) WHERE id=@id AND (@ended IS NULL OR @ended>started_at);DECLARE @changed INT=@@ROWCOUNT;IF @changed=1 ${auditSql("outage", "@id", "outage_updated", "actor", { after: "(SELECT @ended ended_at FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)" })}SELECT @changed changed;`);
      if (!result.recordset[0]?.changed) return { status: 409, jsonBody: { error: "Outage not found, or ended_at is not after started_at" } };
      return { status: 200, jsonBody: { id: request.params.id } };
    } catch (error) { context.error("PATCH system outage failed", error); return { status: 500, jsonBody: { error: "Internal server error" } }; }
  },
});
