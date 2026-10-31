// Timer-triggered ingestion of Avail's OTP By Route/Stop/Day/Hour feed -
// sub-monthly OTP trending, added per OTP-Feed-Evaluation-and-
// Recommendation (3).md's live-data investigation update (2026-08-05, see
// otp-compliance-live-data-rethink.md). Rolling window, not a permanent log:
// purges rows older than RETENTION_DAYS on every run, since the use case is
// trailing-N-day trending (7-day OTP by stop, week-over-week), not indefinite
// history like FixedRouteDepartures.
//
// It runs at 12:00 UTC (07:00 CDT, 06:00 CST) and re-reads the last
// OTP_DAILY_TRAILING_DAYS completed Central service days. It used to run at
// 03:30 UTC and ask for the UTC calendar's yesterday, which at that hour is the
// Central day still in service; Avail publishes a day only after it ends, so
// every run from 2026-08-23 received nothing and the table never held a row.
// Re-reading three days means a day Avail publishes late is filled in by the
// next run rather than lost.
import { app, type InvocationContext, type Timer } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { availConfig, fetchAvail } from "../lib/availClient";
import { agencyServiceDate } from "../lib/missedTripTime";
import {
  dailyMeasurementStampReady,
  mapOtpDailyReport,
  otpDailyCoverage,
  otpDailyWindow,
  upsertOtpDailyReport,
} from "../lib/otpDailyFeed";
import { readParametersInForce } from "../lib/otpMeasurementParameters";
import { runFeedIngestion } from "../lib/feedRun";

const RETENTION_DAYS = 90;

app.timer("otpDailyFeedPoll", {
  schedule: "0 0 12 * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    const { config, missing } = availConfig("otp_daily");
    if (!config) {
      context.warn(`${missing.join("/")} not configured - skipping this run.`);
      return;
    }

    const now = new Date();
    const window = otpDailyWindow(now);
    await runFeedIngestion("avail_otp_daily", context, async () => {
      const pool = await getPool();
      // The measurement standard in force, read before the request so the URL
      // and the stamp cannot disagree (ADR 0042). Same seven numbers as the
      // monthly feed, from the same register.
      const parameters = await readParametersInForce(pool);
      const reports = await fetchAvail(
        "otp_daily",
        { start: window.requestStart, end: window.requestEnd, parameters: parameters.segments },
        config,
      );

      // A missing table is a failure of this feed, not a quiet skip: the ledger
      // would otherwise keep reading as whatever it last said.
      const tableCheck = await pool.request().query<{ table_exists: number }>(`
        SELECT CASE WHEN OBJECT_ID('dbo.OtpDailyRouteStopHour', 'U') IS NULL THEN 0 ELSE 1 END AS table_exists
      `);
      if (tableCheck.recordset[0]?.table_exists !== 1) {
        return { kind: "failed", reason: "OtpDailyRouteStopHour does not exist (migration 020 not applied)." };
      }

      const stampReady = await dailyMeasurementStampReady(pool);
      let upsertedCount = 0;
      let duplicateKeys = 0;
      const keysSeen = new Set<string>();
      const storedByDate = new Map<string, number>();
      for (const report of reports) {
        let mapped;
        try {
          mapped = mapOtpDailyReport(report);
        } catch (err) {
          context.error(`Failed to map Avail OTP Daily report for route ${report.RouteFareboxID}/stop ${report.StopID}:`, err);
          continue;
        }
        if (!mapped) continue;

        // The monthly feed's key turned out not to be unique in Avail's own
        // delivery: for 2026-03 it sent 27 keys twice and each write overwrote
        // the other silently (see lib/otpMonthlyFeed.ts). This table's key has
        // held - 2,104 to 2,127 records a day, every one a distinct key on dev
        // 2026-10-30 - and it has a discriminator the monthly feed lacks
        // (direction, migration 123), so these records are not summed. But the
        // check that would have caught the monthly collapse years earlier costs
        // a Set, so it is here: if this ever fires, a row is being overwritten
        // and the figures it carried are gone.
        const key = `${mapped.calendar_date}|${mapped.route_id}|${mapped.stop_id}|${mapped.hour_of_day}|${mapped.direction ?? ""}`;
        if (keysSeen.has(key)) {
          duplicateKeys++;
          context.warn(
            `Avail OTP Daily poll: ${mapped.calendar_date} route ${mapped.route_id} stop ${mapped.stop_id} ` +
              `hour ${mapped.hour_of_day} direction ${mapped.direction ?? "none"} arrived more than once ` +
              `(total=${mapped.total ?? "null"}/ontime=${mapped.ontime ?? "null"}); the earlier record is being overwritten.`,
          );
        }
        keysSeen.add(key);

        try {
          await upsertOtpDailyReport(pool, mapped, { measurementParameters: parameters.segments, stampReady });
          upsertedCount++;
          storedByDate.set(mapped.calendar_date, (storedByDate.get(mapped.calendar_date) ?? 0) + 1);
        } catch (err) {
          context.error(`Failed to upsert Avail OTP Daily report for route ${mapped.route_id}/stop ${mapped.stop_id}:`, err);
        }
      }

      let purgedCount = 0;
      try {
        const purgeReq = pool.request();
        purgeReq.input("cutoff", sql.Char(8), agencyServiceDate(now, -RETENTION_DAYS).serviceDate);
        const purgeResult = await purgeReq.query("DELETE FROM OtpDailyRouteStopHour WHERE calendar_date < @cutoff");
        purgedCount = purgeResult.rowsAffected[0] ?? 0;
      } catch (err) {
        context.error("Failed to purge old OtpDailyRouteStopHour rows:", err);
      }

      const perDay = window.serviceDates.map((date) => `${date}=${storedByDate.get(date) ?? 0}`).join(", ");
      context.log(
        `Avail OTP Daily poll: ${reports.length} reports seen, ${keysSeen.size} keys` +
          `${duplicateKeys > 0 ? ` (${duplicateKeys} records collided on a key already seen)` : ""}, ` +
          `${upsertedCount} rows upserted (${perDay}), ${purgedCount} old rows purged.`,
      );
      // MVTA runs service every day, so a completed day with nothing in it is
      // Avail not having published it yet, not a quiet day. The next run
      // re-reads it; say so rather than letting it pass as empty.
      const newest = window.serviceDates[window.serviceDates.length - 1];
      if (!storedByDate.has(newest)) {
        context.warn(`Avail OTP Daily poll: no rows yet for ${newest}; it will be re-read on the next run.`);
      }
      // Every skip in the loop above is a mapping or upsert failure, so the
      // shortfall is real loss and the stored-count rule applies directly.
      return {
        kind: "stored",
        received: reports.length,
        stored: upsertedCount,
        noun: "OTP Daily reports",
        coverage: otpDailyCoverage(window, storedByDate.keys()),
      };
    });
  },
});
