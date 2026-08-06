// Timer-triggered ingestion of Avail's OTP Monthly By Route/Stop/Day of Week
// feed (OtpByRouteStopDayAgg) - recommended primary OTP feed per
// OTP-Feed-Evaluation-and-Recommendation.md. The feed auto-aggregates to the
// whole month containing whatever date is passed - no date-range math
// required, no risk of pulling a partial month.
//
// CHANGED 2026-08-05 per OTP-Feed-Evaluation-and-Recommendation (3).md's
// live-data investigation findings (see otp-compliance-live-data-rethink.md):
// this used to poll HOURLY but only ever ask about the CURRENT month, which
// has two problems it can't recover from on its own - (1) hourly polling of
// a month-level aggregate can't see any change hour-to-hour, since the
// number literally cannot move that fast; (2) a poller that only ever asks
// about "whatever month is current right now" has no mechanism to notice a
// month that was empty when first checked but populated by Avail days
// later (confirmed live: both August and a fully-closed July returned
// genuinely empty, valid responses). Now runs DAILY and re-fetches a
// trailing window (current month + prior 2) every time, so a delayed
// Avail-side aggregation self-heals within a day instead of requiring a
// human to notice and manually re-trigger.
import { app, type InvocationContext, type Timer } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { fetchOtpMonthlyReports, mapOtpMonthlyReport, serviceMonthOf, subtractMonths } from "../lib/otpMonthlyFeed";

const TRAILING_MONTHS = 3; // current + prior 2

app.timer("otpMonthlyFeedPoll", {
  schedule: "0 0 3 * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    const baseUrl = process.env.AVAIL_OTP_MONTHLY_URL;
    const apiKey = process.env.AVAIL_AVL_REPORTS_API_KEY;
    if (!baseUrl || !apiKey) {
      context.warn("AVAIL_OTP_MONTHLY_URL/AVAIL_AVL_REPORTS_API_KEY are not configured - skipping this run.");
      return;
    }

    const now = new Date();
    const pool = await getPool();

    for (let i = 0; i < TRAILING_MONTHS; i++) {
      const targetDate = subtractMonths(now, i);
      const serviceMonth = serviceMonthOf(targetDate);

      let reports;
      try {
        reports = await fetchOtpMonthlyReports(baseUrl, apiKey, targetDate);
      } catch (err) {
        context.error(`Failed to fetch Avail OTP Monthly reports for ${serviceMonth}:`, err);
        continue;
      }

      let upsertedCount = 0;
      for (const report of reports) {
        let mapped;
        try {
          mapped = mapOtpMonthlyReport(report, serviceMonth);
        } catch (err) {
          context.error(`Failed to map Avail OTP Monthly report for route ${report.RouteID}/stop ${report.StopID}:`, err);
          continue;
        }
        if (!mapped) continue;

        try {
          const request = pool.request();
          request.input("service_month", sql.Char(6), mapped.service_month);
          request.input("route_id", sql.Int, mapped.route_id);
          request.input("stop_id", sql.Int, mapped.stop_id);
          // NVarChar(20), not (3) - migration-021: some real Avail values
          // overflowed the original "Mon"/"Tue"-sized column.
          request.input("day_of_week", sql.NVarChar(20), mapped.day_of_week);
          request.input("stop_name", sql.NVarChar, mapped.stop_name);
          request.input("route_label", sql.NVarChar, mapped.route_label);
          request.input("pct_early", sql.Float, mapped.pct_early);
          request.input("pct_ontime", sql.Float, mapped.pct_ontime);
          request.input("pct_late", sql.Float, mapped.pct_late);
          request.input("pct_not_ontime", sql.Float, mapped.pct_not_ontime);
          request.input("pct_missed", sql.Float, mapped.pct_missed);
          request.input("early", sql.Int, mapped.early);
          request.input("ontime", sql.Int, mapped.ontime);
          request.input("late", sql.Int, mapped.late);
          request.input("missed", sql.Int, mapped.missed);
          request.input("actual_departures", sql.Int, mapped.actual_departures);
          request.input("total", sql.Int, mapped.total);
          await request.query(`
            MERGE OtpMonthlyRouteStopDay WITH (HOLDLOCK) AS target
            USING (
              SELECT @service_month AS service_month, @route_id AS route_id,
                     @stop_id AS stop_id, @day_of_week AS day_of_week
            ) AS src
            ON target.service_month = src.service_month AND target.route_id = src.route_id
               AND target.stop_id = src.stop_id AND target.day_of_week = src.day_of_week
            WHEN MATCHED THEN
              UPDATE SET
                stop_name = @stop_name, route_label = @route_label,
                pct_early = @pct_early, pct_ontime = @pct_ontime, pct_late = @pct_late,
                pct_not_ontime = @pct_not_ontime, pct_missed = @pct_missed,
                early = @early, ontime = @ontime, late = @late, missed = @missed,
                actual_departures = @actual_departures, total = @total,
                updated_at = SYSUTCDATETIME()
            WHEN NOT MATCHED THEN
              INSERT (
                service_month, route_id, stop_id, day_of_week, stop_name, route_label,
                pct_early, pct_ontime, pct_late, pct_not_ontime, pct_missed,
                early, ontime, late, missed, actual_departures, total
              )
              VALUES (
                @service_month, @route_id, @stop_id, @day_of_week, @stop_name, @route_label,
                @pct_early, @pct_ontime, @pct_late, @pct_not_ontime, @pct_missed,
                @early, @ontime, @late, @missed, @actual_departures, @total
              );
          `);
          upsertedCount++;
        } catch (err) {
          context.error(`Failed to upsert Avail OTP Monthly report for route ${mapped.route_id}/stop ${mapped.stop_id}:`, err);
        }
      }

      context.log(`Avail OTP Monthly poll: ${reports.length} reports seen, ${upsertedCount} rows upserted for ${serviceMonth}.`);
    }
  },
});
