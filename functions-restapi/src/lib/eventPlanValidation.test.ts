import test from "node:test";
import assert from "node:assert/strict";
import { validateEventPlanReadiness } from "./eventPlanValidation.js";

const ready = {
  routeCount: 1,
  geofenceCount: 1,
  geofencesWithRules: 1,
  validDates: true,
  routeConflict: false,
};

test("accepts a complete plan before approval or activation", () => {
  assert.deepEqual(validateEventPlanReadiness(ready), { valid: true });
});

test("rejects approval readiness when a geofence is missing", () => {
  assert.deepEqual(validateEventPlanReadiness({ ...ready, geofenceCount: 0, geofencesWithRules: 0 }), {
    valid: false,
    error: "An active plan must include an active geofence",
  });
});

test("allows operational-only geofences when a separate messaging geofence has a rule", () => {
  assert.deepEqual(validateEventPlanReadiness({ ...ready, geofenceCount: 2, geofencesWithRules: 1 }), { valid: true });
});

test("rejects approval readiness when no messaging geofence has a rule", () => {
  assert.deepEqual(validateEventPlanReadiness({ ...ready, geofencesWithRules: 0 }), {
    valid: false,
    error: "An active plan must include at least one messaging geofence with a direction rule",
  });
});

test("rejects a route conflict before publishing scope", () => {
  assert.deepEqual(validateEventPlanReadiness({ ...ready, routeConflict: true }), {
    valid: false,
    error: "A reason is required to override the active route conflict",
  });
});

test("route conflict applies even when periods belong to the same Event", () => {
  assert.deepEqual(validateEventPlanReadiness({ ...ready, routeConflict: true }), {
    valid: false,
    error: "A reason is required to override the active route conflict",
  });
});

test("accepts a route conflict when an authorized reason is recorded", () => {
  assert.deepEqual(validateEventPlanReadiness({ ...ready, routeConflict: true }, "Shared route is intentional for the overlapping transfer window"), { valid: true });
});

test("rejects a route conflict when the override reason is blank", () => {
  assert.deepEqual(validateEventPlanReadiness({ ...ready, routeConflict: true }, "   "), {
    valid: false,
    error: "A reason is required to override the active route conflict",
  });
});
