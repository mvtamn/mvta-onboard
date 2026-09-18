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
import { availConfig, fetchAvail } from "../lib/availClient";
import { mapMissedTripReport, replaceMissedTripsForMonths } from "../lib/availMissedTripsFeed";
import { serviceMonthOf, subtractMonths } from "../lib/otpMonthlyFeed";
import { runFeedIngestion } from "../lib/feedRun";
import { observeMissedTrips } from "../lib/missedTripCase";
import { availObservations, DEFAULT_LOOKBACK_DAYS } from "../lib/missedTripCase/adapters/avail";
import { availLinksReady, linksFrom, recordAvailLinks } from "../lib/missedTripCase/adapters/availLinks";

const TRAILING_MONTHS = 3; // current + prior 2

async function reconcileAvailAgainstCases(context: InvocationContext): Promise<void> {
  try {
    const { observations, tally, matches } = await availObservations();
    const report = observations.length === 0
      ? null
      : await observeMissedTrips(await getPool(), observations);
    for (const failure of report?.failed ?? []) {
      context.error(`Failed to record Avail evidence for ${failure.runId} on ${failure.serviceDate}:`, failure.error);
    }
    context.log(
      `Avail reconciliation: ${tally.reports} reports, ${tally.exact} exact, ${tally.probable} probable, ` +
        `${tally.unmatched} unmatched. ${report?.evidenceRecorded ?? 0} case(s) updated, ` +
        `${report?.skippedChanged ?? 0} changed elsewhere, ${report?.failed.length ?? 0} failed.`,
    );
    // Left for a reviewer means left somewhere a reviewer can find it. The
    // links outlive the run; without them a probable match is counted, warned
    // about and forgotten, and nothing can ever be confirmed.
    const pool = await getPool();
    if (await availLinksReady(pool)) {
      const links = await recordAvailLinks(pool, linksFrom(matches), DEFAULT_LOOKBACK_DAYS);
      if (links.retracted > 0) {
        context.warn(`Avail no longer reports ${links.retracted} record(s) it reported before. Any case they corroborated has lost that corroboration.`);
      }
    } else {
      context.warn("AvailEvidenceLinks is missing - has migration 136 been run? Probable links are counted but not kept.");
    }
    if (tally.probable > 0) {
      context.warn(`${tally.probable} Avail report(s) matched more than one case, or carried no start time, and were left for a reviewer.`);
    }
    if (tally.unmatched > 0) {
      context.warn(`${tally.unmatched} Avail report(s) matched no case at all - runs no other source noticed.`);
    }
  } catch (err) {
    // Reconciliation failing must not make the ingestion itself look failed:
    // the rows are stored and the next run reconciles them.
    context.error("Avail retrospective reconciliation failed; the reloaded rows are kept:", err);
  }
}

function firstOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

app.timer("availMissedTripsPoll", {
  schedule: "0 0 3 * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    const { config, missing } = availConfig("missed_trips");
    if (!config) {
      context.warn(`${missing.join("/")} not configured - skipping this run.`);
      return;
    }

    const now = new Date();
    const windowStart = firstOfMonth(subtractMonths(now, TRAILING_MONTHS - 1));
    const targetMonths = Array.from({ length: TRAILING_MONTHS }, (_, i) => serviceMonthOf(subtractMonths(now, i)));

    await runFeedIngestion("avail_missed_trips", context, async () => {
      const reports = await fetchAvail("missed_trips", { start: windowStart, end: now }, config);

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

      // replaceMissedTripsForMonths DELETEs the target months before inserting,
      // so an empty mapped set does not merely record nothing - it erases months
      // of retained evidence and then reports a clean run. Reports that all
      // failed to map are a source or contract problem, not an instruction to
      // discard the rows already held, so the reload is not attempted and the
      // report below is recorded as the failure it is.
      if (reports.length > 0 && mapped.length === 0) {
        context.warn(`Avail Missed Trips poll: retained rows for ${targetMonths.join(", ")} are left in place.`);
      } else {
        // A failed reload leaves the table holding the previous rows, so its
        // throw has to reach the ledger rather than a claimed success.
        await replaceMissedTripsForMonths(await getPool(), targetMonths, mapped);
        context.log(
          `Avail Missed Trips poll: ${reports.length} reports seen, ${mapped.length} rows reloaded across ${targetMonths.join(", ")}.`,
        );
        // Retrospective reconciliation (ADR-0035). Runs on the rows just
        // reloaded, and only corroborates: it opens no case, reopens none, and
        // rewrites no review. A contradiction becomes an Evidence conflict for
        // a reviewer to settle.
        await reconcileAvailAgainstCases(context);
      }
      return {
        kind: "stored",
        received: reports.length,
        stored: mapped.length,
        noun: "missed-trip reports",
        coverage: { startAt: windowStart, endAt: now },
      };
    });
  },
});
