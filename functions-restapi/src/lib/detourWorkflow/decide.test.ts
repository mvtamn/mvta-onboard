import assert from "node:assert/strict";
import test from "node:test";
import type { LikelyDuplicate } from "../detourDuplicates";
import { decide, nextStep, offeredActs, reviewedFactsChanged, type Decision, type WorkflowSnapshot } from "./decide";
import type { Actor, DetourAct } from "./types";

// The decision behind every Detour workflow act, as tables. The contract test
// (detourWorkflow.db.contract.test.ts) proves the same acts against SQL.

const person: Actor = { kind: "person", name: "occ@example.com" };
const sync: Actor = { kind: "avail_sync" };

const conflict: LikelyDuplicate = {
  kind: "detour", id: "OTHER", label: "D-2026-004", status: "fulfilled",
  start_date: "2026-09-01", end_date: null, reasons: ["routes"], shared: ["460"],
} as LikelyDuplicate;

function snapshot(overrides: Partial<WorkflowSnapshot> = {}): WorkflowSnapshot {
  return {
    id: "D1",
    lifecycle_state: "awaiting_fulfillment",
    fulfillment_mode: "avail",
    workflow_owner: null,
    review_status: "current",
    review_reason: null,
    history_count: 1,
    facts: { closure: "Cedar Ave closed", start_date: "2026-09-20", end_date: null, riders_directed: null, location: null, geometry_json: null, segments: [{ routes: "460", directions: null }] },
    override_reason: null,
    override_ids: [],
    conflicts: [],
    ...overrides,
  };
}

function refusal(decision: Decision): string | null {
  return "refusal" in decision ? decision.refusal.code : null;
}

test("Avail entry results by Workflow state and fulfillment mode", () => {
  const rows: [string, string, DetourAct, string | null, string | null][] = [
    // mode, state, act, refusal, resulting state
    ["avail", "awaiting_fulfillment", { act: "avail_entry", result: "entered" }, null, "fulfilled"],
    ["avail", "awaiting_fulfillment", { act: "avail_entry", result: "conflict" }, null, "fulfillment_failed"],
    ["avail", "awaiting_fulfillment", { act: "avail_entry", result: "not_entered" }, null, "awaiting_fulfillment"],
    // A retry after a failed build may succeed.
    ["avail", "fulfillment_failed", { act: "avail_entry", result: "entered" }, null, "fulfilled"],
    ["avail", "fulfillment_failed", { act: "avail_entry", result: "not_entered" }, null, "awaiting_fulfillment"],
    ["avail", "fulfilled", { act: "avail_entry", result: "entered" }, "not_allowed_from_state", null],
    ["avail", "closed", { act: "avail_entry", result: "conflict" }, "not_allowed_from_state", null],
    ["fixed_route_manual", "fulfilled", { act: "avail_entry", result: "entered" }, "not_avail_backed", null],
    ["mobility_manual", "fulfilled", { act: "avail_entry", result: "not_entered" }, "not_avail_backed", null],
  ];
  for (const [mode, state, act, code, to] of rows) {
    const decision = decide(snapshot({ fulfillment_mode: mode as WorkflowSnapshot["fulfillment_mode"], lifecycle_state: state }), act, person);
    assert.equal(refusal(decision), code, `${mode} ${state} ${JSON.stringify(act)}`);
    if (!("refusal" in decision)) {
      assert.equal(decision.patch.lifecycle_state, to);
      assert.equal(decision.history.event_type, "fulfillment_confirmation");
      assert.equal(decision.history.from_state, state);
    }
  }
});

