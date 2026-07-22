// POST /messages/{id}/retract - pull a message from circulation
// (architecture doc Section 9). Publisher/Admin only.
//
// Sets status='retracted'; the public read path (messages/active) filters on
// status='active' so the message disappears from every consumer immediately.
// Pushing a correction/retraction notice out through SMS/email for messages
// already dispatched is future work (Phase 2+) - note it, don't fake it.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, PUBLISH_ROLES } from "../lib/auth";
import { isGuid } from "../lib/validation";

app.http("messagesRetract", {
  route: "messages/{id}/retract",
  methods: ["POST"],
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

    try {
      const pool = await getPool();
      const sqlRequest = pool.request();
      sqlRequest.input("id", sql.UniqueIdentifier, id);

      const result = await sqlRequest.query<{ message_id: string; status: string }>(`
        UPDATE Messages
        SET status = 'retracted', updated_at = SYSUTCDATETIME()
        OUTPUT INSERTED.message_id, INSERTED.status
        WHERE message_id = @id AND status = 'active'
      `);

      if (result.recordset.length === 0) {
        return { status: 404, jsonBody: { error: "Active message not found" } };
      }
      return { status: 200, jsonBody: result.recordset[0] };
    } catch (err) {
      context.error("POST /messages/{id}/retract failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
