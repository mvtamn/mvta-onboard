// GET /trip-start-log/history?date=YYYYMMDD&trip_id=... - every change ever
// made to one trip's Verified cell (plans/dispatch-log-spec.md §7.1). The log
// itself shows where a cell stands now; this answers who initialled it, when,
// and what it said before.
//
// Read-only, and open to everyone who can read the Dispatch Log: the record
// of what the contractor desk did is exactly what MVTA staff reviewing the
// log need to see. Written by the verify endpoint, never here.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { requireRole, TRIP_START_LOG_READ_ROLES } from "../lib/auth";
import { isValidServiceDate } from "../lib/tripStartRotation";
import { loadTripStartVerificationHistory, verificationEventsTableReady } from "../lib/tripStartLogHistory";

export async function getTripStartVerificationHistory(request: HttpRequest, context: InvocationContext) {
  const authResult = requireRole(request, TRIP_START_LOG_READ_ROLES);
  if (!authResult.authorized) {
    return { status: authResult.status, jsonBody: { error: authResult.message } };
  }

  const serviceDate = request.query.get("date")?.trim();
  const tripId = request.query.get("trip_id")?.trim();
  if (!serviceDate || !isValidServiceDate(serviceDate)) {
    return { status: 400, jsonBody: { error: "date must be a calendar day as YYYYMMDD." } };
  }
  if (!tripId) {
    return { status: 400, jsonBody: { error: "trip_id is required." } };
  }

  try {
    const pool = await getPool();
    // A database without migration 096a has no history to show; that is an
    // empty list, not an error, exactly as the log reads before it is built.
    if (!(await verificationEventsTableReady(pool))) {
      return { status: 200, jsonBody: { service_date: serviceDate, trip_id: tripId, events: [] } };
    }
    const events = await loadTripStartVerificationHistory(pool, serviceDate, tripId);
    return { status: 200, jsonBody: { service_date: serviceDate, trip_id: tripId, events } };
  } catch (err) {
    context.error("Failed to read trip-start verification history", err);
    return { status: 500, jsonBody: { error: "Failed to read the verification history." } };
  }
}

app.http("tripStartLogHistoryGet", {
  route: "trip-start-log/history",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireRole above
  handler: getTripStartVerificationHistory,
});