test("confirming an Avail entry is held by an unresolved conflict or an outstanding re-review", () => {
  assert.equal(refusal(decide(snapshot({ conflicts: [conflict] }), { act: "avail_entry", result: "entered" }, person)), "conflict_unresolved");
  const blocked = decide(snapshot({ conflicts: [conflict] }), { act: "avail_entry", result: "entered" }, person);
  assert.ok("refusal" in blocked && blocked.refusal.sentence.includes("D-2026-004") && blocked.refusal.conflicts?.length === 1);
  assert.equal(refusal(decide(snapshot({ conflicts: [conflict], override_reason: "Same work zone", override_ids: ["OTHER"] }), { act: "avail_entry", result: "entered" }, person)), null);
  // An override covers only the conflicts known when it was recorded.
  assert.equal(refusal(decide(snapshot({ conflicts: [conflict], override_reason: "Same work zone", override_ids: ["EARLIER"] }), { act: "avail_entry", result: "entered" }, person)), "conflict_unresolved");
  assert.equal(refusal(decide(snapshot({ review_status: "needs_review" }), { act: "avail_entry", result: "entered" }, person)), "re_review_outstanding");
  // Recording a failed or deferred attempt stays allowed.
  assert.equal(refusal(decide(snapshot({ review_status: "needs_review", conflicts: [conflict] }), { act: "avail_entry", result: "conflict" }, person)), null);
  assert.equal(refusal(decide(snapshot({ review_status: "needs_review" }), { act: "avail_entry", result: "not_entered" }, person)), null);
});

test("an entered Avail result stamps build confirmation; any other result clears it", () => {
  const entered = decide(snapshot(), { act: "avail_entry", result: "entered", externalDetourId: " 8812 " }, person);
  assert.ok(!("refusal" in entered));
  assert.equal(entered.patch.avail_build_confirmed, "now");
  assert.deepEqual(entered.patch.avail_entry, { result: "entered", external_detour_id: "8812" });
  const failed = decide(snapshot(), { act: "avail_entry", result: "conflict" }, person);
  assert.ok(!("refusal" in failed) && failed.patch.avail_build_confirmed === "clear");
});

test("manual fallback only after an Avail conflict, and not with a re-review outstanding", () => {
  const act: DetourAct = { act: "manual_fallback", reason: "Avail cannot represent the stop closure" };
  const ok = decide(snapshot({ lifecycle_state: "fulfillment_failed" }), act, person);
  assert.ok(!("refusal" in ok));
  assert.deepEqual([ok.patch.fulfillment_mode, ok.patch.lifecycle_state], ["fixed_route_manual", "fulfilled"]);
  assert.equal(ok.history.event_type, "manual_correction");
  assert.equal(refusal(decide(snapshot({ lifecycle_state: "awaiting_fulfillment" }), act, person)), "not_allowed_from_state");
  assert.equal(refusal(decide(snapshot({ fulfillment_mode: "mobility_manual", lifecycle_state: "fulfilled" }), act, person)), "not_avail_backed");
  assert.equal(refusal(decide(snapshot({ lifecycle_state: "fulfillment_failed", review_status: "needs_review" }), act, person)), "re_review_outstanding");
});

test("closing is allowed from any open state, once, and recorded", () => {
  for (const state of ["awaiting_fulfillment", "fulfilled", "fulfillment_failed"]) {
    const decision = decide(snapshot({ lifecycle_state: state, review_status: "needs_review", conflicts: [conflict] }), { act: "close", reason: " Work finished " }, person);
    assert.ok(!("refusal" in decision), state);
    assert.equal(decision.patch.closure_reason, "Work finished");
    assert.deepEqual([decision.history.event_type, decision.history.from_state, decision.history.to_state], ["state_transition", state, "closed"]);
  }
  assert.equal(refusal(decide(snapshot({ lifecycle_state: "closed" }), { act: "close", reason: "again" }, person)), "not_allowed_from_state");
});

