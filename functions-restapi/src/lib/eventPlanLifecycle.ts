import { sql } from "./db";
import { validateEventPlanReadiness, type EventPlanReadiness } from "./eventPlanValidation";

// Moving an Event Plan through its lifecycle, in one transaction.
//
// The defect this module exists to hold shut: activation captured the scope
// snapshot - and wrote the reasoned conflict override - on the POOL, before an
// UPDATE guarded by `WHERE status='approved'`. When that guard matched nothing,
// which a concurrent transition or a double submit will do, the caller got a
// 409 while a snapshot and an override row had already been written for a plan
// that never activated. Event AVL and crossing detection read published
// snapshots, so that is exactly the partially-published scope that activation
// is specified to make impossible.
//
// So the order here is load-bearing, not incidental:
//   1. lock the plan's own row and read its status
//   2. refuse anything the status does not allow - nothing written yet
//   3. validate readiness, inside the transaction, against that locked row
//   4. only then write the override and the snapshot
//   5. change the status, still guarded, and commit
// Anything that refuses rolls back, so a refusal writes nothing at all.

export const PLAN_TRANSITIONS: Record<string, { from: string; to: string }> = {
  "submit-review": { from: "draft", to: "review" },
  approve: { from: "review", to: "approved" },
  advance: { from: "approved", to: "active" },
  complete: { from: "active", to: "completed" },
  suspend: { from: "active", to: "suspended" },
};

/** Whether this act needs readiness - and may therefore carry an override. */
export function gatesOnReadiness(action: string): boolean {
  return action === "approve" || action === "advance";
}

/** Whether this act publishes a scope snapshot. Only activation does. */
export function publishesSnapshot(action: string): boolean {
  return action === "advance";
}

/**
 * What a transaction has to offer for a lifecycle move. `sql.Transaction`
 * satisfies it; so does a fake that records the order statements were issued
 * in, which is the property the snapshot bug was about.
 */
export interface PlanTransaction {
  request(): sql.Request;
  commit(): Promise<unknown>;
  rollback(): Promise<unknown>;
}

export type PlanTransitionResult =
  | { status: 200; body: Record<string, unknown> }
  | { status: 404 | 409; body: { error: string } };

export interface PlanTransitionDeps {
  readReadiness: (tx: PlanTransaction, planId: string) => Promise<EventPlanReadiness>;
  captureSnapshot: (tx: PlanTransaction, planId: string, actor: string) => Promise<unknown>;
}

export async function transitionEventPlan(
  tx: PlanTransaction,
  input: { planId: string; action: string; actor: string; conflictOverrideReason: string | null },
  deps: PlanTransitionDeps,
): Promise<PlanTransitionResult> {
  const transition = Object.hasOwn(PLAN_TRANSITIONS, input.action) ? PLAN_TRANSITIONS[input.action] : null;
  if (!transition) { await tx.rollback(); return { status: 409, body: { error: "Unknown lifecycle action" } }; }

  const current = (await tx.request().input("id", sql.UniqueIdentifier, input.planId)
    .query<{ status: string }>("SELECT status FROM EventServicePlans WITH (UPDLOCK,HOLDLOCK) WHERE id=@id")).recordset[0];
  if (!current) { await tx.rollback(); return { status: 404, body: { error: "Service plan not found" } }; }
  if (current.status !== transition.from) {
    await tx.rollback();
    return { status: 409, body: { error: `Plan must be ${transition.from} before it can be ${transition.to}` } };
  }

  if (gatesOnReadiness(input.action)) {
    const readiness = await deps.readReadiness(tx, input.planId);
    const validation = validateEventPlanReadiness(readiness, input.conflictOverrideReason);
    if (!validation.valid) { await tx.rollback(); return { status: 409, body: { error: validation.error } }; }
    if (readiness.routeConflict && input.conflictOverrideReason) {
      await tx.request()
        .input("plan", sql.UniqueIdentifier, input.planId)
        .input("type", sql.NVarChar, "route_overlap")
        .input("key", sql.NVarChar, "active-route-overlap")
        .input("reason", sql.NVarChar(1000), input.conflictOverrideReason)
        .input("by", sql.NVarChar, input.actor)
        .query("INSERT INTO EventServicePlanConflictOverrides(service_plan_id,conflict_type,conflict_key,reason,created_by) VALUES(@plan,@type,@key,@reason,@by)");
    }
  }

  if (publishesSnapshot(input.action)) await deps.captureSnapshot(tx, input.planId, input.actor);

  const updated = await tx.request()
    .input("id", sql.UniqueIdentifier, input.planId)
    .input("by", sql.NVarChar, input.actor)
    .query(`UPDATE EventServicePlans SET status='${transition.to}',updated_by=@by,updated_at=SYSUTCDATETIME() OUTPUT INSERTED.* WHERE id=@id AND status='${transition.from}'`);
  if (!updated.recordset.length) {
    // The row was locked above, so this should not happen - but if it ever
    // does, the snapshot already issued must not survive it.
    await tx.rollback();
    return { status: 409, body: { error: `Plan must be ${transition.from} before it can be ${transition.to}` } };
  }
  await tx.commit();
  return { status: 200, body: updated.recordset[0] as Record<string, unknown> };
}
