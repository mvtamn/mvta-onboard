// Evaluates on-demand service-quality interventions against the monitor state
// the hourly reconciliation and the Spare webhook both maintain.
//
// It exists because cadence was the whole problem. The intervention lifecycle
// ran only inside the hourly authoritative reconciliation, so ADR 0026's
// "an observed breach creates one Suggested Alert immediately" meant up to an
// hour, and a projected breach - which needs two consecutive evaluations, so it
// is not raised off one noisy forecast - meant up to two. The applicable
// service standard is twenty-five minutes. Every draft described a trip that
// had already finished, which is worse than no draft: it invites an operator to
// message customers about a wait that has resolved.
//
// Five minutes makes an observed breach actionable inside the standard and
// confirms a projected one in five to ten. It does not touch the source and
// makes no claim about currency: only the hourly reconciliation establishes
// that, and this run stands down whenever it says the monitor is not current.
import { app, type InvocationContext, type Timer } from "@azure/functions";
import { getPool } from "../lib/db";
import { evaluateOnDemandInterventions } from "../lib/onDemandInterventions";
import { onDemandMonitoringEnabled, onDemandMonitoringState } from "../lib/onDemandMonitoringHealth";

interface HealthRow {
  last_authoritative_reconciliation_at: Date | null;
  latest_source_update_at: Date | null;
  active_request_count: number | null;
}

app.timer("onDemandInterventionsEvaluate", {
  schedule: "0 */5 * * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    if (!onDemandMonitoringEnabled()) return;

    const pool = await getPool();
    const health = await pool.request().query<HealthRow>(`
      IF OBJECT_ID('dbo.OnDemandMonitoringHealth', 'U') IS NULL
        SELECT CAST(NULL AS DATETIME2) AS last_authoritative_reconciliation_at,
          CAST(NULL AS DATETIME2) AS latest_source_update_at, CAST(NULL AS INT) AS active_request_count;
      ELSE
        SELECT last_authoritative_reconciliation_at, latest_source_update_at, active_request_count
        FROM dbo.OnDemandMonitoringHealth WHERE id = 1;
    `);
    const row = health.recordset[0] ?? null;
    const state = onDemandMonitoringState(true, row && {
      lastAuthoritativeReconciliationAt: row.last_authoritative_reconciliation_at,
      latestSourceUpdateAt: row.latest_source_update_at,
      activeRequestCount: row.active_request_count,
    });

    // Degraded means the last authoritative reconciliation is too old to
    // support a claim about now. Records may still be arriving by webhook, but
    // acting on them here would create rider-facing drafts from a source the
    // console is simultaneously telling operators not to trust. Read-only until
    // reconciliation recovers, which is the same rule the workspace applies to
    // its own actions.
    if (state !== "current") {
      context.log(`On-demand intervention evaluation stood down: monitoring is ${state}.`);
      return;
    }
    const coveredSince = row?.last_authoritative_reconciliation_at;
    if (!coveredSince) return;

    await evaluateOnDemandInterventions(pool, new Date(), coveredSince);
  },
});
