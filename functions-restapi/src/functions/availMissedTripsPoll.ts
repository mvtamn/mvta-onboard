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
import { getPool, sql } from "../lib/db";
import { fetchMissedTripReports, mapMissedTripReport } from "../lib/availMissedTripsFeed";
import { serviceMonthOf, subtractMonths } from "../lib/otpMonthlyFeed";

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
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();

      for (const serviceMonth of targetMonths) {
        const deleteReq = new sql.Request(tx);
        deleteReq.input("service_month", sql.Char(6), serviceMonth);
        await deleteReq.query("DELETE FROM AvailMissedTripsRouteStopDay WHERE service_month = @service_month");
      }

      for (const m of mapped) {
        const insertReq = new sql.Request(tx);
        insertReq.input("service_month", sql.Char(6), m.service_month);
        insertReq.input("calendar_date", sql.Char(8), m.calendar_date);
        insertReq.input("route_id", sql.Int, m.route_id);
        insertReq.input("route_desc", sql.NVarChar, m.route_desc);
        insertReq.input("route_internet_name", sql.NVarChar, m.route_internet_name);
        insertReq.input("departure_stop_id", sql.Int, m.departure_stop_id);
        insertReq.input("departure_stop_name", sql.NVarChar, m.departure_stop_name);
        insertReq.input("arrival_stop_id", sql.Int, m.arrival_stop_id);
        insertReq.input("arrival_stop_name", sql.NVarChar, m.arrival_stop_name);
        insertReq.input("departure_missed", sql.Bit, m.departure_missed);
        insertReq.input("arrival_missed", sql.Bit, m.arrival_missed);
        insertReq.input("entire_trip_missed", sql.Bit, m.entire_trip_missed);
        insertReq.input("departure_trip_start_time", sql.DateTime2, m.departure_trip_start_time);
        await insertReq.query(`
          INSERT INTO AvailMissedTripsRouteStopDay (
            service_month, calendar_date, route_id, route_desc, route_internet_name,
            departure_stop_id, departure_stop_name, arrival_stop_id, arrival_stop_name,
            departure_missed, arrival_missed, entire_trip_missed, departure_trip_start_time
          )
          VALUES (
            @service_month, @calendar_date, @route_id, @route_desc, @route_internet_name,
            @departure_stop_id, @departure_stop_name, @arrival_stop_id, @arrival_stop_name,
            @departure_missed, @arrival_missed, @entire_trip_missed, @departure_trip_start_time
          )
        `);
      }

      await tx.commit();
      context.log(
        `Avail Missed Trips poll: ${reports.length} reports seen, ${mapped.length} rows reloaded across ${targetMonths.join(", ")}.`,
      );
    } catch (err) {
      try {
        await tx.rollback();
      } catch {
        /* already rolled back / not begun */
      }
      context.error(`Failed to refresh AvailMissedTripsRouteStopDay for ${targetMonths.join(", ")}:`, err);
    }
  },
});
