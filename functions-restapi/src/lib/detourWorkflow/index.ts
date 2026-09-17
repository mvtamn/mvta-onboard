// The Detour workflow module (ADR-0030). It is the only writer of a Detour's
// Workflow state, fulfillment mode, Outstanding re-review and Conflict
// override, and of DetourWorkflowHistory. Every change is a named act
// (DetourAct); each act locks the Detour, is decided in decide.ts, and writes
// its row change and exactly one history entry in one transaction.
//
// Refusals are returned, never thrown; a throw means the database failed.
import type { CallerPrincipal } from "../auth";
import { sql } from "../db";
import { currentConflictStatus, decide, needsConflicts, nextStep, offeredActs } from "./decide";
import { applyDecision, lockAndLoad, loadSnapshots } from "./store";
import type { ActOutcome, Actor, DetourAct, DetourWorkflowView } from "./types";

export * from "./types";

export function actorFrom(principal: CallerPrincipal): Actor {
  return { kind: "person", name: principal.userDetails || "system" };
}

// Runs the act in its own transaction: committed when the act succeeds,
// rolled back when it is refused or fails.
export async function performDetourAct(pool: sql.ConnectionPool, detourId: string, act: DetourAct, actor: Actor): Promise<ActOutcome> {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const outcome = await performDetourActIn(tx, detourId, act, actor);
    if (outcome.ok) await tx.commit();
    else await tx.rollback();
    return outcome;
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      // The transaction may already have ended.
    }
    throw err;
  }
}

// Runs the act inside the caller's transaction, which the caller commits or
// rolls back - including after a refusal, since nothing was written. Used
// where the Detour row is inserted in that same transaction (promote, create,
// the Avail sync).
export async function performDetourActIn(tx: sql.Transaction, detourId: string, act: DetourAct, actor: Actor): Promise<ActOutcome> {
  const snapshot = await lockAndLoad(tx, detourId, needsConflicts(act));
  if (!snapshot) return { ok: false, refusal: { code: "not_found", sentence: "This Detour was not found. It may have been deleted." } };
  const decision = decide(snapshot, act, actor);
  if ("refusal" in decision) return { ok: false, refusal: decision.refusal };
  const detour = await applyDecision(tx, snapshot, decision.patch, decision.history, actor);
  return snapshot.conflicts ? { ok: true, detour, conflicts: snapshot.conflicts } : { ok: true, detour };
}

// For each requested Detour that exists: its conflicts, the acts a person
// could take now (and why not), and the next step. Unknown or deleted ids
// are absent from the map.
export async function readDetourWorkflows(pool: sql.ConnectionPool, ids: string[]): Promise<Map<string, DetourWorkflowView>> {
  const snapshots = await loadSnapshots(pool, ids);
  return new Map(snapshots.map((snapshot) => [snapshot.id, {
    id: snapshot.id,
    lifecycle_state: snapshot.lifecycle_state,
    fulfillment_mode: snapshot.fulfillment_mode,
    re_review_outstanding: snapshot.review_status === "needs_review",
    conflicts: snapshot.conflicts ?? [],
    conflict_status: currentConflictStatus(snapshot),
    acts: offeredActs(snapshot),
    next_step: nextStep(snapshot),
  }]));
}
