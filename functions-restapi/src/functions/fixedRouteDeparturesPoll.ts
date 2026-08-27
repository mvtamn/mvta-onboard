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
import { recordFeedHealth } from "../lib/missedTripFeedHealth";

function serviceDateToday(): string {
  // UTC-based, same known simplification used elsewhere in this repo.
  const now = new Date();
  return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
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
      return;
    }

    const pool = await getPool();
    const serviceDate = serviceDateToday();
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
        request.input("service_date", sql.Char(8), serviceDate);
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

    try {
      await recordFeedHealth(pool, "avail_pullout", reports.length, null, {
        startAt: new Date(`${serviceDate.slice(0, 4)}-${serviceDate.slice(4, 6)}-${serviceDate.slice(6, 8)}T00:00:00Z`),
        endAt: new Date(),
      });
    } catch (healthError) {
      context.error("Failed to update Avail Pullout feed health:", healthError);
    }
    context.log(`Avail Pullout Reports poll: ${reports.length} reports seen, ${upsertedCount} rows upserted.`);
  },
});
