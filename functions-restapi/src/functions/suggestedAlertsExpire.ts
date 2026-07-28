// Timer-triggered auto-expiry for Suggested Alerts. A pending row nobody
// reviewed within 2 hours flips to 'expired' rather than staying pending
// forever or vanishing - keeps the row (and its external_id) for audit/
// reporting on how often things time out unreviewed, distinct from a human's
// explicit dismiss. Applies uniformly across every source (gtfs_rt, zona,
// missed_trip). A 15-minute cadence is plenty of precision for a 2-hour
// threshold.
import { app, type InvocationContext, type Timer } from "@azure/functions";
import { getPool } from "../lib/db";

app.timer("suggestedAlertsExpire", {
  schedule: "0 */15 * * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    try {
      const pool = await getPool();
      const result = await pool.request().query(`
        UPDATE SuggestedAlerts
        SET status = 'expired', reviewed_by = 'system:auto-expire', reviewed_at = SYSUTCDATETIME()
        WHERE status = 'pending' AND created_at < DATEADD(HOUR, -2, SYSUTCDATETIME())
      `);
      context.log(`Suggested Alerts auto-expiry: ${result.rowsAffected[0]} row(s) expired.`);
    } catch (err) {
      context.error("Failed to auto-expire Suggested Alerts:", err);
    }
  },
});
