// GET /missed-trips-monthly-summary - the aggregate view behind Missed
// Trips' Monthly Assessments page. Buckets cases that are findings - Ready for
// review or Reviewed, per the Missed-trip case module - by the agency-local
// service_date month x route x detector x review outcome. Held, open,
// closed-by-evidence and Legacy missed-trip records are excluded.
//
// The bucket is the module's own classification (review_outcome, lifecycle,
// counts_as_missed), not the stored validation_status. The console used to
// read that raw column and decide for itself what "confirmed" and "timely
// service" meant - including carrying `false_positive`, the name the outcome
// had before migration 125 - which was the last copy of a rule the module
// already owns.
// The console pivots this
// into a per-route/month table client-side rather than the backend
// pre-shaping one specific table layout, same "return the facts, let the
// UI decide presentation" approach as otpMonthlyTrend.ts.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { requireAccess } from "../lib/access/require";
import { detectorPromotionWindows, missedTripCaseSql } from "../lib/missedTripCase";

interface MissedTripsSummaryRow {
  service_month: string;
  route_id: string;
  source_system: string;
  detection_type: string | null;
  detector: string;
  lifecycle: string;
  evidence_finding: string;
  review_outcome: string | null;
  counts_as_missed: boolean;
  counts_toward_assessment: boolean;
  trip_count: number;
}

app.http("missedTripsMonthlySummary", {
  route: "missed-trips-monthly-summary",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = await requireAccess(request, "compliance-review.view");
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }
    try {
      const pool = await getPool();
      // The report says which detectors count, so it needs the promotion history.
      const promoted = await detectorPromotionWindows(pool);
      const tableCheck = await pool.request().query<{ table_exists: number }>(`
        SELECT CASE WHEN OBJECT_ID('dbo.MonitoredMissedTrips', 'U') IS NULL THEN 0 ELSE 1 END AS table_exists
      `);
      if (tableCheck.recordset[0]?.table_exists !== 1) {
        return { status: 200, jsonBody: { summary: [] } };
      }

      const result = await pool.request().query<MissedTripsSummaryRow>(`
        SELECT
          LEFT(m.service_date, 6) AS service_month,
          m.route_id,
          m.source_system,
          m.detection_type,
          mtc.detector,
          mtc.lifecycle,
          mtc.evidence_finding,
          mtc.review_outcome,
          mtc.counts_as_missed,
          mtc.counts_toward_assessment,
          COUNT(*) AS trip_count
        FROM MonitoredMissedTrips m ${missedTripCaseSql("m", "mtc", promoted)}
        WHERE mtc.lifecycle IN (N'ready_for_review', N'reviewed')
        GROUP BY LEFT(m.service_date, 6), m.route_id, m.source_system, m.detection_type,
          mtc.detector, mtc.lifecycle, mtc.evidence_finding, mtc.review_outcome,
          mtc.counts_as_missed, mtc.counts_toward_assessment
        ORDER BY service_month DESC, route_id
      `);
      return { status: 200, jsonBody: { summary: result.recordset } };
    } catch (err) {
      context.error("GET /missed-trips-monthly-summary failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