test("a conflict override needs current conflicts on an open Detour and covers exactly those", () => {
  const ok = decide(snapshot({ conflicts: [conflict] }), { act: "override_conflict", reason: "Same work zone" }, person);
  assert.ok(!("refusal" in ok));
  assert.deepEqual(ok.patch.conflict_override, { reason: "Same work zone", ids: ["OTHER"] });
  assert.match(ok.history.detail ?? "", /D-2026-004/);
  assert.equal(refusal(decide(snapshot(), { act: "override_conflict", reason: "x" }, person)), "no_conflicts_to_override");
  assert.equal(refusal(decide(snapshot({ lifecycle_state: "closed", conflicts: [conflict] }), { act: "override_conflict", reason: "x" }, person)), "not_allowed_from_state");
});

test("promote and create choose the starting state from the fulfillment mode, once", () => {
  const rows: [DetourAct, string, string][] = [
    [{ act: "promote", mode: "avail" }, "awaiting_fulfillment", "state_transition"],
    [{ act: "promote", mode: "fixed_route_manual" }, "fulfilled", "state_transition"],
    [{ act: "create", mode: "mobility_manual" }, "fulfilled", "created"],
    [{ act: "create", mode: "avail" }, "awaiting_fulfillment", "created"],
  ];
  for (const [act, to, event] of rows) {
    const decision = decide(snapshot({ history_count: 0, lifecycle_state: "fulfilled", fulfillment_mode: "fixed_route_manual" }), act, person);
    assert.ok(!("refusal" in decision));
    assert.equal(decision.patch.lifecycle_state, to);
    assert.equal(decision.history.event_type, event);
  }
  assert.equal(refusal(decide(snapshot({ history_count: 2 }), { act: "create", mode: "avail" }, person)), "already_started");
});

test("an Avail observation is the sync's act; a new one is Avail-backed and fulfilled without build confirmation", () => {
  const fresh = decide(snapshot({ history_count: 0, fulfillment_mode: "fixed_route_manual", lifecycle_state: "fulfilled" }), { act: "avail_observation", externalDetourId: "8812", kind: "new" }, sync);
  assert.ok(!("refusal" in fresh));
  assert.deepEqual([fresh.patch.fulfillment_mode, fresh.patch.lifecycle_state, fresh.patch.avail_build_confirmed], ["avail", "fulfilled", undefined]);
  const preserved = decide(snapshot(), { act: "avail_observation", externalDetourId: "8812", kind: "preserved" }, sync);
  assert.ok(!("refusal" in preserved));
  assert.deepEqual(preserved.patch, {});
  assert.equal(preserved.history.detail, "Observed Avail detour 8812; preserved OnBoard record");
  assert.throws(() => decide(snapshot(), { act: "avail_observation", externalDetourId: "1", kind: "refreshed" }, person), TypeError);
  assert.throws(() => decide(snapshot(), { act: "close", reason: "x" }, sync), TypeError);
});

test("recording an edit raises re-review only when a reviewed fact changes on an open Detour", () => {
  const edit = (proposed: Parameters<typeof reviewedFactsChanged>[1], overrides: Partial<WorkflowSnapshot> = {}) => {
    const decision = decide(snapshot(overrides), { act: "record_edit", proposed }, person);
    assert.ok(!("refusal" in decision));
    assert.equal(decision.history.event_type, "manual_correction");
    return decision.patch.review?.status ?? null;
  };
  // The console sends every field on every save.
  assert.equal(edit({ closure: "Cedar Ave closed", start_date: "2026-09-20", end_date: null, riders_directed: "", segments: [{ routes: "460", directions: "" }] }), null);
  assert.equal(edit({ closure: "Cedar Ave closed at 5th" }), "needs_review");
  assert.equal(edit({ end_date: "2026-09-30" }), "needs_review");
  assert.equal(edit({ segments: [{ routes: "460", directions: null }, { routes: "465", directions: null }] }), "needs_review");
  assert.equal(edit({ location: "Cedar & 5th" }), "needs_review");
  assert.equal(edit({ closure: "Changed" }, { lifecycle_state: "closed" }), null);
  // Editing an unreviewed-facts field only is not a reviewed change.
  assert.equal(edit({}), null);
});

