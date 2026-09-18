// GET /missed-trips - the currently-tracked missed-trip candidates (explicit
// cancellations and schedule-based silent no-shows), backing the console's
// Missed Trips view (now under the Compliance tab). compliance-review.view can read;
// this is visibility only - all writes come from gtfsMissedTripsPoll.ts. Mirrors tripDelays.ts's shape.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { missedTripCaseSql } from "../lib/missedTripCase";
import { occurrenceSourceRefSql } from "../lib/occurrenceIntake/sources";
import { requireAccess } from "../lib/access/require";
import { missedTripFeedDependencies } from "../lib/kpiTrust";
import { loadKpiFeedHealthRecords } from "../lib/kpiTrustStore";

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
  occurrence_review_status?: string | null;
  occurrence_attribution?: string | null;
  occurrence_service_month?: string | null;
  occurrence_period_status?: string | null;
  reason_code: string | null;
  validated_by: string | null;
  validated_at: Date | null;
  notes: string | null;
  detector_version: string | null;
  data_quality_status: string;
  // Why this row is not (yet) a finding - see migration 121. Null on a decided
  // row, and on every row in an environment that has not applied it.
  undecided_reason: string | null;
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
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = await requireAccess(request, "compliance-review.view");
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
      // What is in the queue, held, concluded or legacy is the Missed-trip case
      // module's classification (lib/missedTripCase/classify.ts), CROSS APPLYed
      // as `mtc` onto every row here - the list and its totals read the same
      // columns, so a tile can never count rows its list omits.
      //
      // Legacy missed-trip records stay out of the queue: they came from the
      // superseded detector and their outcome is unknown, not false. Held cases
      // (Awaiting evidence) stay out too - waiting on a second poll, or silent
      // for a reason other than the trip. Both remain available in view=all.
      const whereClause =
        view === "queue" ? "WHERE mtc.in_queue = 1"
          : view === "history" ? "WHERE mtc.concluded = 1"
            : "";
      // Where each reviewed trip ended up in the performance assessment. The
      // join is by source_ref, the one reference lib/occurrenceIntake builds,
      // and it is guarded by OBJECT_ID so an environment without the assessment tables
      // returns the list unchanged rather than failing.
      const occurrencesReady = await pool.request().query<{ ready: number }>(`
        SELECT CASE WHEN OBJECT_ID('dbo.ComplianceOccurrences','U') IS NULL THEN 0 ELSE 1 END ready
      `);
      const occurrenceColumns = occurrencesReady.recordset[0]?.ready
        ? `,
               occ.review_status AS occurrence_review_status,
               occ.attribution AS occurrence_attribution,
               occ.service_month AS occurrence_service_month,
               period.status AS occurrence_period_status`
        : "";
      const occurrenceJoin = occurrencesReady.recordset[0]?.ready
        ? `
        LEFT JOIN ComplianceOccurrences occ
          ON occ.source_ref = ${occurrenceSourceRefSql("missed_trip", "mmt")}
        LEFT JOIN AssessmentPeriods period
          ON period.contractor_id = occ.contractor_id AND period.service_month = occ.service_month`
        : "";
      const listReq = pool.request();
      listReq.input("offset", sql.Int, offset);
      listReq.input("limit", sql.Int, limit);
      const result = await listReq.query<MissedTripRow>(`
        SELECT mmt.trip_id, mmt.service_date, mmt.route_id, mmt.scheduled_departure_at,
               mmt.grace_deadline_at, mmt.status, mmt.detection_type, mmt.detected_late_arrival_at,
               mmt.suggested_alert_id, mmt.first_seen_watching_at, mmt.last_checked_at,
               mmt.validation_status, mmt.reason_code, mmt.validated_by, mmt.validated_at, mmt.notes,
               mmt.detector_version, mmt.data_quality_status, mmt.undecided_reason,
               mtc.lifecycle, mtc.evidence_finding, mtc.review_outcome, mtc.held_reason, mtc.in_queue, mtc.concluded,
               mmt.source_system, mmt.source_record_id,
               sme.condition_late_start, sme.condition_superseded, sme.condition_late_arrival,
               sme.start_delay_seconds, sme.arrival_delay_seconds,
               td.direction_label${occurrenceColumns}
        FROM MonitoredMissedTrips mmt ${missedTripCaseSql("mmt")}
        LEFT JOIN GtfsTripDirections td ON td.trip_id = mmt.trip_id
        LEFT JOIN SpareMissedTripEvaluations sme
          ON mmt.source_system = 'spare' AND sme.request_id = mmt.source_record_id${occurrenceJoin}
        ${whereClause}
        ORDER BY
          CASE mmt.validation_status WHEN 'unreviewed' THEN 0 ELSE 1 END,
          CASE mmt.status WHEN 'escalated' THEN 0 WHEN 'watching' THEN 1 ELSE 2 END,
          mmt.scheduled_departure_at DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `);
      const missedTrips = result.recordset;
      const totals = await pool.request().query<{
        pending_confirmation_count: number;
        held_undecided_count: number;
        total_count: number;
        active_count: number;
        resolved_count: number;
        queue_count: number;
        history_count: number;
        legacy_count: number;
        data_gap_count: number;
        confirmed_count: number;
        false_positive_count: number;
        routes_affected_count: number;
        last_checked_at: Date | null;
      }>(`
        SELECT
          COUNT(*) AS total_count,
          SUM(CASE WHEN mtc.concluded = 0 THEN 1 ELSE 0 END) AS active_count,
          SUM(CASE WHEN mtc.concluded = 1 THEN 1 ELSE 0 END) AS resolved_count,
          SUM(CAST(mtc.in_queue AS INT)) AS queue_count,
          SUM(CAST(mtc.concluded AS INT)) AS history_count,
          SUM(CAST(mtc.legacy AS INT)) AS legacy_count,
          -- Trips the detector could not decide because the evidence was not
          -- there to decide them, so the console can say how much went
          -- unmeasured instead of silently under-counting.
          SUM(CASE WHEN mtc.evidence_finding = N'indeterminate' THEN 1 ELSE 0 END) AS data_gap_count,
          SUM(CASE WHEN mtc.review_outcome = N'confirmed_missed_trip' THEN 1 ELSE 0 END) AS confirmed_count,
          SUM(CASE WHEN mtc.review_outcome = N'timely_service' THEN 1 ELSE 0 END) AS false_positive_count,
          COUNT(DISTINCT CASE WHEN mtc.flagged_missed = 1 THEN mmt.route_id END) AS routes_affected_count,
          MAX(mmt.last_checked_at) AS last_checked_at,
          SUM(CASE WHEN mtc.held_reason = N'awaiting_confirmation' THEN 1 ELSE 0 END) AS pending_confirmation_count,
          SUM(CASE WHEN mtc.held = 1 AND mtc.held_reason <> N'awaiting_confirmation' THEN 1 ELSE 0 END) AS held_undecided_count
        FROM MonitoredMissedTrips mmt ${missedTripCaseSql("mmt")}
      `);
      const total = totals.recordset[0];
      // Resolved through the shared KPI trust contracts rather than a local
      // freshness rule: only the feeds missed-trip detection actually depends
      // on are reported, each against the deadline Operations approved for it
      // (or none, for a feed whose periodic deadline is still pending).
      const healthRecords = await loadKpiFeedHealthRecords(pool);
      const countsByFeed = new Map(healthRecords.map((record) => [record.feed_name, record.last_entity_count]));
      const feedHealth = missedTripFeedDependencies(healthRecords).map((dependency) => ({
        feed_name: dependency.feed_name,
        required: dependency.required,
        last_success_at: dependency.last_success_at,
        last_entity_count: countsByFeed.get(dependency.feed_name) ?? null,
        source_timestamp_at: dependency.source_timestamp_at,
        stale_after_minutes: dependency.stale_after_minutes,
        status: dependency.state,
      }));
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
            unreviewed_count: total?.queue_count ?? 0,
            confirmed_count: total?.confirmed_count ?? 0,
            false_positive_count: total?.false_positive_count ?? 0,
            routes_affected_count: total?.routes_affected_count ?? 0,
            legacy_unverified_count: total?.legacy_count ?? 0,
            unknown_data_gap_count: total?.data_gap_count ?? 0,
            // Detected, not yet a finding: waiting for a second poll to agree.
            pending_confirmation_count: total?.pending_confirmation_count ?? 0,
            // Recorded with a reason other than the trip itself - a stale
            // schedule, a schedule the feeds do not recognise, or a block whose
            // vehicle never reported.
            held_undecided_count: total?.held_undecided_count ?? 0,
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
