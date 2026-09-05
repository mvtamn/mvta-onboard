// GET /trip-start-log/export?date=YYYYMMDD - the Dispatch Log for one service
// date as CSV (plans/dispatch-log-spec.md §4.2, §8 step 7): parity with the
// workbook the desk is leaving behind. Same rows and same readers as the JSON
// endpoint; the two share one loader so they cannot disagree about a day.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { requireRole } from "../lib/auth";
import { agencyServiceDate } from "../lib/missedTripTime";
import { isValidServiceDate } from "../lib/tripStartRotation";
import { loadTripStartLogDay, tripStartLogTablesReady } from "../lib/tripStartLogRead";
import { tripStartLogCsvFilename, tripStartLogToCsv } from "../lib/tripStartLogCsv";
import { TRIP_START_LOG_READ_ROLES } from "./tripStartLog";

app.http("tripStartLogExport", {
  route: "trip-start-log/export",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, TRIP_START_LOG_READ_ROLES);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }
    const dateParam = request.query.get("date")?.trim();
    const serviceDate = dateParam || agencyServiceDate(new Date()).serviceDate;
    if (!isValidServiceDate(serviceDate)) {
      return { status: 400, jsonBody: { error: "date must be a calendar day as YYYYMMDD." } };
    }
    try {
      const pool = await getPool();
      if (!(await tripStartLogTablesReady(pool))) {
        // Not an empty day: nothing has been built yet, and an empty file
        // would read as one.
        return { status: 503, jsonBody: { error: "The Dispatch Log is not connected: its tables are missing. Apply migration 094." } };
      }
      const trips = await loadTripStartLogDay(pool, serviceDate);
      return {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${tripStartLogCsvFilename(serviceDate)}"`,
          "Cache-Control": "no-store",
        },
        body: tripStartLogToCsv(trips),
      };
    } catch (err) {
      context.error("Failed to export the trip-start log:", err);
      return { status: 500, jsonBody: { error: "Failed to export the trip-start log." } };
    }
  },
});
