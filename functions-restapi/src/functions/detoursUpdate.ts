// PATCH /detours/{id} - partial edit. Publisher/Admin only.
//
// If the row being edited is source='avail' (came from the future Avail
// sync, Part B4), this stamps last_edited_manually=1 unconditionally - the
// sync then skips overwriting this row's editable fields on its next run
// (Part B5), preserving the human correction rather than silently reverting
// it. Harmless no-op for source='manual' rows (they're never touched by the
// sync regardless).
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, PUBLISH_ROLES } from "../lib/auth";
import { validateUpdateDetour, isGuid } from "../lib/validation";
import type { UpdateDetourBody } from "../lib/types";

interface UpdatedDetour {
  id: string;
  updated_at: Date;
}

app.http("detoursUpdate", {
  route: "detours/{id}",
  methods: ["PATCH"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, PUBLISH_ROLES);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }

    const id = request.params.id;
    if (!isGuid(id)) {
      return { status: 400, jsonBody: { error: "id must be a GUID" } };
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
    }
    const errors = validateUpdateDetour(raw as Record<string, unknown>);
    if (errors.length > 0) {
      return { status: 400, jsonBody: { error: "Validation failed", details: errors } };
    }
    const body = raw as UpdateDetourBody;
    const updatedBy = authResult.principal.userDetails || "system";

    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();

      const updateReq = new sql.Request(tx);
      updateReq.input("id", sql.UniqueIdentifier, id);
      updateReq.input("updated_by", sql.NVarChar, updatedBy);

      const sets: string[] = [
        "updated_at = SYSUTCDATETIME()",
        "updated_by = @updated_by",
        "last_edited_manually = CASE WHEN source = 'avail' THEN 1 ELSE last_edited_manually END",
      ];
      if (body.number !== undefined) {
        sets.push("number = @number");
        updateReq.input("number", sql.NVarChar, body.number);
      }
      if (body.closure !== undefined) {
        sets.push("closure = @closure");
        updateReq.input("closure", sql.NVarChar, body.closure);
      }
      if (body.start_date !== undefined) {
        sets.push("start_date = @start_date");
        updateReq.input("start_date", sql.Date, body.start_date);
      }
      if (body.end_date !== undefined) {
        sets.push("end_date = @end_date");
        updateReq.input("end_date", sql.Date, body.end_date);
      }
      if (body.is_monitor_only !== undefined) {
        sets.push("is_monitor_only = @is_monitor_only");
        updateReq.input("is_monitor_only", sql.Bit, body.is_monitor_only);
      }
      if (body.riders_directed !== undefined) {
        sets.push("riders_directed = @riders_directed");
        updateReq.input("riders_directed", sql.NVarChar, body.riders_directed);
      }
      if (body.email_sent !== undefined) {
        sets.push("email_sent = @email_sent");
        updateReq.input("email_sent", sql.Bit, body.email_sent);
      }
      if (body.expired_email_sent !== undefined) {
        sets.push("expired_email_sent = @expired_email_sent");
        updateReq.input("expired_email_sent", sql.Bit, body.expired_email_sent);
      }
      if (body.spare_emailed !== undefined) {
        sets.push("spare_emailed = @spare_emailed");
        updateReq.input("spare_emailed", sql.Bit, body.spare_emailed);
      }

      const result = await updateReq.query<UpdatedDetour>(`
        UPDATE Detours
        SET ${sets.join(", ")}
        OUTPUT INSERTED.id, INSERTED.updated_at
        WHERE id = @id AND is_deleted = 0
      `);

      if (result.recordset.length === 0) {
        await tx.rollback();
        return { status: 404, jsonBody: { error: "Detour not found" } };
      }

      if (body.segments !== undefined) {
        const deleteSegReq = new sql.Request(tx);
        deleteSegReq.input("detour_id", sql.UniqueIdentifier, id);
        await deleteSegReq.query("DELETE FROM DetourSegments WHERE detour_id = @detour_id");

        for (const [i, seg] of body.segments.entries()) {
          const segReq = new sql.Request(tx);
          segReq.input("detour_id", sql.UniqueIdentifier, id);
          segReq.input("routes", sql.NVarChar, seg.routes);
          segReq.input("directions", sql.NVarChar, seg.directions ?? null);
          segReq.input("sort_order", sql.Int, seg.sort_order ?? i);
          await segReq.query(`
            INSERT INTO DetourSegments (detour_id, routes, directions, sort_order)
            VALUES (@detour_id, @routes, @directions, @sort_order)
          `);
        }
      }

      await tx.commit();
      return { status: 200, jsonBody: result.recordset[0] };
    } catch (err) {
      try {
        await tx.rollback();
      } catch {
        /* already rolled back / not begun */
      }
      context.error("PATCH /detours/{id} failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
