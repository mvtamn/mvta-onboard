// GET /otp-audit-stream - the exclusion review timeline: Stop Exclusions and
// Weather Day Exclusions merged into one list, newest first. Built by querying
// the records themselves rather than a separate log table, the same way the
// console's top-level Audit Log (adminMessages.ts) is. compliance-review.view.
//
// Entries cross the wire as data, not as sentences. This handler used to build
// the English here, which is why the stream showed a raw reason code where the
// Review Queue showed its label; the console words them now.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { requireAccess } from "../lib/access/require";
import { timeline } from "../lib/otpExclusionReview";

app.http("otpAuditStreamList", {
  route: "otp-audit-stream",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = await requireAccess(request, "compliance-review.view");
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }

    const monthParam = request.query.get("month");
    const month = monthParam && /^\d{6}$/.test(monthParam) ? monthParam : null;
    const limitParam = Number(request.query.get("limit"));

    try {
      const pool = await getPool();
      const entries = await timeline(pool, { month, limit: limitParam });
      return { status: 200, jsonBody: { entries } };
    } catch (err) {
      context.error("GET /otp-audit-stream failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
