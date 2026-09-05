// GET /trip-start-log?date=YYYYMMDD - the Dispatch Log for one service date
// (plans/dispatch-log-spec.md §4.2). One row per revenue trip, joined to the
// human verification if one exists. in_rotation is a field on the row, not a
// query parameter: the console's three views filter, sort and group the same
// rows client-side, so there is one endpoint and the views cannot disagree.
//
// Read-only. Rows are written by tripStartLogMaterialize; the same staff
// roles that read Fixed Route Departures read this.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, STAFF_READ_ROLES } from "../lib/auth";
import { agencyServiceDate } from "../lib/missedTripTime";
import { isValidServiceDate, rotationWeekOffset } from "../lib/tripStartRotation";
import { readRotationAnchor } from "./tripStartLogMaterialize";

export const TRIP_START_LOG_READ_ROLES = [...STAFF_READ_ROLES, "OCC.Compliance"];

interface TripStartLogRow {
  service_date: string;
  trip_id: string;
  block_id: string | null;
  route_id: string;
  route_short_name: string | null;
  direction_id: number | null;
  direction_label: string | null;
  origin_stop_id: string | null;
  origin_stop_name: string | null;
  scheduled_start_seconds: number;
  scheduled_start_at: Date;
  in_rotation: boolean;
  rotation_day: string | null;
  actual_start_at: Date | null;
  actual_start_source: string | null;
  start_delay_seconds: number | null;
  start_status: string | null;
  materialized_at: Date;
  updated_at: Date;
  observation: string | null;
  verified_by: string | null;
  verified_initials: string | null;
  verified_at: Date | null;
  note: string | null;
}

export interface TripStartLogTrip {
  service_date: string;
  trip_id: string;
  block_id: string | null;
  route_id: string;
  route_short_name: string | null;
  direction_id: number | null;
  direction_label: string | null;
  origin_stop_id: string | null;
  origin_stop_name: string | null;
  scheduled_start_seconds: number;
  scheduled_start_at: string;
  in_rotation: boolean;
  rotation_day: string | null;
  actual_start_at: string | null;
  actual_start_source: string | null;
  start_delay_seconds: number | null;
  start_status: string | null;
  verification: {
    observation: string;
    verified_by: string;
    verified_initials: string;
    verified_at: string;
    note: string | null;
  } | null;
}

export function shapeTrip(row: TripStartLogRow): TripStartLogTrip {
  return {
    service_date: row.service_date,
    trip_id: row.trip_id,
    block_id: row.block_id,
    route_id: row.route_id,
    route_short_name: row.route_short_name,
    direction_id: row.direction_id,
    direction_label: row.direction_label,
    origin_stop_id: row.origin_stop_id,
    origin_stop_name: row.origin_stop_name,
    scheduled_start_seconds: row.scheduled_start_seconds,
    scheduled_start_at: row.scheduled_start_at.toISOString(),
    in_rotation: Boolean(row.in_rotation),
    rotation_day: row.rotation_day,
    actual_start_at: row.actual_start_at?.toISOString() ?? null,
    actual_start_source: row.actual_start_source,
    // A trip with no realtime evidence is unknown, never on time (spec §6).
    start_delay_seconds: row.start_delay_seconds,
    start_status: row.start_status ?? "unknown",
    verification:
      row.observation && row.verified_by && row.verified_initials && row.verified_at
        ? {
            observation: row.observation,
            verified_by: row.verified_by,
            verified_initials: row.verified_initials,
            verified_at: row.verified_at.toISOString(),
            note: row.note,
          }
        : null,
  };
}

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
      const tableCheck = await pool.request().query<{ ok: number }>(`
        SELECT CASE WHEN OBJECT_ID('dbo.TripStartLog', 'U') IS NOT NULL
                     AND OBJECT_ID('dbo.TripStartVerifications', 'U') IS NOT NULL
          THEN 1 ELSE 0 END AS ok
      `);
      if (tableCheck.recordset[0]?.ok !== 1) {
        return {
          status: 200,
          jsonBody: {
            service_date: serviceDate,
            trips: [],
            diagnostics: { table_ready: false, materialized: false, trip_count: 0, rotation_count: 0, rotation_anchor_date: null, week_offset: null },
          },
        };
      }

      const req = pool.request();
      req.input("service_date", sql.Char(8), serviceDate);
      const result = await req.query<TripStartLogRow>(`
        SELECT l.service_date, l.trip_id, l.block_id, l.route_id, l.route_short_name,
               l.direction_id, l.direction_label, l.origin_stop_id, l.origin_stop_name,
               l.scheduled_start_seconds, l.scheduled_start_at, l.in_rotation, l.rotation_day,
               l.actual_start_at, l.actual_start_source, l.start_delay_seconds, l.start_status,
               l.materialized_at, l.updated_at,
               v.observation, v.verified_by, v.verified_initials, v.verified_at, v.note
        FROM TripStartLog l
        LEFT JOIN TripStartVerifications v
          ON v.service_date = l.service_date AND v.trip_id = l.trip_id
        WHERE l.service_date = @service_date
        ORDER BY l.scheduled_start_seconds, l.trip_id
      `);
      const trips = result.recordset.map(shapeTrip);
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
