// Timer-triggered ingestion of Avail's OTP By Route/Stop/Day/Hour feed -
// sub-monthly OTP trending, added per OTP-Feed-Evaluation-and-
// Recommendation (3).md's live-data investigation update (2026-08-05, see
// otp-compliance-live-data-rethink.md). Pulls YESTERDAY's full day, once a
// day - the doc's own suggested cadence for this feed. Rolling window, not
// a permanent log: purges rows older than RETENTION_DAYS on every run,
// since the use case is trailing-N-day trending (7-day OTP by stop,
// week-over-week), not indefinite history like FixedRouteDepartures.
//
// KNOWN UNCONFIRMED - more so than any other feed in this project. See
// otpDailyFeed.ts's own header comment: no sample response exists for this
// specific operation anywhere, so the envelope key / field names / URL
// param shape are all guessed by analogy to sibling feeds. Check this
// function's logs after first deploy rather than assuming success.
import { app, type InvocationContext, type Timer } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { fetchOtpDailyReports, mapOtpDailyReport } from "../lib/otpDailyFeed";

const RETENTION_DAYS = 90;

function yesterday(): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function calendarDateNDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

app.timer("otpDailyFeedPoll", {
  schedule: "0 30 3 * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    const baseUrl = process.env.AVAIL_OTP_DAILY_URL;
    const apiKey = process.env.AVAIL_AVL_REPORTS_API_KEY;
    if (!baseUrl || !apiKey) {
      context.warn("AVAIL_OTP_DAILY_URL/AVAIL_AVL_REPORTS_API_KEY are not configured - skipping this run.");
      return;
    }

    const target = yesterday();
    let reports;
    try {
      reports = await fetchOtpDailyReports(baseUrl, apiKey, target, target);
    } catch (err) {
      context.error("Failed to fetch Avail OTP Daily reports:", err);
      return;
    }

    const pool = await getPool();

    const tableCheck = await pool.request().query<{ table_exists: number }>(`
      SELECT CASE WHEN OBJECT_ID('dbo.OtpDailyRouteStopHour', 'U') IS NULL THEN 0 ELSE 1 END AS table_exists
    `);
    if (tableCheck.recordset[0]?.table_exists !== 1) {
      context.warn("OtpDailyRouteStopHour table doesn't exist yet (migration-020 not run) - skipping this run.");
      return;
    }

    let upsertedCount = 0;
    for (const report of reports) {
      let mapped;
      try {
        mapped = mapOtpDailyReport(report);
      } catch (err) {
        context.error(`Failed to map Avail OTP Daily report for route ${report.RouteID}/stop ${report.StopID}:`, err);
        continue;
      }
      if (!mapped) continue;

      try {
        const request = pool.request();
        request.input("calendar_date", sql.Char(8), mapped.calendar_date);
        request.input("hour_of_day", sql.TinyInt, mapped.hour_of_day);
        request.input("route_id", sql.Int, mapped.route_id);
        request.input("stop_id", sql.Int, mapped.stop_id);
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
        request.input("latitude", sql.Float, mapped.latitude);
        request.input("longitude", sql.Float, mapped.longitude);
        request.input("direction", sql.NVarChar, mapped.direction);
        await request.query(`
          MERGE OtpDailyRouteStopHour WITH (HOLDLOCK) AS target
          USING (
            SELECT @calendar_date AS calendar_date, @route_id AS route_id,
                   @stop_id AS stop_id, @hour_of_day AS hour_of_day
          ) AS src
          ON target.calendar_date = src.calendar_date AND target.route_id = src.route_id
             AND target.stop_id = src.stop_id AND target.hour_of_day = src.hour_of_day
          WHEN MATCHED THEN
            UPDATE SET
              stop_name = @stop_name, route_label = @route_label,
              pct_early = @pct_early, pct_ontime = @pct_ontime, pct_late = @pct_late,
              pct_not_ontime = @pct_not_ontime, pct_missed = @pct_missed,
              early = @early, ontime = @ontime, late = @late, missed = @missed,
              actual_departures = @actual_departures, total = @total,
              latitude = @latitude, longitude = @longitude, direction = @direction,
              updated_at = SYSUTCDATETIME()
          WHEN NOT MATCHED THEN
            INSERT (
              calendar_date, hour_of_day, route_id, stop_id, stop_name, route_label,
              pct_early, pct_ontime, pct_late, pct_not_ontime, pct_missed,
              early, ontime, late, missed, actual_departures, total,
              latitude, longitude, direction
            )
            VALUES (
              @calendar_date, @hour_of_day, @route_id, @stop_id, @stop_name, @route_label,
              @pct_early, @pct_ontime, @pct_late, @pct_not_ontime, @pct_missed,
              @early, @ontime, @late, @missed, @actual_departures, @total,
              @latitude, @longitude, @direction
            );
        `);
        upsertedCount++;
      } catch (err) {
        context.error(`Failed to upsert Avail OTP Daily report for route ${mapped.route_id}/stop ${mapped.stop_id}:`, err);
      }
    }

    let purgedCount = 0;
    try {
      const purgeReq = pool.request();
      purgeReq.input("cutoff", sql.Char(8), calendarDateNDaysAgo(RETENTION_DAYS));
      const purgeResult = await purgeReq.query("DELETE FROM OtpDailyRouteStopHour WHERE calendar_date < @cutoff");
      purgedCount = purgeResult.rowsAffected[0] ?? 0;
    } catch (err) {
      context.error("Failed to purge old OtpDailyRouteStopHour rows:", err);
    }

    context.log(
      `Avail OTP Daily poll: ${reports.length} reports seen, ${upsertedCount} rows upserted, ${purgedCount} old rows purged.`,
    );
  },
});
