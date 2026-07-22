// PATCH /messages/{id} - edit a message's summary and/or expiration
// (architecture doc Section 9). Publisher/Admin only.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, PUBLISH_ROLES } from "../lib/auth";
import { validateUpdateMessage, isGuid } from "../lib/validation";

app.http("messagesUpdate", {
  route: "messages/{id}",
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
    const errors = validateUpdateMessage(raw as Record<string, unknown>);
    if (errors.length > 0) {
      return { status: 400, jsonBody: { error: "Validation failed", details: errors } };
    }
    const body = raw as { summary?: string; expires_at?: string };

    try {
      const pool = await getPool();
      const sqlRequest = pool.request();
      sqlRequest.input("id", sql.UniqueIdentifier, id);

      const sets: string[] = ["updated_at = SYSUTCDATETIME()"];
      if (body.summary !== undefined) {
        sets.push("summary = @summary");
        sqlRequest.input("summary", sql.NVarChar, body.summary);
      }
      if (body.expires_at !== undefined) {
        sets.push("expires_at = @expires_at");
        sqlRequest.input("expires_at", sql.DateTime2, new Date(body.expires_at));
      }

      const result = await sqlRequest.query<{
        message_id: string;
        summary: string | null;
        expires_at: Date;
        updated_at: Date;
      }>(`
        UPDATE Messages
        SET ${sets.join(", ")}
        OUTPUT INSERTED.message_id, INSERTED.summary, INSERTED.expires_at, INSERTED.updated_at
        WHERE message_id = @id
      `);

      if (result.recordset.length === 0) {
        return { status: 404, jsonBody: { error: "Message not found" } };
      }
      return { status: 200, jsonBody: result.recordset[0] };
    } catch (err) {
      context.error("PATCH /messages/{id} failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
