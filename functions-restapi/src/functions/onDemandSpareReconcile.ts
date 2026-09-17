// Hourly authoritative reconciliation for the on-demand wait monitor. The
// webhook receiver may make records fresher, but only this complete source
// read advances the currency record exposed to OCC: the
// spare_on_demand_reconciliation row of KpiFeedHealth.
import { app, type InvocationContext, type Timer } from "@azure/functions";
import { getPool } from "../lib/db";
import { runFeedIngestion } from "../lib/feedRun";
import { evaluateOnDemandInterventions } from "../lib/onDemandInterventions";
import { onDemandActivation } from "../lib/onDemandMonitoringHealth";
import { readOnDemandRequestWindow } from "../lib/onDemandRequestSource";
import { loadActiveOperationalZones, storeOnDemandSpareRequest } from "../lib/onDemandSpareMonitorStore";

app.timer("onDemandSpareReconcile", {
  schedule: "0 0 * * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    const activation = onDemandActivation();
    if (!activation.active && activation.reason === "disabled") {
      context.log("On-demand reconciliation is disabled (ON_DEMAND_MONITORING_ENABLED is not true).");
      return;
    }
    const reconciledAt = new Date();
    // Everything that decides whether this reconciliation happened runs inside
    // runFeedIngestion, so a throw or a zone gap is recorded with its reason
    // rather than leaving the On-Demand stream to age to Stale unexplained.
    const result = await runFeedIngestion("spare_on_demand_reconciliation", context, async () => {
      if (!activation.active) {
        // Refused rather than run unscoped: reading every service the key can
        // see would look like a healthy reconciliation while covering the wrong
        // population. Recorded as a feed failure so the misconfiguration shows
        // up in KPI trust instead of going quiet.
        return {
          kind: "failed",
          reason: "ON_DEMAND_MONITORING_ENABLED is true but ON_DEMAND_MONITORING_SERVICE_IDS is empty; refusing to reconcile every Spare service.",
        };
      }
      const { fetched, requests } = await readOnDemandRequestWindow(
        activation, Math.floor(reconciledAt.getTime() / 1000),
      );
      const zones = await loadActiveOperationalZones();
      let writes = 0;
      const activeRequestIds = new Set<string>();
      for (const request of requests) {
        const outcome = await storeOnDemandSpareRequest(request, zones, reconciledAt);
        // Without an active zone version nothing can be stored, so this read
        // did not make the monitor whole and must not be recorded as if it had.
        if (outcome === "no_active_zones") {
          return {
            kind: "failed",
            reason: "No active on-demand operational zones are available; the reconciliation read Spare but could not update the monitor. Activate a zone version in OnDemandOperationalZoneVersions.",
          };
        }
        if (outcome === "applied") writes++;
        if (request.state === "active") activeRequestIds.add(request.requestId);
      }
      context.log(`On-demand reconciliation: ${fetched} source requests read, ${requests.length} in scope; ${writes} monitor records updated.`);
      // This complete source read - not the missed-trip ingestion - is what
      // makes On-Demand KPI trust current, and the only record of it: the
      // monitoring state the console and the intervention evaluator show is a
      // projection of this row (onDemandMonitoringStatus), not a second table.
      // A zero-active reconciliation still covers the source through
      // reconciledAt, so it reads as current-but-empty (no_active_service)
      // rather than unavailable.
      return {
        kind: "stored",
        received: activeRequestIds.size,
        stored: activeRequestIds.size,
        coverage: { endAt: reconciledAt },
      };
    });
    if (result.kind !== "health") return;

    // Evaluated here too, on the freshest possible state, rather than waiting
    // up to five minutes for onDemandInterventionsEvaluate. Both callers share
    // one implementation and one debounce, so a breach seen by both is still
    // two observations of a sustained condition, not a shortcut past it.
    // It runs after the feed is settled: an evaluation that fails is not a
    // reconciliation that failed.
    await evaluateOnDemandInterventions(await getPool(), reconciledAt, reconciledAt);
  },
});
