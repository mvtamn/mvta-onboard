import assert from "node:assert/strict";
import test from "node:test";
import { classifyEventScopeException } from "./eventScopeExceptions";

const complete = {
  route_category: "SpecialEvent",
  operator_name: "Operator",
  block: 1,
  run: 2,
  is_stale: false,
  is_in_active_scope: false,
  has_other_active_scope: false,
};

test("classifies a fresh complete vehicle outside the selected scope for review", () => {
  assert.equal(classifyEventScopeException(complete), "needs_scope_review");
});
test("prioritizes incomplete telemetry over stale and assignment conditions", () => {
  assert.equal(classifyEventScopeException({ ...complete, operator_name: null, is_stale: true, has_other_active_scope: true }), "telemetry_incomplete");
});

test("classifies stale and assigned-elsewhere observations", () => {
  assert.equal(classifyEventScopeException({ ...complete, is_stale: true }), "stale_observation");
  assert.equal(classifyEventScopeException({ ...complete, has_other_active_scope: true }), "assigned_elsewhere");
});

test("does not classify ordinary shared-AVL or in-scope observations", () => {
  assert.equal(classifyEventScopeException({ ...complete, route_category: null }), null);
  assert.equal(classifyEventScopeException({ ...complete, is_in_active_scope: true }), null);
});
