import assert from "node:assert/strict";
import test from "node:test";
import { admitsMonitorWrite, onDemandActivation, onDemandMonitoringServiceIds } from "./onDemandMonitoringHealth";

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

test("no monitor write is admitted while monitoring is off or unscoped", () => {
  const disabled = onDemandActivation(false, new Set(["svc-a"]));
  assert.deepEqual(admitsMonitorWrite("svc-a", disabled), { admit: false, reason: "disabled" });
  const unscoped = onDemandActivation(true, new Set());
  assert.deepEqual(admitsMonitorWrite("svc-a", unscoped), { admit: false, reason: "unscoped" });
});

test("an active monitor admits its own services and nothing else", () => {
  const activation = onDemandActivation(true, new Set(["svc-a"]));
  assert.deepEqual(admitsMonitorWrite("svc-a", activation), { admit: true });
  assert.deepEqual(admitsMonitorWrite("svc-b", activation), { admit: false, reason: "out_of_scope" });
});

test("a request Spare did not attribute to a service is never admitted", () => {
  const activation = onDemandActivation(true, new Set(["svc-a"]));
  assert.deepEqual(admitsMonitorWrite(null, activation), { admit: false, reason: "out_of_scope" });
});
