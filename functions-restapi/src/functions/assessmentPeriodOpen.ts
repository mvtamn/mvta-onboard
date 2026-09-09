import { app, type InvocationContext, type Timer } from "@azure/functions";
import { assessPeriod } from "../lib/assessment/assess";
import { generateArtifact } from "../lib/assessment/generateArtifact";
import { monthBoundaryPlan, priorServiceMonth, serviceMonthInChicago, type PeriodStatus } from "../lib/assessment/monthBoundary";
import { openPeriodSql } from "../lib/assessment/openPeriod";
import { agreementScope, assignedStandardCountSql } from "../lib/assessment/schemaScope";
import { getPool, sql } from "../lib/db";

// The repo's first month-boundary schedule (design §9): 06:00 UTC on the 1st
// - 01:00 Central, the new month an hour old. For each contractor whose
// Agreement covers the month it opens the new period, opens the prior one
// if nobody did, computes the prior month if nobody has reviewed it, and
// generates its Validation Draft. It shares nothing, issues nothing, and
// notifies no one; a manager acts. Opt-in by app setting, so an environment
// where the compute or the report is not yet trusted runs it by hand.
//
// Idempotent per run: what already exists is left as it is, and a month a
// person has reviewed is never recomputed by a clock. The serverless
// database auto-pauses; the first query may be a cold-start wake.
const ACTOR = "assessmentPeriodOpen";

app.timer("assessmentPeriodOpen", {
  schedule: "0 0 6 1 * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    if (process.env.ASSESSMENT_MONTH_BOUNDARY_ENABLED !== "true") { context.warn("ASSESSMENT_MONTH_BOUNDARY_ENABLED is not 'true' - skipping this run."); return; }
    try {
      const pool = await getPool();
      const ready = await pool.request().query<{ ready: number }>(`SELECT CASE WHEN OBJECT_ID('dbo.AssessmentPeriods','U') IS NOT NULL AND OBJECT_ID('dbo.PerformanceAgreements','U') IS NOT NULL THEN 1 ELSE 0 END ready`);
      if (!ready.recordset[0]?.ready) { context.warn("Assessment tables are not ready; migrations 030/032b may be pending."); return; }
      const scope = await agreementScope(pool);
      const now = new Date();
      // The active Agreement, as the open handler sees it. A renewal that
      // began this month stands the old Agreement down, so the prior month
      // falls outside the window and is left for a person to open by hand.
      const contractors = await pool.request().query<{ id: string; agreement_id: string; name: string }>(`SELECT c.id,a.id agreement_id,c.name FROM Contractors c JOIN PerformanceAgreements a ON a.contractor_id=c.id AND a.is_active=1 WHERE c.is_active=1`);
      for (const contractor of contractors.recordset) {
        try {
          const statusOf = async (month: string) => { const r = pool.request(); r.input("contractor", sql.UniqueIdentifier, contractor.id); r.input("month", sql.Char(6), month); return (await r.query<{ status: PeriodStatus }>(`SELECT TOP 1 status FROM AssessmentPeriods WHERE contractor_id=@contractor AND service_month=@month ORDER BY assessment_revision DESC`)).recordset[0]?.status ?? null; };
          const currentMonth = serviceMonthInChicago(now), priorMonth = priorServiceMonth(currentMonth);
          const current = await statusOf(currentMonth);
          const cand = pool.request(); cand.input("contractor", sql.UniqueIdentifier, contractor.id); cand.input("month", sql.Char(6), priorMonth);
          const priorCandidates = (await cand.query<{ n: number }>(`SELECT COUNT(*) n FROM ComplianceOccurrences WHERE contractor_id=@contractor AND service_month=@month AND review_status='candidate'`)).recordset[0]?.n ?? 0;
          const plan = monthBoundaryPlan({ now, priorStatus: await statusOf(priorMonth), currentStatus: current, priorCandidates });
          if (plan.held) context.warn(`${contractor.name}: ${priorMonth} has ${plan.held}; it will be computed but not drafted until they are reviewed.`);
          for (const month of [plan.openPrior, plan.openCurrent]) {
            if (!month) continue;
            const coverage = pool.request(); coverage.input("contractor", sql.UniqueIdentifier, contractor.id); coverage.input("month", sql.Char(6), month); coverage.input("agreement", sql.UniqueIdentifier, contractor.agreement_id);
            const agreementWindow = (await coverage.query<{ assigned: number; covers: number }>(`SELECT ${assignedStandardCountSql(scope)} assigned,CASE WHEN CONCAT(@month,'01') BETWEEN CONVERT(char(8),a.starts_on,112) AND CONVERT(char(8),a.ends_on,112) THEN 1 ELSE 0 END covers FROM Contractors c JOIN PerformanceAgreements a ON a.id=@agreement WHERE c.id=@contractor`)).recordset[0];
            if (!agreementWindow?.covers) { context.log(`${contractor.name}: Agreement does not cover ${month}; not opened.`); continue; }
            if (!agreementWindow.assigned) { context.warn(`${contractor.name}: no standards assigned for ${month}; not opened.`); continue; }
            const open = pool.request(); open.input("contractor", sql.UniqueIdentifier, contractor.id); open.input("month", sql.Char(6), month); open.input("agreement", sql.UniqueIdentifier, contractor.agreement_id);
            await open.query(openPeriodSql(scope));
            context.log(`${contractor.name}: opened ${month}.`);
          }
          if (plan.compute) {
            const period = pool.request(); period.input("contractor", sql.UniqueIdentifier, contractor.id); period.input("month", sql.Char(6), plan.compute);
            const id = (await period.query<{ id: string }>(`SELECT TOP 1 id FROM AssessmentPeriods WHERE contractor_id=@contractor AND service_month=@month ORDER BY assessment_revision DESC`)).recordset[0]?.id;
            if (!id) { context.warn(`${contractor.name}: ${plan.compute} has no period to compute.`); continue; }
            const tx = new sql.Transaction(pool); await tx.begin();
            try { await assessPeriod(tx, id); await tx.commit(); } catch (e) { try { await tx.rollback(); } catch { /* aborted */ } throw e; }
            context.log(`${contractor.name}: computed ${plan.compute}.`);
            if (plan.draft) {
              const draft = await generateArtifact(pool, { periodId: id, type: "preliminary", actor: ACTOR });
              if (draft.status === 201) context.log(`${contractor.name}: Validation Draft v${draft.version} for ${plan.compute} (${draft.hash.slice(0, 12)}).`);
              else context.warn(`${contractor.name}: Validation Draft for ${plan.compute} not generated: ${draft.error}`);
            }
          }
        } catch (error) { context.error(`assessmentPeriodOpen: ${contractor.name} failed`, error); }
      }
    } catch (error) { context.error("assessmentPeriodOpen failed", error); }
  },
});
