// Hourly authoritative reconciliation for the on-demand wait monitor. The
// webhook receiver may make records fresher, but only this complete source
// read advances the health record exposed to OCC.
import { app, type InvocationContext, type Timer } from "@azure/functions";
import { getPool } from "../lib/db";
import { recordFeedFailure, recordFeedHealth } from "../lib/missedTripFeedHealth";
import { reconcileOnDemandInterventions } from "../lib/onDemandInterventions";
import { normalizeOnDemandSpareRequest } from "../lib/onDemandSpareMonitor";
import {
  loadActiveOperationalZones,
  recordOnDemandAuthoritativeReconciliation,
  storeOnDemandSpareRequest,
} from "../lib/onDemandSpareMonitorStore";
import { fetchSparePage, spareString, type SpareRequestRecord } from "../lib/spareApi";

const PAGE_SIZE = 200;
const MAX_ROWS = 10_000;

function enabled(): boolean {
  return process.env.ON_DEMAND_MONITORING_ENABLED?.trim().toLowerCase() === "true";
}

function serviceIds(): ReadonlySet<string> {
  return new Set((process.env.ON_DEMAND_MONITORING_SERVICE_IDS ?? "")
    .split(",").map((value) => value.trim()).filter(Boolean));
}

async function fetchAuthoritativeRequests(): Promise<SpareRequestRecord[]> {
  const rows: SpareRequestRecord[] = [];
  let skip = 0;
  let total = 0;
  while (rows.length < MAX_ROWS) {
    const page = await fetchSparePage<SpareRequestRecord>("/v1/requests", new URLSearchParams({
      orderBy: "updatedAt",
      limit: String(Math.min(PAGE_SIZE, MAX_ROWS - rows.length)),
      skip: String(skip),
    }));
    total = page.total;
    rows.push(...page.data);
    skip += page.data.length;
    if (page.data.length === 0 || skip >= page.total) break;
  }
  if (rows.length >= MAX_ROWS && total > rows.length) {
    throw new Error(`On-demand reconciliation exceeded the ${MAX_ROWS}-row safety cap`);
  }
  const scoped = serviceIds();
  return scoped.size === 0
    ? rows
    : rows.filter((row) => {
      const serviceId = spareString(row.serviceId, 64);
      return serviceId !== null && scoped.has(serviceId);
    });
}

app.timer("onDemandSpareReconcile", {
  schedule: "0 0 * * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    if (!enabled()) {
      context.log("On-demand reconciliation is disabled (ON_DEMAND_MONITORING_ENABLED is not true).");
      return;
    }
    const reconciledAt = new Date();
    const pool = await getPool();
    let requests: SpareRequestRecord[];
    try {
      requests = await fetchAuthoritativeRequests();
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
    await reconcileOnDemandInterventions(pool, reconciledAt, activeRequestIds);
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
