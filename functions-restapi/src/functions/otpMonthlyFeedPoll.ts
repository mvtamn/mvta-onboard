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
import { getPool } from "../lib/db";
import {
  fetchOtpMonthlyReports,
  mapOtpMonthlyReport,
  serviceMonthOf,
  subtractMonths,
  upsertOtpMonthlyReport,
} from "../lib/otpMonthlyFeed";
import { feedHealthOutcome, recordFeedFailure, recordFeedHealth } from "../lib/kpiFeedHealth";

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

    let receivedReports = 0;
    let storedReports = 0;
    let completedFetches = 0;
    for (let i = 0; i < TRAILING_MONTHS; i++) {
      const targetDate = subtractMonths(now, i);
      const serviceMonth = serviceMonthOf(targetDate);

      let reports;
      try {
        reports = await fetchOtpMonthlyReports(baseUrl, apiKey, targetDate);
      } catch (err) {
        context.error(`Failed to fetch Avail OTP Monthly reports for ${serviceMonth}:`, err);
        try { await recordFeedFailure(pool, "avail_otp_monthly", err); } catch (healthError) { context.error("Failed to record Avail OTP Monthly feed failure:", healthError); }
        continue;
      }

      completedFetches++;

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
          await upsertOtpMonthlyReport(pool, mapped);
          upsertedCount++;
        } catch (err) {
          context.error(`Failed to upsert Avail OTP Monthly report for route ${mapped.route_id}/stop ${mapped.stop_id}:`, err);
        }
      }

      context.log(`Avail OTP Monthly poll: ${reports.length} reports seen, ${upsertedCount} rows upserted for ${serviceMonth}.`);
      receivedReports += reports.length;
      storedReports += upsertedCount;
    }
    if (completedFetches === TRAILING_MONTHS) {
      // The coverage guard above already withholds health when a month failed
      // to fetch. This is the other half: every month fetched, and none of what
      // came back could be stored.
      const outcome = feedHealthOutcome(receivedReports, storedReports, "OTP Monthly reports");
      if (outcome.kind === "failure") {
        context.error(`Avail OTP Monthly poll: ${outcome.reason}`);
        try {
          await recordFeedFailure(pool, "avail_otp_monthly", new Error(outcome.reason));
        } catch (healthError) {
          context.error("Failed to record Avail OTP Monthly feed failure:", healthError);
        }
        return;
      }
      if (outcome.unstoredCount > 0) {
        context.warn(`Avail OTP Monthly poll: ${outcome.unstoredCount} of ${receivedReports} reports were not stored.`);
      }
      try {
        await recordFeedHealth(pool, "avail_otp_monthly", outcome.entityCount, null, {
          startAt: subtractMonths(now, TRAILING_MONTHS - 1),
          endAt: now,
        });
      } catch (healthError) {
        context.error("Failed to update Avail OTP Monthly feed health:", healthError);
      }
    } else {
      context.warn(`Avail OTP Monthly feed health was not advanced: ${completedFetches}/${TRAILING_MONTHS} coverage months completed.`);
    }
  },
});
