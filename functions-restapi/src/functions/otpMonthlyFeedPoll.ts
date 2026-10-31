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
import { availConfig, fetchAvail } from "../lib/availClient";
import {
  collapseOtpMonthlyReports,
  describeOtpMonthlyCollision,
  mapOtpMonthlyReport,
  measurementStampReady,
  restatementLedgerReady,
  serviceMonthOf,
  subtractMonths,
  upsertOtpMonthlyReport,
  type OtpMonthlyCandidate,
} from "../lib/otpMonthlyFeed";
import { readParametersInForce } from "../lib/otpMeasurementParameters";
import {
  describeRetiredKey,
  retireVanishedMonthlyKeys,
  retirementArchiveReady,
} from "../lib/otpMonthlyRetirement";
import { runFeedIngestion } from "../lib/feedRun";

const TRAILING_MONTHS = 3; // current + prior 2

app.timer("otpMonthlyFeedPoll", {
  schedule: "0 0 3 * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    const { config, missing } = availConfig("otp_monthly");
    if (!config) {
      context.warn(`${missing.join("/")} not configured - skipping this run.`);
      return;
    }

    const now = new Date();
    await runFeedIngestion("avail_otp_monthly", context, async () => {
      const pool = await getPool();
      // Read once for the whole run, not per row (migration 141).
      const ledgerReady = await restatementLedgerReady(pool);
      // Likewise the measurement standard and whether it can be recorded
      // (migration 151, ADR 0042). Reading it once means every row this run
      // stores is stamped with the standard the run actually asked for, even if
      // a new set is declared while it is still going.
      const stampReady = await measurementStampReady(pool);
      // And whether a key Avail has stopped returning can be archived
      // (migration 152, ADR 0043). Without the archive nothing is retired: the
      // archive is where a retired row still exists.
      const archiveReady = await retirementArchiveReady(pool);
      const parameters = await readParametersInForce(pool);
      context.log(
        `Avail OTP Monthly poll: measuring at ${parameters.segments} (${parameters.origin === "register"
          ? `declared ${parameters.declaration?.effective_from}, ${parameters.declaration?.source}`
          : "compiled default - no declaration in force"}).`,
      );
      const currentServiceMonth = serviceMonthOf(now);
      let receivedReports = 0;
      let storedReports = 0;
      const failedMonths: string[] = [];
      for (let i = 0; i < TRAILING_MONTHS; i++) {
        const targetDate = subtractMonths(now, i);
        const serviceMonth = serviceMonthOf(targetDate);

        let reports;
        try {
          reports = await fetchAvail("otp_monthly", { month: targetDate, parameters: parameters.segments }, config);
        } catch (err) {
          // One month failing must not stop the others refreshing, but it does
          // stop this run claiming coverage of the whole trailing window.
          context.error(`Failed to fetch Avail OTP Monthly reports for ${serviceMonth}:`, err);
          failedMonths.push(`${serviceMonth} (${err instanceof Error ? err.message : String(err)})`);
          continue;
        }

        const candidates: OtpMonthlyCandidate[] = [];
        for (const report of reports) {
          let mapped;
          try {
            mapped = mapOtpMonthlyReport(report, serviceMonth);
          } catch (err) {
            context.error(`Failed to map Avail OTP Monthly report for route ${report.RouteID}/stop ${report.StopID}:`, err);
            continue;
          }
          if (!mapped) continue;
          candidates.push({ mapped, source: report });
        }

        // Avail sends more than one record per key when a month holds more than
        // one schedule pattern, and the MERGE's key cannot tell them apart.
        // Collapsing first is what stops the second write overwriting the
        // first; reporting it is what stops that being invisible.
        const { rows, collisions } = collapseOtpMonthlyReports(candidates);
        for (const collision of collisions) {
          context.warn(`Avail OTP Monthly poll: ${describeOtpMonthlyCollision(collision)}`);
        }

        let upsertedCount = 0;
        let accountedReports = 0;
        for (const { row, recordCount } of rows) {
          try {
            await upsertOtpMonthlyReport(pool, row, {
              ledgerReady,
              currentServiceMonth,
              measurementParameters: parameters.segments,
              stampReady,
            });
            upsertedCount++;
            accountedReports += recordCount;
          } catch (err) {
            context.error(`Failed to upsert Avail OTP Monthly report for route ${row.route_id}/stop ${row.stop_id}:`, err);
          }
        }

        // A key the month holds and this payload did not mention is a key no
        // poll can reach, and since migration 151 one that nothing can ever
        // stamp - so the month would sit on the re-pull list for good. It is
        // archived and removed, but only from a payload that accounted for
        // essentially the whole month, and only when every upsert landed: a run
        // that could not write what Avail sent is in no position to decide what
        // Avail no longer sends.
        if (upsertedCount === rows.length) {
          try {
            const retirement = await retireVanishedMonthlyKeys(pool, {
              serviceMonth,
              returned: rows.map(({ row }) => row),
              retiredBy: "otpMonthlyFeedPoll",
              archiveReady,
            });
            if (retirement.absent > 0) {
              // Logged whether it retired or not. A refusal is the more
              // interesting of the two: it means a month shrank by more than a
              // rounding error, which is a question for a human.
              const line = `Avail OTP Monthly poll: ${serviceMonth} - ${retirement.reason}.`;
              if (retirement.retire) context.log(line);
              else context.warn(line);
              for (const key of retirement.retired) {
                context.log(`Avail OTP Monthly poll: ${describeRetiredKey(serviceMonth, key)}.`);
              }
            }
          } catch (err) {
            // Retiring is housekeeping on top of a poll that has already stored
            // the month. It failing must not fail the run.
            context.error(`Failed to retire vanished OTP Monthly keys for ${serviceMonth}:`, err);
          }
        } else if (rows.length > 0) {
          context.warn(
            `Avail OTP Monthly poll: ${serviceMonth} - ${rows.length - upsertedCount} of ${rows.length} keys ` +
              "failed to upsert, so no key was retired this run.",
          );
        }

        context.log(
          `Avail OTP Monthly poll: ${reports.length} reports seen, ${rows.length} keys` +
            `${collisions.length > 0 ? ` (${collisions.length} keys carried more than one record)` : ""}, ` +
            `${upsertedCount} rows upserted for ${serviceMonth}.`,
        );
        receivedReports += reports.length;
        // What the table represents, not how many rows it took: a summed pair
        // is two records stored, or feed health would read a collapse as two
        // records sent and one kept (`feedHealthOutcome`).
        storedReports += accountedReports;
      }
      if (failedMonths.length > 0) {
        return {
          kind: "failed",
          reason: `${failedMonths.length}/${TRAILING_MONTHS} coverage months could not be fetched: ${failedMonths.join("; ")}`,
        };
      }
      return {
        kind: "stored",
        received: receivedReports,
        stored: storedReports,
        noun: "OTP Monthly reports",
        coverage: { startAt: subtractMonths(now, TRAILING_MONTHS - 1), endAt: now },
      };
    });
  },
});
