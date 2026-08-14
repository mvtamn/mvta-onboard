// POST /messages/{id}/publish - human review boundary for ingestion drafts.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { PUBLISH_ROLES, requireRole } from "../lib/auth";
import { publishMessageCreated } from "../lib/events";
import { isGuid } from "../lib/validation";
import type { CreateMessageBody } from "../lib/types";

app.http("messagesPublish", {
  route: "messages/{id}/publish",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, PUBLISH_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const id = request.params.id;
    if (!isGuid(id)) return { status: 400, jsonBody: { error: "id must be a GUID" } };
    try {
      const dbRequest = (await getPool()).request();
      dbRequest.input("id", sql.UniqueIdentifier, id);
      const result = await dbRequest.query<{
        message_id: string; category: CreateMessageBody["category"]; severity: CreateMessageBody["severity"]; summary: string | null; raw_text: string;
        routes_affected: string | null; zones_affected: string | null; channels: string | null;
        created_at: Date; expires_at: Date;
      }>(`
        UPDATE Messages SET status = 'active', updated_at = SYSUTCDATETIME()
        OUTPUT INSERTED.message_id, INSERTED.category, INSERTED.severity, INSERTED.summary,
               INSERTED.raw_text, INSERTED.routes_affected, INSERTED.zones_affected,
               INSERTED.channels, INSERTED.created_at, INSERTED.expires_at
        WHERE message_id = @id AND status = 'draft'
      `);
      const message = result.recordset[0];
      if (!message) return { status: 404, jsonBody: { error: "Reviewable draft not found" } };
      await publishMessageCreated({
        message_id: message.message_id,
        category: message.category,
        severity: message.severity,
        summary: message.summary || message.raw_text.substring(0, 200),
        routes_affected: message.routes_affected ? JSON.parse(message.routes_affected) as string[] : null,
        zones_affected: message.zones_affected ? JSON.parse(message.zones_affected) as string[] : null,
        channels: message.channels ? JSON.parse(message.channels) as string[] : null,
        created_at: message.created_at,
        expires_at: message.expires_at,
      }, context);
      return { status: 200, jsonBody: { message_id: message.message_id, status: "active" } };
    } catch (error) {
      context.error("POST /messages/{id}/publish failed:", error);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
