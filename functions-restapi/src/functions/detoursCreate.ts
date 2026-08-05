// POST /detours - create a detour/closure record (manual entry).
// `source` is never accepted from the request body - every detour created
// through this endpoint is `source='manual'`; only the future Avail sync
// (Part B4) ever writes `source='avail'` rows. Publisher/Admin only, same
// tier as posting a rider message.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, PUBLISH_ROLES } from "../lib/auth";
import { validateCreateDetour } from "../lib/validation";
import type { CreateDetourBody } from "../lib/types";

interface InsertedDetour {
  id: string;
  created_at: Date;
}

app.http("detoursCreate", {
  route: "detours",
  methods: ["POST"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, PUBLISH_ROLES);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
    }

    const errors = validateCreateDetour(raw as Record<string, unknown>);
    if (errors.length > 0) {
      return { status: 400, jsonBody: { error: "Validation failed", details: errors } };
    }
    const body = raw as CreateDetourBody;
    const createdBy = authResult.principal.userDetails || "system";

    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();

      const insertReq = new sql.Request(tx);
      insertReq.input("number", sql.NVarChar, body.number ?? null);
      insertReq.input("closure", sql.NVarChar, body.closure);
      insertReq.input("start_date", sql.Date, body.start_date ?? null);
      insertReq.input("end_date", sql.Date, body.end_date ?? null);
      insertReq.input("is_monitor_only", sql.Bit, body.is_monitor_only ?? false);
      insertReq.input("riders_directed", sql.NVarChar, body.riders_directed ?? null);
      insertReq.input("email_sent", sql.Bit, body.email_sent ?? false);
      insertReq.input("expired_email_sent", sql.Bit, body.expired_email_sent ?? false);
      insertReq.input("spare_emailed", sql.Bit, body.spare_emailed ?? false);
      insertReq.input("created_by", sql.NVarChar, createdBy);
      const result = await insertReq.query<InsertedDetour>(`
        INSERT INTO Detours (
          number, closure, start_date, end_date, is_monitor_only, riders_directed,
          email_sent, expired_email_sent, spare_emailed, source, created_by
        )
        OUTPUT INSERTED.id, INSERTED.created_at
        VALUES (
          @number, @closure, @start_date, @end_date, @is_monitor_only, @riders_directed,
          @email_sent, @expired_email_sent, @spare_emailed, 'manual', @created_by
        )
      `);
      const inserted = result.recordset[0];

      for (const [i, seg] of (body.segments ?? []).entries()) {
        const segReq = new sql.Request(tx);
        segReq.input("detour_id", sql.UniqueIdentifier, inserted.id);
        segReq.input("routes", sql.NVarChar, seg.routes);
        segReq.input("directions", sql.NVarChar, seg.directions ?? null);
        segReq.input("sort_order", sql.Int, seg.sort_order ?? i);
        await segReq.query(`
          INSERT INTO DetourSegments (detour_id, routes, directions, sort_order)
          VALUES (@detour_id, @routes, @directions, @sort_order)
        `);
      }

      await tx.commit();
      return { status: 201, jsonBody: { id: inserted.id, created_at: inserted.created_at } };
    } catch (err) {
      try {
        await tx.rollback();
      } catch {
        /* already rolled back / not begun */
      }
      context.error("POST /detours failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
