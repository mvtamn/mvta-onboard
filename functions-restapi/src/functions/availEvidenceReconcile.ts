// Retrospective reconciliation of Avail's missed-trip report against the cases
// OnBoard holds (ADR-0036). Runs after the Avail poll has reloaded the feed, so
// each night's links are matched against what Avail reported that night.
//
// Reconciliation only records links. It never opens a case, never confirms one,
// and a probable link affects nothing until a reviewer agrees with it.
import { app, type InvocationContext, type Timer } from "@azure/functions";
import { getPool } from "../lib/db";
import { reconcileAvailEvidence, sourceLinksReady } from "../lib/availReconciliation";
import { serviceMonthOf, subtractMonths } from "../lib/otpMonthlyFeed";

// The same trailing window the Avail poll reloads, so the two agree on what
// "currently reported" means.
const TRAILING_MONTHS = 3;

app.timer("availEvidenceReconcile", {
  // Half an hour after availMissedTripsPoll's 03:00 reload.
  schedule: "0 30 3 * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    const pool = await getPool();
    if (!(await sourceLinksReady(pool))) {
      context.warn("MissedTripSourceLinks is missing - has migration 135 been run? Skipping this run.");
      return;
    }
    const now = new Date();
    const months = Array.from({ length: TRAILING_MONTHS }, (_, i) => serviceMonthOf(subtractMonths(now, i)));
    const report = await reconcileAvailEvidence(pool, months, now);
    context.log(
      `Avail reconciliation over ${months.join(", ")}: ${report.incidents} incidents - ` +
      `${report.exact} exact, ${report.probable} probable, ${report.unmatched} unmatched; ${report.missing} no longer reported.`,
    );
  },
});
