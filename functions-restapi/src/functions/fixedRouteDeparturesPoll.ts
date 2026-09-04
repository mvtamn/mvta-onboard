// Timer-triggered ingestion of Avail's Pullout Reports API - garage-side
// departure compliance tracking (check-in/login/pullout timing, scheduled vs
// actual). Distinct from availAvlPoll.ts (live GPS): this is a GROWING
// HISTORICAL LOG, not a "latest state" table - rows are upserted by
// (service_date, block, run) and never deleted, so history accumulates for
// trend analysis just by this poller running day after day. Reuses the same
// Avail360 API key as AVL Reports (AVAIL_AVL_REPORTS_API_KEY) - only the URL
// differs.
import { app, type InvocationContext, type Timer } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { fetchPulloutReports, mapPulloutReport } from "../lib/availPullout";
import { agencyServiceDate, serviceDateAndGtfsSecondsToUtc } from "../lib/missedTripTime";
import { recordFeedFailure, recordFeedHealth } from "../lib/kpiFeedHealth";

// What this run should write to the KPI feed-health ledger.
//
// The ledger backs this KPI's trust state, so its count has to describe what
// FixedRouteDepartures actually holds, not what the feed handed over. Recording
// reports.length meant a run that fetched cleanly and then failed every upsert
// still advanced last_success_at at full volume, and the module read Current
// while nothing had been stored.
//
// Nothing persisted from a non-empty fetch is a failure, not an empty success:
// recording health would clear last_failure_reason and move last_success_at
// forward, which is how an ingestion outage stays invisible. A partial loss is
// still a success - one bad report should not discard a good run - but it is
// counted honestly and warned about. An empty fetch is untouched: service runs
// 08:00-22:00, so overnight polls legitimately return nothing, and per ADR 0027
// a successful run with no records is Current-but-empty, not a fault.
export type PulloutHealthOutcome =
  | { kind: "failure"; reason: string }
  | { kind: "health"; entityCount: number; unstoredCount: number };

export function pulloutHealthOutcome(reportCount: number, storedCount: number): PulloutHealthOutcome {
  if (reportCount > 0 && storedCount === 0) {
    return { kind: "failure", reason: `Fetched ${reportCount} pullout reports but stored none.` };
  }
  return { kind: "health", entityCount: storedCount, unstoredCount: reportCount - storedCount };
}

app.timer("fixedRouteDeparturesPoll", {
  schedule: "0 */5 * * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    const baseUrl = process.env.AVAIL_PULLOUT_URL;
    const apiKey = process.env.AVAIL_AVL_REPORTS_API_KEY;
    if (!baseUrl || !apiKey) {
      context.warn("AVAIL_PULLOUT_URL/AVAIL_AVL_REPORTS_API_KEY are not configured - skipping this run.");
      return;
    }

    let reports;
    try {
      reports = await fetchPulloutReports(baseUrl, apiKey);
    } catch (err) {
      context.error("Failed to fetch Avail Pullout Reports:", err);
      try {
        await recordFeedFailure(await getPool(), "avail_pullout", err);
      } catch (healthError) {
        context.error("Failed to record Avail Pullout feed failure:", healthError);
      }
      return;
    }

    const pool = await getPool();
    // Only the feed-health window uses the poll clock; each row carries its
    // own service date, derived from that run's garage times (see
    // pulloutServiceDate) so the MERGE key survives the UTC date rollover
    // that lands mid-service in agency-local time.
    const pollServiceDate = agencyServiceDate(new Date()).serviceDate;
    let upsertedCount = 0;

    for (const report of reports) {
      let mapped;
      try {
        mapped = mapPulloutReport(report);
      } catch (err) {
        context.error(`Failed to map Avail Pullout report for block ${report.Block}:`, err);
        continue;
      }
      if (!mapped) continue;

      try {
        const request = pool.request();
        request.input("service_date", sql.Char(8), mapped.service_date);
        request.input("block", sql.Int, mapped.block);
        request.input("run", sql.Int, mapped.run);
        request.input("checkin_scheduled", sql.DateTime2, mapped.checkin_scheduled);
        request.input("checkin_actual", sql.DateTime2, mapped.checkin_actual);
        request.input("login_scheduled", sql.DateTime2, mapped.login_scheduled);
        request.input("login_actual", sql.DateTime2, mapped.login_actual);
        request.input("pullout_scheduled", sql.DateTime2, mapped.pullout_scheduled);
        request.input("pullout_actual", sql.DateTime2, mapped.pullout_actual);
        request.input("pullout_status", sql.NVarChar, mapped.pullout_status);
        request.input("operator_name", sql.NVarChar, mapped.operator_name);
        request.input("logon_id", sql.Int, mapped.logon_id);
        request.input("vehicle_label", sql.NVarChar, mapped.vehicle_label);
        await request.query(`
          MERGE FixedRouteDepartures WITH (HOLDLOCK) AS target
          USING (SELECT @service_date AS service_date, @block AS block, @run AS run) AS src
          ON target.service_date = src.service_date AND target.block = src.block AND target.run = src.run
          WHEN MATCHED THEN
            UPDATE SET
              checkin_scheduled = @checkin_scheduled, checkin_actual = @checkin_actual,
              login_scheduled = @login_scheduled, login_actual = @login_actual,
              pullout_scheduled = @pullout_scheduled, pullout_actual = @pullout_actual,
              pullout_status = @pullout_status, operator_name = @operator_name,
              logon_id = @logon_id, vehicle_label = @vehicle_label,
              updated_at = SYSUTCDATETIME()
          WHEN NOT MATCHED THEN
            INSERT (
              service_date, block, run, checkin_scheduled, checkin_actual,
              login_scheduled, login_actual, pullout_scheduled, pullout_actual,
              pullout_status, operator_name, logon_id, vehicle_label
            )
            VALUES (
              @service_date, @block, @run, @checkin_scheduled, @checkin_actual,
              @login_scheduled, @login_actual, @pullout_scheduled, @pullout_actual,
              @pullout_status, @operator_name, @logon_id, @vehicle_label
            );
        `);
        upsertedCount++;
      } catch (err) {
        context.error(`Failed to upsert Avail Pullout report for block ${mapped.block}/run ${mapped.run}:`, err);
      }
    }

    const outcome = pulloutHealthOutcome(reports.length, upsertedCount);
    if (outcome.kind === "failure") {
      context.error(`Avail Pullout Reports poll: ${outcome.reason}`);
      try {
        await recordFeedFailure(pool, "avail_pullout", new Error(outcome.reason));
      } catch (healthError) {
        context.error("Failed to record Avail Pullout feed failure:", healthError);
      }
      return;
    }

    try {
      await recordFeedHealth(pool, "avail_pullout", outcome.entityCount, null, {
        startAt: serviceDateAndGtfsSecondsToUtc(pollServiceDate, 0) ?? new Date(),
        endAt: new Date(),
      });
    } catch (healthError) {
      context.error("Failed to update Avail Pullout feed health:", healthError);
    }
    if (outcome.unstoredCount > 0) {
      context.warn(`Avail Pullout Reports poll: ${outcome.unstoredCount} of ${reports.length} reports were not stored.`);
    }
    context.log(`Avail Pullout Reports poll: ${reports.length} reports seen, ${upsertedCount} rows upserted.`);
  },
});
