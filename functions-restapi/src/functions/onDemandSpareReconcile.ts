// Hourly authoritative reconciliation for the on-demand wait monitor. The
// webhook receiver may make records fresher, but only this complete source
// read advances the health record exposed to OCC.
import { app, type InvocationContext, type Timer } from "@azure/functions";
import { getPool } from "../lib/db";
import { recordFeedFailure, recordFeedHealth } from "../lib/kpiFeedHealth";
import { evaluateOnDemandInterventions } from "../lib/onDemandInterventions";
import { onDemandActivation } from "../lib/onDemandMonitoringHealth";
import { normalizeOnDemandSpareRequest } from "../lib/onDemandSpareMonitor";
import {
  loadActiveOperationalZones,
  recordOnDemandAuthoritativeReconciliation,
  storeOnDemandSpareRequest,
} from "../lib/onDemandSpareMonitorStore";
import {
  fetchSpareUpdatedWindow,
  positiveEnvInteger,
  spareString,
  type SparePageFetcher,
  type SpareRequestRecord,
} from "../lib/spareApi";

const PAGE_SIZE = 200;
const DEFAULT_MAX_ROWS = 10_000;

// How far back each hourly run reads. This is a *window*, not the whole
// history: the read used to page /v1/requests unbounded, which on real data
// reaches the row cap among records years old and throws before it ever sees
// today - an hourly feed failure that would have looked like a Spare outage
// and was ours. The same bounded-window contract the missed-trip ingest has
// run on since August applies here.
//
// Twenty-four hours, against an hourly run, is heavy overlap by design: a
// request has to go a full day without a single Spare update to fall out of
// the read, and an on-demand request that is genuinely live updates far more
// often than that (status, ETA, vehicle location). The cost of the overlap is
// re-storing rows that have not changed, which storeOnDemandSpareRequest
// already treats as a no-op.
const DEFAULT_LOOKBACK_MINUTES = 24 * 60;

export async function fetchAuthoritativeRequests(
  scoped: ReadonlySet<string>,
  nowSeconds: number,
  fetchPage?: SparePageFetcher,
): Promise<SpareRequestRecord[]> {
  const lookbackMinutes = positiveEnvInteger(
    "ON_DEMAND_RECONCILE_LOOKBACK_MINUTES", DEFAULT_LOOKBACK_MINUTES, 7 * 24 * 60,
  );
  const maxRows = positiveEnvInteger("ON_DEMAND_RECONCILE_MAX_ROWS", DEFAULT_MAX_ROWS, 50_000);
  const rows = await fetchSpareUpdatedWindow<SpareRequestRecord>(
    "/v1/requests", nowSeconds - lookbackMinutes * 60, nowSeconds, PAGE_SIZE, maxRows, fetchPage,
  );
  // The scope is applied here rather than as a query filter. Spare's request
  // filters include a service filter, but its exact parameter name has never
  // been confirmed against the live API, and a filter Spare silently ignores
  // would widen the reconciliation to every service the key can see - the one
  // outcome onDemandActivation exists to prevent. Filtering rows we hold is
  // slower and cannot be wrong. Confirm the parameter and this becomes a
  // narrower read rather than a different result.
  return rows.filter((row) => {
    const serviceId = spareString(row.serviceId, 64);
    return serviceId !== null && scoped.has(serviceId);
  });
}

app.timer("onDemandSpareReconcile", {
  schedule: "0 0 * * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    const activation = onDemandActivation();
    if (!activation.active && activation.reason === "disabled") {
      context.log("On-demand reconciliation is disabled (ON_DEMAND_MONITORING_ENABLED is not true).");
      return;
    }
    const reconciledAt = new Date();
    const pool = await getPool();
    if (!activation.active) {
      // Refused rather than run unscoped: reading every service the key can
      // see would look like a healthy reconciliation while covering the wrong
      // population. Recorded as a feed failure so the misconfiguration shows
      // up in KPI trust instead of going quiet.
      const err = new Error("ON_DEMAND_MONITORING_ENABLED is true but ON_DEMAND_MONITORING_SERVICE_IDS is empty; refusing to reconcile every Spare service.");
      context.error(err.message);
      try { await recordFeedFailure(pool, "spare_on_demand_reconciliation", err); } catch (healthError) {
        context.error("Failed to record on-demand reconciliation feed failure:", healthError);
      }
      return;
    }
    let requests: SpareRequestRecord[];
    try {
      requests = await fetchAuthoritativeRequests(
        activation.serviceIds, Math.floor(reconciledAt.getTime() / 1000),
      );
    } catch (err) {
      context.error("On-demand authoritative reconciliation failed:", err);
      try { await recordFeedFailure(pool, "spare_on_demand_reconciliation", err); } catch (healthError) {
        context.error("Failed to record on-demand reconciliation feed failure:", healthError);
      }
      throw err;
    }
    const zones = await loadActiveOperationalZones();
    let writes = 0;
    let latestSourceUpdateAt: Date | null = null;
    const activeRequestIds = new Set<string>();
    for (const request of requests) {
      const normalized = normalizeOnDemandSpareRequest(request);
      if (!normalized) continue;
      if (await storeOnDemandSpareRequest(normalized, zones, reconciledAt)) writes++;
      if (normalized.state === "active") activeRequestIds.add(normalized.requestId);
      if (!latestSourceUpdateAt || normalized.sourceUpdatedAt > latestSourceUpdateAt) {
        latestSourceUpdateAt = normalized.sourceUpdatedAt;
      }
    }
    await recordOnDemandAuthoritativeReconciliation({
      reconciledAt,
      latestSourceUpdateAt,
      activeRequestCount: activeRequestIds.size,
    });
    // Evaluated here too, on the freshest possible state, rather than waiting
    // up to five minutes for onDemandInterventionsEvaluate. Both callers share
    // one implementation and one debounce, so a breach seen by both is still
    // two observations of a sustained condition, not a shortcut past it.
    await evaluateOnDemandInterventions(pool, reconciledAt, reconciledAt);
    try {
      // This complete source read - not the missed-trip ingestion - is what
      // makes On-Demand KPI trust current. A zero-active reconciliation still
      // covers the source through reconciledAt, so it reads as current-but-empty
      // rather than unavailable.
      await recordFeedHealth(pool, "spare_on_demand_reconciliation", activeRequestIds.size, null, {
        endAt: reconciledAt,
      });
    } catch (healthError) {
      context.error("Failed to update on-demand reconciliation feed health:", healthError);
    }
    context.log(`On-demand reconciliation: ${requests.length} source requests checked; ${writes} monitor records updated.`);
  },
});
