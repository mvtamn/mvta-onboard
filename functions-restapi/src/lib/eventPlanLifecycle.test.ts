import assert from "node:assert/strict";
import test from "node:test";
import type { sql } from "./db";
import { transitionEventPlan, type PlanTransaction } from "./eventPlanLifecycle";

// A transaction that records what was issued, in order, and whether it ended
// committed or rolled back. The bug these tests hold shut was never about a
// single statement being wrong - it was about WHEN each one ran and whether it
// was inside the transaction at all, so order and outcome are what is asserted.
function fakeTransaction(status: string | null) {
  const issued: string[] = [];
  let outcome: "open" | "committed" | "rolled back" = "open";
  const tx: PlanTransaction & { issued: string[]; outcome: () => string } = {
    request() {
      const request = {
        input() { return request; },
        async query(text: string) {
          if (text.includes("SELECT status FROM EventServicePlans")) {
            issued.push("read status");
            return { recordset: status === null ? [] : [{ status }] };
          }
          if (text.includes("INSERT INTO EventServicePlanConflictOverrides")) {
            issued.push("write override");
            return { recordset: [] };
          }
          if (text.includes("UPDATE EventServicePlans SET status=")) {
            issued.push("change status");
            return { recordset: [{ id: "plan1", status: "active" }] };
          }
          throw new Error(`unexpected statement: ${text}`);
        },
      };
      return request as unknown as sql.Request;
    },
    async commit() { outcome = "committed"; },
    async rollback() { outcome = "rolled back"; },
    issued,
    outcome: () => outcome,
  };
  return tx;
}

const READY = { routeCount: 1, geofenceCount: 1, geofencesWithRules: 1, validDates: true, routeConflict: false };
const CONFLICTED = { ...READY, routeConflict: true };

function deps(readiness = READY, issued?: string[]) {
  return {
    readReadiness: async () => readiness,
    captureSnapshot: async (tx: PlanTransaction) => { void tx; issued?.push("publish snapshot"); },
  };
}

test("activation publishes its snapshot before the status change and inside the transaction", async () => {
  const tx = fakeTransaction("approved");
  const result = await transitionEventPlan(tx, { planId: "plan1", action: "advance", actor: "a@example.com", conflictOverrideReason: null }, deps(READY, tx.issued));
  assert.equal(result.status, 200);
  assert.deepEqual(tx.issued, ["read status", "publish snapshot", "change status"]);
  assert.equal(tx.outcome(), "committed");
});

test("a plan that is not approved cannot publish a snapshot", async () => {
  // The defect: the snapshot was captured on the pool BEFORE an UPDATE guarded
  // by status='approved'. A plan in review got a 409 and a published scope.
  const tx = fakeTransaction("review");
  const result = await transitionEventPlan(tx, { planId: "plan1", action: "advance", actor: "a@example.com", conflictOverrideReason: null }, deps(READY, tx.issued));
  assert.equal(result.status, 409);
  assert.deepEqual(tx.issued, ["read status"]);
  assert.ok(!tx.issued.includes("publish snapshot"));
  assert.equal(tx.outcome(), "rolled back");
});

test("a refused activation writes no conflict override either", async () => {
  // The override shared the defect: it was written before the guarded UPDATE,
  // so a refused activation left a recorded reason behind.
  const tx = fakeTransaction("draft");
  const result = await transitionEventPlan(tx, { planId: "plan1", action: "advance", actor: "a@example.com", conflictOverrideReason: "Shared route is intentional" }, deps(CONFLICTED, tx.issued));
  assert.equal(result.status, 409);
  assert.deepEqual(tx.issued, ["read status"]);
  assert.equal(tx.outcome(), "rolled back");
});

test("an unready plan rolls back without writing its override or snapshot", async () => {
  // Readiness is checked after the row is locked but before anything is
  // written, so failing it leaves nothing behind.
  const tx = fakeTransaction("approved");
  const result = await transitionEventPlan(tx, { planId: "plan1", action: "advance", actor: "a@example.com", conflictOverrideReason: null }, deps({ ...READY, routeCount: 0 }, tx.issued));
  assert.equal(result.status, 409);
  assert.deepEqual(tx.issued, ["read status"]);
  assert.equal(tx.outcome(), "rolled back");
});

test("an overridden conflict writes the reason, the snapshot and the status together", async () => {
  const tx = fakeTransaction("approved");
  const result = await transitionEventPlan(tx, { planId: "plan1", action: "advance", actor: "a@example.com", conflictOverrideReason: "Shared route is intentional" }, deps(CONFLICTED, tx.issued));
  assert.equal(result.status, 200);
  assert.deepEqual(tx.issued, ["read status", "write override", "publish snapshot", "change status"]);
  assert.equal(tx.outcome(), "committed");
});

test("a conflict with no reason is refused before anything is written", async () => {
  const tx = fakeTransaction("approved");
  const result = await transitionEventPlan(tx, { planId: "plan1", action: "advance", actor: "a@example.com", conflictOverrideReason: null }, deps(CONFLICTED, tx.issued));
  assert.equal(result.status, 409);
  assert.match((result.body as { error: string }).error, /reason is required/i);
  assert.deepEqual(tx.issued, ["read status"]);
  assert.equal(tx.outcome(), "rolled back");
});

test("approving writes no snapshot - only activation publishes scope", async () => {
  const tx = fakeTransaction("review");
  const result = await transitionEventPlan(tx, { planId: "plan1", action: "approve", actor: "a@example.com", conflictOverrideReason: null }, deps(READY, tx.issued));
  assert.equal(result.status, 200);
  assert.deepEqual(tx.issued, ["read status", "change status"]);
});

test("suspending and completing need no readiness and publish nothing", async () => {
  for (const action of ["suspend", "complete"]) {
    const tx = fakeTransaction("active");
    const deniedReadiness = { readReadiness: async () => { throw new Error("readiness must not be read"); }, captureSnapshot: async () => { throw new Error("must not publish"); } };
    const result = await transitionEventPlan(tx, { planId: "plan1", action, actor: "a@example.com", conflictOverrideReason: null }, deniedReadiness);
    assert.equal(result.status, 200, action);
    assert.deepEqual(tx.issued, ["read status", "change status"], action);
  }
});

test("a plan that does not exist is a 404 and writes nothing", async () => {
  const tx = fakeTransaction(null);
  const result = await transitionEventPlan(tx, { planId: "missing", action: "advance", actor: "a@example.com", conflictOverrideReason: null }, deps(READY, tx.issued));
  assert.equal(result.status, 404);
  assert.deepEqual(tx.issued, ["read status"]);
  assert.equal(tx.outcome(), "rolled back");
});

test("an act outside the lifecycle table rolls back and reads nothing", async () => {
  const tx = fakeTransaction("active");
  const result = await transitionEventPlan(tx, { planId: "plan1", action: "constructor", actor: "a@example.com", conflictOverrideReason: null }, deps(READY, tx.issued));
  assert.equal(result.status, 409);
  assert.deepEqual(tx.issued, []);
  assert.equal(tx.outcome(), "rolled back");
});