test("completing re-review needs one outstanding", () => {
  const ok = decide(snapshot({ review_status: "needs_review", review_reason: "Dates changed" }), { act: "complete_re_review", notes: "Checked with OCC" }, person);
  assert.ok(!("refusal" in ok));
  assert.deepEqual(ok.patch.review, { status: "current", reason: null });
  assert.equal(ok.history.detail, "OCC re-review completed (raised: Dates changed): Checked with OCC");
  assert.equal(refusal(decide(snapshot(), { act: "complete_re_review" }, person)), "no_re_review_outstanding");
});

test("next step follows the decision, including a fulfilled Avail Detour", () => {
  const rows: [Partial<WorkflowSnapshot>, string][] = [
    [{ fulfillment_mode: "avail", lifecycle_state: "awaiting_fulfillment" }, "ready_for_avail_entry"],
    [{ fulfillment_mode: "avail", lifecycle_state: "fulfillment_failed" }, "avail_conflict"],
    [{ fulfillment_mode: "avail", lifecycle_state: "fulfilled" }, "in_avail"],
    [{ fulfillment_mode: "fixed_route_manual", lifecycle_state: "fulfilled" }, "ready_for_manual_operations"],
    [{ fulfillment_mode: "mobility_manual", lifecycle_state: "fulfilled", review_status: "needs_review" }, "needs_occ_review"],
    [{ lifecycle_state: "closed", review_status: "needs_review" }, "closed"],
  ];
  for (const [overrides, step] of rows) assert.equal(nextStep(snapshot(overrides)), step, JSON.stringify(overrides));
});

test("offered acts are the acts' own refusals", () => {
  const acts = offeredActs(snapshot({ conflicts: [conflict] }));
  assert.equal(acts["avail_entry.entered"].available, false);
  assert.equal(acts["avail_entry.conflict"].available, true);
  assert.equal(acts.override_conflict.available, true);
  assert.equal(acts.manual_fallback.available, false);
  assert.equal(acts.close.available, true);
  assert.equal(acts.complete_re_review.available, false);
  const entered = acts["avail_entry.entered"];
  assert.ok(!entered.available && entered.refusal.code === "conflict_unresolved");
});

test("assigning says who acts next, and changes nothing else about the Detour", () => {
  const decision = decide(snapshot(), { act: "assign", owner: "occ@example.com" }, person);
  assert.ok("patch" in decision);
  assert.deepEqual(decision.patch, { owner: "occ@example.com", workflow: true });
  assert.equal(decision.history.from_state, decision.history.to_state, "assigning is not a transition");
  assert.match(decision.history.detail ?? "", /Assigned to occ@example.com/);
});

test("handing a Detour back to nobody is a real answer", () => {
  const decision = decide(snapshot({ workflow_owner: "occ@example.com" }), { act: "assign", owner: null }, person);
  assert.ok("patch" in decision);
  assert.equal(decision.patch.owner, null);
  assert.match(decision.history.detail ?? "", /Owner cleared/);
});

test("assigning the owner it already has is refused rather than recorded", () => {
  const same = decide(snapshot({ workflow_owner: "occ@example.com" }), { act: "assign", owner: " occ@example.com " }, person);
  assert.ok("refusal" in same);
  assert.equal(same.refusal.code, "no_change");
  const empty = decide(snapshot(), { act: "assign", owner: "   " }, person);
  assert.ok("refusal" in empty);
  assert.equal(empty.refusal.code, "no_change");
});

test("a closed Detour has nothing left to own", () => {
  const decision = decide(snapshot({ lifecycle_state: "closed" }), { act: "assign", owner: "occ@example.com" }, person);
  assert.ok("refusal" in decision);
  assert.equal(decision.refusal.code, "not_allowed_from_state");
});

test("an owner name too long for the column is refused", () => {
  const decision = decide(snapshot(), { act: "assign", owner: "x".repeat(201) }, person);
  assert.ok("refusal" in decision);
  assert.equal(decision.refusal.code, "invalid_owner");
});
