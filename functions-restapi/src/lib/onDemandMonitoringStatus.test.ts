import assert from "node:assert/strict";
import test from "node:test";
import type { KpiFeedHealth } from "./kpiTrust";
import { resolveKpiTrust } from "./kpiTrust";
import { onDemandMonitoringStatus } from "./onDemandMonitoringStatus";

const now = new Date("2026-08-27T12:00:00Z");

function reconciliation(overrides: Partial<KpiFeedHealth> = {}): KpiFeedHealth {
  // What runFeedIngestion writes after a reconciliation that started at
  // reconciledAt: success at the end of the run, coverage through its start.
  return {
    feed_name: "spare_on_demand_reconciliation",
    last_success_at: new Date("2026-08-27T11:00:40Z"),
    last_entity_count: 4,
    source_timestamp_at: null,
    coverage_start_at: null,
    coverage_end_at: new Date("2026-08-27T11:00:00Z"),
    ...overrides,
  };
}

test("monitoring disabled is not connected, whatever the ledger holds", () => {
  assert.equal(onDemandMonitoringStatus(false, [], now).state, "not_connected");
  assert.equal(onDemandMonitoringStatus(false, [reconciliation()], now).state, "not_connected");
});

test("a recent reconciliation with active requests is current, and reports when and how many", () => {
  assert.deepEqual(onDemandMonitoringStatus(true, [reconciliation()], now), {
    state: "current",
    lastAuthoritativeReconciliationAt: new Date("2026-08-27T11:00:00Z"),
    activeRequestCount: 4,
  });
});

test("a zero-request reconciliation is no active service", () => {
  assert.equal(onDemandMonitoringStatus(true, [reconciliation({ last_entity_count: 0 })], now).state, "no_active_service");
});

test("never reconciled, or reconciled beyond the 90-minute boundary, is degraded", () => {
  assert.equal(onDemandMonitoringStatus(true, [], now).state, "degraded");
  const old = reconciliation({
    last_success_at: new Date("2026-08-27T10:29:59Z"),
    coverage_end_at: new Date("2026-08-27T10:29:30Z"),
  });
  assert.equal(onDemandMonitoringStatus(true, [old], now).state, "degraded");
});

test("a failure recorded after a good reconciliation keeps the last success until it ages out", () => {
  // The ledger keeps last_success_at when a failure is recorded, so one failed
  // run does not blank the monitor; the 90-minute boundary still decides.
  const failedSince = reconciliation({ last_failure_at: new Date("2026-08-27T11:59:00Z"), last_failure_reason: "Spare 503" });
  assert.equal(onDemandMonitoringStatus(true, [failedSince], now).state, "current");
});

test("the monitoring state and the Admin KPI trust stream can no longer disagree", () => {
  // They used to read two tables written by two non-atomic statements. Every
  // ledger shape here must map onto the same verdict the trust stream gives.
  const cases: KpiFeedHealth[][] = [
    [],
    [reconciliation()],
    [reconciliation({ last_entity_count: 0 })],
    [reconciliation({ last_success_at: new Date("2026-08-27T10:00:00Z"), coverage_end_at: new Date("2026-08-27T10:00:00Z") })],
    [{ feed_name: "spare_on_demand_reconciliation", last_success_at: null, last_entity_count: null, source_timestamp_at: null, last_failure_at: now, last_failure_reason: "unscoped" }],
  ];
  const expected = { current: "current", current_but_empty: "no_active_service", stale: "degraded", unavailable: "degraded" } as const;
  for (const records of cases) {
    const trust = resolveKpiTrust(records, now).on_demand.state;
    assert.equal(onDemandMonitoringStatus(true, records, now).state, expected[trust], JSON.stringify(records));
  }
});
