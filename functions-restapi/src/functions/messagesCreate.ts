// POST /messages - architecture doc Section 9
// Called by the Power Automate ingestion flow after Claude has already
// parsed the staff's free text into structured fields - this endpoint
// validates and persists, it does not call Claude itself.
// Restricted to OCC Publisher, OCC Admin, or System Ingestion roles.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole } from "../lib/auth";
import { validateCreateMessage } from "../lib/validation";
import { publishMessageCreated } from "../lib/events";
import type { CreateMessageBody } from "../lib/types";

interface InsertedRow {
  message_id: string;
  created_at: Date;
  expires_at: Date;
}

app.http("messagesCreate", {
  route: "messages",
  methods: ["POST"],
  authLevel: "anonymous", // authorization is enforced in code below via requireRole
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, ["OCC.Publisher", "OCC.Admin", "System.Ingestion"]);
    if (!authResult.authorized) {
      return {
        status: authResult.status,
        jsonBody: { error: authResult.message },
      };
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
    }

    const validationErrors = validateCreateMessage(raw as Record<string, unknown>);
    if (validationErrors.length > 0) {
      return { status: 400, jsonBody: { error: "Validation failed", details: validationErrors } };
    }
    // Shape proven by validateCreateMessage above.
    const body = raw as CreateMessageBody;

    try {
      const pool = await getPool();
      const sqlRequest = pool.request();

      sqlRequest.input("raw_text", sql.NVarChar, body.raw_text);
      sqlRequest.input("summary", sql.NVarChar, body.summary || body.raw_text.substring(0, 200));
      sqlRequest.input("category", sql.NVarChar, body.category);
      sqlRequest.input("severity", sql.NVarChar, body.severity);
      sqlRequest.input("routes_affected", sql.NVarChar, body.routes_affected ? JSON.stringify(body.routes_affected) : null);
      sqlRequest.input("stops_affected", sql.NVarChar, body.stops_affected ? JSON.stringify(body.stops_affected) : null);
      sqlRequest.input("zones_affected", sql.NVarChar, body.zones_affected ? JSON.stringify(body.zones_affected) : null);
      sqlRequest.input("tags", sql.NVarChar, body.tags ? JSON.stringify(body.tags) : null);
      sqlRequest.input("channels", sql.NVarChar, body.channels ? JSON.stringify(body.channels) : null);
      sqlRequest.input("created_by", sql.NVarChar, body.created_by);
      sqlRequest.input("expires_at", sql.DateTime2, new Date(body.expires_at));
      sqlRequest.input("expiration_source", sql.NVarChar, body.expiration_source);

      const result = await sqlRequest.query<InsertedRow>(`
        INSERT INTO Messages (
          raw_text, summary, category, severity,
          routes_affected, stops_affected, zones_affected, tags, channels,
          created_by, expires_at, expiration_source
        )
        OUTPUT INSERTED.message_id, INSERTED.created_at, INSERTED.expires_at
        VALUES (
          @raw_text, @summary, @category, @severity,
          @routes_affected, @stops_affected, @zones_affected, @tags, @channels,
          @created_by, @expires_at, @expiration_source
        )
      `);

      const inserted = result.recordset[0];

      // Publish a message-created event so the dispatch Function App fans out
      // SMS/email to matching subscribers. Best-effort: a publish failure is
      // logged inside publishMessageCreated and does not fail this request.
      await publishMessageCreated(
        {
          message_id: inserted.message_id,
          category: body.category,
          severity: body.severity,
          summary: body.summary || body.raw_text.substring(0, 200),
          routes_affected: body.routes_affected || null,
          zones_affected: body.zones_affected || null,
          channels: body.channels || null,
          created_at: inserted.created_at,
          expires_at: inserted.expires_at,
        },
        context,
      );

      return {
        status: 201,
        jsonBody: {
          message_id: inserted.message_id,
          created_at: inserted.created_at,
          expires_at: inserted.expires_at,
        },
      };
    } catch (err) {
      context.error("POST /messages failed:", err);
      return {
        status: 500,
        jsonBody: { error: "Internal server error" },
      };
    }
  },
});
