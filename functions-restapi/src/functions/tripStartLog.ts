// GET /trip-start-log?date=YYYYMMDD - the Dispatch Log for one service date
// (plans/dispatch-log-spec.md §4.2). One row per revenue trip, joined to the
// human verification if one exists. in_rotation is a field on the row, not a
// query parameter: the console's three views filter, sort and group the same
// rows client-side, so there is one endpoint and the views cannot disagree.
//
// Read-only. Rows are written by tripStartLogMaterialize; the same staff
// roles that read Fixed Route Departures read this.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { requireRole, STAFF_READ_ROLES } from "../lib/auth";
import { agencyServiceDate } from "../lib/missedTripTime";
import { isValidServiceDate, rotationWeekOffset } from "../lib/tripStartRotation";
import { loadTripStartLogDay, tripStartLogTablesReady } from "../lib/tripStartLogRead";
import { readRotationAnchor } from "./tripStartLogMaterialize";

// Row shaping and the day query live in lib/tripStartLogRead.ts, shared with
// the CSV export; re-exported so existing imports keep working.
export { shapeTrip, type TripStartLogTrip } from "../lib/tripStartLogRead";

export const TRIP_START_LOG_READ_ROLES = [...STAFF_READ_ROLES, "OCC.Compliance"];

app.http("tripStartLogGet", {
  route: "trip-start-log",
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
        return {
          status: 200,
          jsonBody: {
            service_date: serviceDate,
            trips: [],
            diagnostics: { table_ready: false, materialized: false, trip_count: 0, rotation_count: 0, rotation_anchor_date: null, week_offset: null },
          },
        };
      }

      const trips = await loadTripStartLogDay(pool, serviceDate);
      const anchor = await readRotationAnchor(pool);
      return {
        status: 200,
        jsonBody: {
          service_date: serviceDate,
          trips,
          diagnostics: {
            table_ready: true,
            materialized: trips.length > 0,
            trip_count: trips.length,
            rotation_count: trips.filter((t) => t.in_rotation).length,
            rotation_anchor_date: anchor,
            week_offset: anchor ? rotationWeekOffset(anchor, serviceDate) : null,
          },
        },
      };
    } catch (err) {
      context.error("Failed to read the trip-start log:", err);
      return { status: 500, jsonBody: { error: "Failed to read the trip-start log." } };
    }
  },
});
