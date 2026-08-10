import test from "node:test";
import assert from "node:assert/strict";
import { classifyEventScope } from "./eventScope";

const activeScope = {
  routeCategory: "SpecialEvent" as const,
  routeIsActive: true,
  planStatus: "active" as const,
  planStartDate: "2026-08-10",
  planEndDate: "2026-08-12",
  serviceDate: "2026-08-11",
  routeLinked: true,
  geofenceLinked: true,
  geofenceActive: true,
  hasDirectionRule: true,
};

test("classifies a complete active operating scope", () => {
  assert.deepEqual(classifyEventScope(activeScope), { kind: "operational", reason: "in_active_scope" });
});

test("classifies a SpecialEvent vehicle without an active plan as unplanned", () => {
  assert.deepEqual(classifyEventScope({ ...activeScope, planStatus: "draft" }), { kind: "unplanned", reason: "no_active_service_plan" });
});

test("keeps non-SpecialEvent routes out of Event operations", () => {
  assert.deepEqual(classifyEventScope({ ...activeScope, routeCategory: "FixedRoute" }), { kind: "out_of_scope", reason: "route_not_special_event" });
});

test("rejects observations outside the operating period", () => {
  assert.deepEqual(classifyEventScope({ ...activeScope, serviceDate: "2026-08-13" }), { kind: "out_of_scope", reason: "outside_operating_period" });
});

test("rejects an operational scope without a usable direction rule", () => {
  assert.deepEqual(classifyEventScope({ ...activeScope, hasDirectionRule: false }), { kind: "out_of_scope", reason: "direction_rule_not_covered" });
});
