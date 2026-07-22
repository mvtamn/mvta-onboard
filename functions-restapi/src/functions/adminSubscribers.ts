// GET /admin/subscribers/summary - subscriber counts for the console sidebar
// and Subscribers tab. Any staff role gets the counts; ONLY Admins also get
// the recent-signups list, and even that is PII-masked (last-4 phone, masked
// email) - full contact details never leave the API.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { requireRole, STAFF_READ_ROLES, ADMIN_ROLES, getCallerPrincipal } from "../lib/auth";

function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  return `•••-${phone.slice(-4)}`;
}

function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at <= 0) return "•••";
  return `${email[0]}•••${email.slice(at)}`;
}

app.http("adminSubscribersSummary", {
  route: "admin/subscribers/summary",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, STAFF_READ_ROLES);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }

    try {
      const pool = await getPool();

      const counts = await pool.request().query<{
        total: number;
        sms_confirmed: number;
        email_confirmed: number;
        pending: number;
        opted_out: number;
      }>(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN phone_number IS NOT NULL AND status = 'confirmed' THEN 1 ELSE 0 END) AS sms_confirmed,
          SUM(CASE WHEN email IS NOT NULL AND email_status = 'confirmed' THEN 1 ELSE 0 END) AS email_confirmed,
          SUM(CASE WHEN status = 'pending_confirmation' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN status = 'opted_out' THEN 1 ELSE 0 END) AS opted_out
        FROM Subscribers
      `);

      const summary = counts.recordset[0];
      const jsonBody: Record<string, unknown> = { summary };

      // Recent list is Admin-only and PII-masked.
      const principal = getCallerPrincipal(request);
      const isAdmin = principal?.roles.some((r) => ADMIN_ROLES.includes(r)) ?? false;
      if (isAdmin) {
        const recent = await pool.request().query<{
          subscriber_id: string;
          phone_number: string | null;
          email: string | null;
          status: string;
          email_status: string | null;
          opted_in_at: Date | null;
        }>(`
          SELECT TOP 25 subscriber_id, phone_number, email, status, email_status, opted_in_at
          FROM Subscribers
          ORDER BY COALESCE(opted_in_at, '2000-01-01') DESC
        `);
        jsonBody.recent = recent.recordset.map((row) => ({
          subscriber_id: row.subscriber_id,
          phone_masked: maskPhone(row.phone_number),
          email_masked: maskEmail(row.email),
          status: row.status,
          email_status: row.email_status,
          opted_in_at: row.opted_in_at,
        }));
      }

      return { status: 200, jsonBody };
    } catch (err) {
      context.error("GET /admin/subscribers/summary failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
