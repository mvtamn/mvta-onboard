// GET /missed-trip-dead-zones - the bar that marks a first stop as a likely
// GPS dead zone, and every first stop's record against it, for the
// Missed-trip Detectors admin page. The page changes the bar through
// PATCH /app-settings?module=missed_trip; this read is how the person setting
// it sees which stops it flags before saving. lib/missedTripCase/deadZone.ts
// holds the rule.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { requireAccess } from "../lib/access/require";
import { DEAD_ZONE_LIMITS, readDeadZoneBar, readFirstStopRecords } from "../lib/missedTripCase/deadZone";

app.http("missedTripDeadZones", {
  route: "missed-trip-dead-zones",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = await requireAccess(request, "service-configuration.edit");
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }
    try {
      const pool = await getPool();
      const [{ configured, ...bar }, stops] = await Promise.all([readDeadZoneBar(pool), readFirstStopRecords(pool)]);
      return { status: 200, jsonBody: { bar, configured, limits: DEAD_ZONE_LIMITS, stops } };
    } catch (err) {
      context.error("GET /missed-trip-dead-zones failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
