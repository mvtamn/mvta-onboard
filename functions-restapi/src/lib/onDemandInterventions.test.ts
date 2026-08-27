import assert from "node:assert/strict";
import test from "node:test";
import { onDemandInterventionDecision } from "./onDemandInterventions";

test("an observed service-standard breach creates an intervention immediately", () => {
  assert.deepEqual(onDemandInterventionDecision(0, 26, 26, 25), {
    projectedBreachCount: 1,
    needsIntervention: true,
  });
});

test("a projected breach needs two authoritative reconciliations", () => {
  assert.deepEqual(onDemandInterventionDecision(0, 12, 26, 25), {
    projectedBreachCount: 1,
    needsIntervention: false,
  });
  assert.deepEqual(onDemandInterventionDecision(1, 12, 26, 25), {
    projectedBreachCount: 2,
    needsIntervention: true,
  });
});

test("a recovered prediction resets its consecutive-breach count", () => {
  assert.deepEqual(onDemandInterventionDecision(1, 12, 24, 25), {
    projectedBreachCount: 0,
    needsIntervention: false,
  });
});
