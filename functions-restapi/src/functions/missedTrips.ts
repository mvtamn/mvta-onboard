// GET /missed-trips - the currently-tracked missed-trip candidates (explicit
// cancellations and schedule-based silent no-shows), backing the console's
// Missed Trips view (now under the Compliance tab). compliance-review.view can read;
// this is visibility only - all writes come from gtfsMissedTripsPoll.ts. Mirrors tripDelays.ts's shape.
//
// What a case is, which view it belongs to and what the totals count is the
// Missed-trip case module's business (lib/missedTripCase/reads.ts). This
// handler reads the query, asks the module, and shapes the wire response -
// including the feed health and detection settings the console shows beside
// the list, which are kpiTrust's and the module's answers respectively.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { caseQuery, missedTripDetectionSettings, readMissedTripCases, viewCount } from "../lib/missedTripCase";
import { requireAccess } from "../lib/access/require";
import { missedTripFeedDependencies } from "../lib/kpiTrust";
import { loadKpiFeedHealthRecords } from "../lib/kpiTrustStore";

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
      const query = caseQuery({
        view: request.query.get("view"),
        limit: request.query.get("limit"),
        offset: request.query.get("offset"),
      });
      const read = await readMissedTripCases(pool, query);
      if (!read.ready) {
        return { status: 200, jsonBody: { missed_trips: [], diagnostics: { configured: false } } };
      }
      const { cases, totals } = read;

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
      // What the console reports as running is what the module says is
      // running - not this handler's own reading of the same variables.
      const settings = missedTripDetectionSettings();
      return {
        status: 200,
        jsonBody: {
          missed_trips: cases,
          diagnostics: {
            configured,
            view: query.view,
            limit: query.limit,
            offset: query.offset,
            returned_count: cases.length,
            view_count: viewCount(query.view, totals),
            total_count: totals?.total_count ?? 0,
            active_count: totals?.active_count ?? 0,
            resolved_count: totals?.resolved_count ?? 0,
            unreviewed_count: totals?.queue_count ?? 0,
            confirmed_count: totals?.confirmed_count ?? 0,
            false_positive_count: totals?.false_positive_count ?? 0,
            routes_affected_count: totals?.routes_affected_count ?? 0,
            legacy_unverified_count: totals?.legacy_count ?? 0,
            unknown_data_gap_count: totals?.data_gap_count ?? 0,
            // Detected, not yet a finding: waiting for a second poll to agree.
            pending_confirmation_count: totals?.pending_confirmation_count ?? 0,
            // Recorded with a reason other than the trip itself - a stale
            // schedule, a schedule the feeds do not recognise, or a block whose
            // vehicle never reported.
            held_undecided_count: totals?.held_undecided_count ?? 0,
            last_checked_at: totals?.last_checked_at?.toISOString() ?? null,
            silent_no_show_enabled: settings.silentNoShowEnabled,
            schedule_detection_status: settings.silentNoShowEnabled ? "experimental" : "paused",
            spare_enabled: settings.spareEnabled,
            spare_service_scope_configured: settings.spareServiceIds.size > 0,
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
