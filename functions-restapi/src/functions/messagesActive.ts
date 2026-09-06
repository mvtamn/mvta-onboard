// GET /messages/active - architecture doc Section 9
// Public, unauthenticated - every consumer channel reads from this same
// endpoint. Optional filters: ?channel=, ?route=, ?zone=
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { parseStringList } from "../lib/stringList";

interface MessageRow {
  message_id: string;
  summary: string | null;
  raw_text: string;
  category: string;
  severity: string;
  routes_affected: string | null;
  stops_affected: string | null;
  zones_affected: string | null;
  channels: string | null;
  expires_at: Date;
  created_at: Date;
}

app.http("messagesActive", {
  route: "messages/active",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    try {
      const channel = request.query.get("channel");
      const route = request.query.get("route");
      const zone = request.query.get("zone");

      const pool = await getPool();
      const sqlRequest = pool.request();

      let query = `
        SELECT message_id, summary, raw_text, category, severity,
               routes_affected, stops_affected, zones_affected, channels,
               expires_at, created_at
        FROM Messages
        WHERE status = 'active' AND expires_at > SYSUTCDATETIME()
      `;

      if (channel) {
        query += ` AND (channels IS NULL OR EXISTS (SELECT 1 FROM OPENJSON(channels) WHERE value = @channel))`;
        sqlRequest.input("channel", sql.NVarChar, channel);
      }
      if (route) {
        query += ` AND EXISTS (SELECT 1 FROM OPENJSON(routes_affected) WHERE value = @route)`;
        sqlRequest.input("route", sql.NVarChar, route);
      }
      if (zone) {
        query += ` AND EXISTS (SELECT 1 FROM OPENJSON(zones_affected) WHERE value = @zone)`;
        sqlRequest.input("zone", sql.NVarChar, zone);
      }

      query += ` ORDER BY created_at DESC`;

      const result = await sqlRequest.query<MessageRow>(query);

      // created_at is included here (was previously dropped from the
      // response despite being selected above) - the frontend needs it
      // to show "posted X minutes ago".
      const messages = result.recordset.map((row) => ({
        message_id: row.message_id,
        summary: row.summary || row.raw_text.substring(0, 200),
        category: row.category,
        severity: row.severity,
        routes_affected: parseStringList(row.routes_affected),
        stops_affected: parseStringList(row.stops_affected),
        zones_affected: parseStringList(row.zones_affected),
        channels: parseStringList(row.channels),
        expires_at: row.expires_at,
        created_at: row.created_at,
      }));

      return {
        status: 200,
        jsonBody: { messages },
      };
    } catch (err) {
      context.error("GET /messages/active failed:", err);
      return {
        status: 500,
        jsonBody: { error: "Internal server error" },
      };
    }
  },
});
