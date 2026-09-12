import assert from "node:assert/strict";
import test from "node:test";
import { onDemandActivation, onDemandMonitoringServiceIds, onDemandMonitoringState } from "./onDemandMonitoringHealth";

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

test("monitoring disabled is inactive whatever the scope says", () => {
  assert.deepEqual(onDemandActivation(false, new Set()), { active: false, reason: "disabled" });
  assert.deepEqual(onDemandActivation(false, new Set(["svc-a"])), { active: false, reason: "disabled" });
});

test("enabled but unscoped is refused, not widened to every Spare service", () => {
  assert.deepEqual(onDemandActivation(true, new Set()), { active: false, reason: "unscoped" });
});

test("enabled and scoped reconciles exactly the named services", () => {
  const activation = onDemandActivation(true, new Set(["svc-a", "svc-b"]));
  assert.equal(activation.active, true);
  assert.deepEqual([...(activation as { serviceIds: ReadonlySet<string> }).serviceIds].sort(), ["svc-a", "svc-b"]);
});

test("service ids are parsed from the release setting, blanks discarded", () => {
  const prior = process.env.ON_DEMAND_MONITORING_SERVICE_IDS;
  try {
    process.env.ON_DEMAND_MONITORING_SERVICE_IDS = " svc-a , ,svc-b,";
    assert.deepEqual([...onDemandMonitoringServiceIds()].sort(), ["svc-a", "svc-b"]);
    process.env.ON_DEMAND_MONITORING_SERVICE_IDS = "  ";
    assert.equal(onDemandMonitoringServiceIds().size, 0);
  } finally {
    if (prior === undefined) delete process.env.ON_DEMAND_MONITORING_SERVICE_IDS;
    else process.env.ON_DEMAND_MONITORING_SERVICE_IDS = prior;
  }
});
