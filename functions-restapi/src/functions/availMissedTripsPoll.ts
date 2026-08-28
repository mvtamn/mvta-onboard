// Timer-triggered ingestion of Avail's Missed Trips By Route/Stop/Day feed
// (MissedTripsByRouteStopDay) - recommended primary Missed Trips feed per
// OTP-Feed-Evaluation-and-Recommendation.md. Unlike OTP Monthly, this feed
// takes a genuine Start/End Date range, so the trailing window below is one
// fetch, not one per month. Returns individual incident records with no
// reliable per-record unique key (see migration-015's comment), so every
// run does a full DELETE + re-INSERT of every month in the trailing window
// - safe and idempotent regardless of the missing natural key.
//
// CHANGED 2026-08-05 per OTP-Feed-Evaluation-and-Recommendation (3).md's
// live-data investigation findings (see otp-compliance-live-data-rethink.md):
// this used to poll HOURLY but only ever refresh the CURRENT month - same
// "can't notice a month that fills in late" gap as otpMonthlyFeedPoll.ts
// had. Now runs DAILY over a trailing window (current month + prior 2)
// instead of hourly over the current month alone.
import { app, type InvocationContext, type Timer } from "@azure/functions";
import { getPool } from "../lib/db";
import { fetchMissedTripReports, mapMissedTripReport, replaceMissedTripsForMonths } from "../lib/availMissedTripsFeed";
import { serviceMonthOf, subtractMonths } from "../lib/otpMonthlyFeed";
import { recordFeedHealth } from "../lib/kpiFeedHealth";

const TRAILING_MONTHS = 3; // current + prior 2

function firstOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

app.timer("availMissedTripsPoll", {
  schedule: "0 0 3 * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    const baseUrl = process.env.AVAIL_MISSED_TRIPS_URL;
    const apiKey = process.env.AVAIL_AVL_REPORTS_API_KEY;
    if (!baseUrl || !apiKey) {
      context.warn("AVAIL_MISSED_TRIPS_URL/AVAIL_AVL_REPORTS_API_KEY are not configured - skipping this run.");
      return;
    }

    const now = new Date();
    const windowStart = firstOfMonth(subtractMonths(now, TRAILING_MONTHS - 1));
    const targetMonths = Array.from({ length: TRAILING_MONTHS }, (_, i) => serviceMonthOf(subtractMonths(now, i)));

    let reports;
    try {
      reports = await fetchMissedTripReports(baseUrl, apiKey, windowStart, now);
    } catch (err) {
      context.error("Failed to fetch Avail Missed Trips reports:", err);
      return;
    }

    const mapped = reports
      .map((report) => {
        try {
          return mapMissedTripReport(report);
        } catch (err) {
          context.error(`Failed to map Avail Missed Trips report for route ${report.RouteID}:`, err);
          return null;
        }
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);

    const pool = await getPool();
    try {
      await replaceMissedTripsForMonths(pool, targetMonths, mapped);
      context.log(
        `Avail Missed Trips poll: ${reports.length} reports seen, ${mapped.length} rows reloaded across ${targetMonths.join(", ")}.`,
      );
    } catch (err) {
      context.error(`Failed to refresh AvailMissedTripsRouteStopDay for ${targetMonths.join(", ")}:`, err);
      return;
    }
    try {
      await recordFeedHealth(pool, "avail_missed_trips", reports.length, null, { startAt: windowStart, endAt: now });
    } catch (err) {
      context.error("Failed to record Avail Missed Trips feed health:", err);
    }
  },
});
