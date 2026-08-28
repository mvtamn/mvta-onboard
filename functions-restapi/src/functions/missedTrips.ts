// GET /missed-trips - the currently-tracked missed-trip candidates (explicit
// cancellations and schedule-based silent no-shows), backing the console's
// Missed Trips view (now under the Compliance tab). Any staff role, plus the
// dedicated OCC.Compliance role, can read; this is visibility only - all
// writes come from gtfsMissedTripsPoll.ts. Mirrors tripDelays.ts's shape.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, STAFF_READ_ROLES } from "../lib/auth";
import { feedHealthTable } from "../lib/kpiFeedHealth";

interface MissedTripRow {
  trip_id: string;
  service_date: string;
  route_id: string;
  scheduled_departure_at: Date;
  grace_deadline_at: Date;
  status: string;
  detection_type: string | null;
  detected_late_arrival_at: Date | null;
  suggested_alert_id: string | null;
  first_seen_watching_at: Date;
  last_checked_at: Date;
  validation_status: string;
  reason_code: string | null;
  validated_by: string | null;
  validated_at: Date | null;
  notes: string | null;
  detector_version: string | null;
  data_quality_status: string;
  source_system: string;
  source_record_id: string | null;
  condition_late_start: boolean | null;
  condition_superseded: boolean | null;
  condition_late_arrival: boolean | null;
  start_delay_seconds: number | null;
  arrival_delay_seconds: number | null;
  // NB/SB/EB/WB from the static schedule (GtfsTripDirections, migration-007) -
  // same join tripDelays.ts already does for Live Delays. Null whenever the
  // trip isn't in that reference table yet, or the static feed couldn't
  // determine a direction for it.
  direction_label: string | null;
}

