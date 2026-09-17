// Timer-triggered Spare missed-trip evaluation. The Spare adapter evaluates the
// already-ingested requests and slots and records each evaluation; the
// Missed-trip case module decides what each one means for its case. It does no
// ridership, wait-time, or garage-departure work.
import { app, type InvocationContext, type Timer } from "@azure/functions";
import { getPool } from "../lib/db";
import { observeMissedTrips } from "../lib/missedTripCase";
import { contractorFaultValues, spareMissedTripsEnabled, spareObservations } from "../lib/missedTripCase/adapters/spare";

app.timer("spareMissedTripsEvaluate", {
  schedule: "0 5/15 * * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    if (!spareMissedTripsEnabled()) {
      context.log("Spare missed-trip evaluation is disabled (SPARE_MISSED_TRIPS_ENABLED is not true).");
      return;
    }
    const pool = await getPool();
    const { observations, tally } = await spareObservations(pool);
    const report = await observeMissedTrips(pool, observations);
    for (const failure of report.failed) {
      context.error(`Failed to record Spare missed-trip case ${failure.runId} on ${failure.serviceDate}:`, failure.error);
    }
    context.log(
      `Spare missed-trip evaluation: ${tally.evaluated} requests evaluated, ${tally.candidates} candidates, ` +
        `${tally.unknown} unknown-data outcomes. Cases: ${report.created} created, ${report.held} held, ` +
        `${report.confirmed} released from hold, ${report.closedByEvidence} closed by evidence, ` +
        `${report.evidenceRecorded} evidence recorded, ${report.skippedChanged} changed elsewhere, ${report.failed.length} failed.`,
    );
    if (contractorFaultValues().size === 0) {
      context.warn("SPARE_CONTRACTOR_FAULT_VALUES is empty; cancellations remain unknown instead of being auto-flagged.");
    }
  },
});
