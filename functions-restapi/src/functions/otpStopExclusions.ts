// Persisted Review Queue decisions - a Flagged Stop has no row here until
// staff actually approve or reject it; a stop awaiting review is decided live
// by lib/otpFlaggedStops (ADR 0034) and never written here. lib/otpMonth's
// rules.ts treats an 'approved' row as excluded from Official Departure OTP.
// Re-reviewing the same stop/day upserts in place, which is why an already
// excluded stop stays in the queue.
//
//   GET /otp-stop-exclusions?month=  - compliance-review.view
//   PUT /otp-stop-exclusions          - compliance-review.review
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { requireAccess } from "../lib/access/require";
import { validateStopExclusion } from "../lib/validation";
import { serviceMonthOf } from "../lib/otpMonthlyFeed";
import { recordStopExclusion, stopExclusionsForMonth, type StopExclusionDecision } from "../lib/otpExclusionReview";

function resolveMonth(request: HttpRequest): string {
  const param = request.query.get("month");
  return param && /^\d{6}$/.test(param) ? param : serviceMonthOf(new Date());
}

app.http("otpStopExclusionsList", {
  route: "otp-stop-exclusions",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = await requireAccess(request, "compliance-review.view");
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }
    try {
      const pool = await getPool();
      const exclusions = await stopExclusionsForMonth(pool, resolveMonth(request));
      return { status: 200, jsonBody: { exclusions } };
    } catch (err) {
      context.error("GET /otp-stop-exclusions failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("otpStopExclusionsUpsert", {
  route: "otp-stop-exclusions",
  methods: ["PUT"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = await requireAccess(request, "compliance-review.review");
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
    }
    const errors = validateStopExclusion(raw as Record<string, unknown>);
    if (errors.length > 0) {
      return { status: 400, jsonBody: { error: "Validation failed", details: errors } };
    }

    try {
      const pool = await getPool();
      const record = await recordStopExclusion(
        pool,
        raw as StopExclusionDecision,
        authResult.principal.userDetails || "system",
      );
      return { status: 200, jsonBody: record };
    } catch (err) {
      context.error("PUT /otp-stop-exclusions failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