app.http("missedTripsList", {
  route: "missed-trips",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, [...STAFF_READ_ROLES, "OCC.Compliance"]);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }
    try {
      const pool = await getPool();

      const tableCheck = await pool.request().query<{ table_exists: number }>(`
        SELECT CASE WHEN OBJECT_ID('dbo.MonitoredMissedTrips', 'U') IS NULL
          THEN 0 ELSE 1 END AS table_exists
      `);
      if (tableCheck.recordset[0]?.table_exists !== 1) {
        return {
          status: 200,
          jsonBody: {
            missed_trips: [],
            diagnostics: { configured: false },
          },
        };
      }

      const requestedView = request.query.get("view");
      const view = requestedView === "history" || requestedView === "all" ? requestedView : "queue";
      const requestedLimit = Number(request.query.get("limit") ?? "200");
      const limit = Number.isInteger(requestedLimit) ? Math.min(2000, Math.max(1, requestedLimit)) : 200;
      const requestedOffset = Number(request.query.get("offset") ?? "0");
      const offset = Number.isInteger(requestedOffset) ? Math.max(0, requestedOffset) : 0;
      const whereClause =
        view === "queue"
          ? "WHERE mmt.validation_status = 'unreviewed' AND mmt.status <> 'resolved'"
          : view === "history"
            ? "WHERE mmt.validation_status <> 'unreviewed' OR mmt.status = 'resolved'"
            : "";
      const listReq = pool.request();
      listReq.input("offset", sql.Int, offset);
      listReq.input("limit", sql.Int, limit);
      const result = await listReq.query<MissedTripRow>(`
        SELECT mmt.trip_id, mmt.service_date, mmt.route_id, mmt.scheduled_departure_at,
               mmt.grace_deadline_at, mmt.status, mmt.detection_type, mmt.detected_late_arrival_at,
               mmt.suggested_alert_id, mmt.first_seen_watching_at, mmt.last_checked_at,
               mmt.validation_status, mmt.reason_code, mmt.validated_by, mmt.validated_at, mmt.notes,
               mmt.detector_version, mmt.data_quality_status,
               mmt.source_system, mmt.source_record_id,
               sme.condition_late_start, sme.condition_superseded, sme.condition_late_arrival,
               sme.start_delay_seconds, sme.arrival_delay_seconds,
               td.direction_label
        FROM MonitoredMissedTrips mmt
        LEFT JOIN GtfsTripDirections td ON td.trip_id = mmt.trip_id
        LEFT JOIN SpareMissedTripEvaluations sme
          ON mmt.source_system = 'spare' AND sme.request_id = mmt.source_record_id
        ${whereClause}
        ORDER BY
          CASE mmt.validation_status WHEN 'unreviewed' THEN 0 ELSE 1 END,
          CASE mmt.status WHEN 'escalated' THEN 0 WHEN 'watching' THEN 1 ELSE 2 END,
          mmt.scheduled_departure_at DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `);
      const missedTrips = result.recordset;
      const totals = await pool.request().query<{
        total_count: number;
        active_count: number;
        resolved_count: number;
        unreviewed_count: number;
        queue_count: number;
        history_count: number;
        legacy_count: number;
        last_checked_at: Date | null;
      }>(`
        SELECT
          COUNT(*) AS total_count,
          SUM(CASE WHEN status <> 'resolved' THEN 1 ELSE 0 END) AS active_count,
          SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved_count,
          SUM(CASE WHEN validation_status = 'unreviewed' AND status <> 'resolved' THEN 1 ELSE 0 END) AS unreviewed_count,
          SUM(CASE WHEN validation_status = 'unreviewed' AND status <> 'resolved' THEN 1 ELSE 0 END) AS queue_count,
          SUM(CASE WHEN validation_status <> 'unreviewed' OR status = 'resolved' THEN 1 ELSE 0 END) AS history_count,
          SUM(CASE WHEN data_quality_status = 'legacy_unverified' THEN 1 ELSE 0 END) AS legacy_count,
          MAX(last_checked_at) AS last_checked_at
        FROM MonitoredMissedTrips
      `);
      const total = totals.recordset[0];
      const healthTable = await feedHealthTable(pool);
      let feedHealth: Array<{
        feed_name: string;
        last_success_at: string | null;
        last_entity_count: number | null;
        source_timestamp_at: string | null;
        status: "current" | "stale";
      }> = [];
      if (healthTable) {
        const health = await pool.request().query<{
          feed_name: string;
          last_success_at: Date | null;
          last_entity_count: number | null;
          source_timestamp_at: Date | null;
        }>(`
          SELECT feed_name, last_success_at, last_entity_count, source_timestamp_at
          FROM ${healthTable} ORDER BY feed_name
        `);
        feedHealth = health.recordset.map((row) => ({
          feed_name: row.feed_name,
          last_success_at: row.last_success_at?.toISOString() ?? null,
          last_entity_count: row.last_entity_count,
          source_timestamp_at: row.source_timestamp_at?.toISOString() ?? null,
          status: row.last_success_at && row.last_success_at.getTime() >=
            Date.now() - (row.feed_name.startsWith("spare_") ? 35 : 15) * 60 * 1000
            ? "current" : "stale",
        }));
      }
      const configured = Boolean(
        process.env.GTFS_RT_TRIPUPDATE_URL?.trim() && process.env.GTFS_STATIC_URL?.trim(),
      );
      const silentNoShowEnabled = process.env.GTFS_SILENT_NO_SHOW_ENABLED?.trim().toLowerCase() === "true";
      const spareEnabled = process.env.SPARE_MISSED_TRIPS_ENABLED?.trim().toLowerCase() === "true";
      return {
        status: 200,
        jsonBody: {
          missed_trips: missedTrips,
          diagnostics: {
            configured,
            view,
            limit,
            offset,
            returned_count: missedTrips.length,
            view_count: view === "queue" ? total?.queue_count ?? 0 : view === "history" ? total?.history_count ?? 0 : total?.total_count ?? 0,
            total_count: total?.total_count ?? 0,
            active_count: total?.active_count ?? 0,
            resolved_count: total?.resolved_count ?? 0,
            unreviewed_count: total?.unreviewed_count ?? 0,
            legacy_unverified_count: total?.legacy_count ?? 0,
            last_checked_at: total?.last_checked_at?.toISOString() ?? null,
            silent_no_show_enabled: silentNoShowEnabled,
            schedule_detection_status: silentNoShowEnabled ? "experimental" : "paused",
            spare_enabled: spareEnabled,
            spare_service_scope_configured: Boolean(process.env.SPARE_MISSED_TRIP_SERVICE_IDS?.trim()),
            feed_health: feedHealth,
          },
        },
      };
    } catch (err) {
      context.error("GET /missed-trips failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
