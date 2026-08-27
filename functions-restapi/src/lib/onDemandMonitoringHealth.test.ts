import assert from "node:assert/strict";
import test from "node:test";
import { onDemandMonitoringState } from "./onDemandMonitoringHealth";

const now = new Date("2026-08-27T12:00:00Z");

test("on-demand monitoring is not connected until the approved source is enabled", () => {
  assert.equal(onDemandMonitoringState(false, null, now), "not_connected");
});

test("on-demand monitoring is current only after a recent authoritative reconciliation", () => {
  assert.equal(onDemandMonitoringState(true, null, now), "degraded");
  assert.equal(onDemandMonitoringState(true, {
    lastAuthoritativeReconciliationAt: new Date("2026-08-27T11:00:00Z"),
    latestSourceUpdateAt: null,
    activeRequestCount: 4,
  }, now), "current");
  assert.equal(onDemandMonitoringState(true, {
    lastAuthoritativeReconciliationAt: new Date("2026-08-27T10:29:59Z"),
    latestSourceUpdateAt: null,
    activeRequestCount: 4,
  }, now), "degraded");
});

test("a successful zero-request reconciliation is no active service", () => {
  assert.equal(onDemandMonitoringState(true, {
    lastAuthoritativeReconciliationAt: new Date("2026-08-27T11:30:00Z"),
    latestSourceUpdateAt: null,
    activeRequestCount: 0,
  }, now), "no_active_service");
});
