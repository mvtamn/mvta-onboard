// GET /admin/messages?tag=&q=&limit= - staff search across ALL messages
// (any status, including expired/retracted) for the console's Audit Log tab.
// Any staff role may read; never exposed publicly.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, STAFF_READ_ROLES } from "../lib/auth";

const MAX_LIMIT = 200;

app.http("adminMessages", {
  route: "admin/messages",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, STAFF_READ_ROLES);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }

    try {
      const tag = request.query.get("tag");
      const q = request.query.get("q");
      const limit = Math.min(parseInt(request.query.get("limit") || "100", 10) || 100, MAX_LIMIT);

      const pool = await getPool();
      const sqlRequest = pool.request();
      sqlRequest.input("limit", sql.Int, limit);

      let query = `
        SELECT TOP (@limit)
               message_id, summary, raw_text, category, severity, tags,
               routes_affected, status, created_by, created_at, expires_at, updated_at
        FROM Messages
        WHERE 1 = 1
      `;
      if (tag) {
        query += ` AND EXISTS (SELECT 1 FROM OPENJSON(tags) WHERE value = @tag)`;
        sqlRequest.input("tag", sql.NVarChar, tag);
      }
      if (q) {
        query += ` AND (summary LIKE @q OR raw_text LIKE @q)`;
        sqlRequest.input("q", sql.NVarChar, `%${q}%`);
      }
      query += ` ORDER BY created_at DESC`;

      interface Row {
        message_id: string;
        summary: string | null;
        raw_text: string;
        category: string;
        severity: string;
        tags: string | null;
        routes_affected: string | null;
        status: string;
        created_by: string;
        created_at: Date;
        expires_at: Date;
        updated_at: Date;
      }
      const result = await sqlRequest.query<Row>(query);

      const messages = result.recordset.map((row) => ({
        message_id: row.message_id,
        summary: row.summary || row.raw_text.substring(0, 200),
        category: row.category,
        severity: row.severity,
        tags: row.tags ? (JSON.parse(row.tags) as string[]) : [],
        routes_affected: row.routes_affected ? (JSON.parse(row.routes_affected) as string[]) : [],
        status: row.status,
        created_by: row.created_by,
        created_at: row.created_at,
        expires_at: row.expires_at,
        updated_at: row.updated_at,
      }));

      return { status: 200, jsonBody: { messages } };
    } catch (err) {
      context.error("GET /admin/messages failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
