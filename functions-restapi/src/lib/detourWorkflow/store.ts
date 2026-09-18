// SQL for the Detour workflow module: load one Detour under a row lock, and
// write a decision's row change and history entry. Everything here runs on
// the caller's transaction.
import { sql } from "../db";
import { detourConflicts, loadDetourConflictContext, parseOverrideIds } from "../detourConflicts";
import { toDateOnly } from "../detourStatus";
import type { HistoryEntry, RowPatch, WorkflowSnapshot } from "./decide";
import type { Actor, DetourFulfillmentMode, DetourLifecycleState, DetourWorkflowState } from "./types";

interface SnapshotRow {
  id: string;
  lifecycle_state: string;
  fulfillment_mode: DetourFulfillmentMode;
  review_status: "current" | "needs_review";
  review_reason: string | null;
  closure: string;
  start_date: Date | string | null;
  end_date: Date | string | null;
  riders_directed: string | null;
  location: string | null;
  geometry_json: string | null;
  workflow_owner: string | null;
  conflict_override_reason: string | null;
  conflict_override_ids: string | null;
  history_count: number;
}

export function actorName(actor: Actor): string {
  return actor.kind === "person" ? actor.name : "avail-sync";
}

// UPDLOCK + HOLDLOCK: a second act on the same Detour waits here and is then
// decided against the state the first one committed.
export async function lockAndLoad(tx: sql.Transaction, id: string, withConflicts: boolean): Promise<WorkflowSnapshot | null> {
  const result = await new sql.Request(tx).input("id", sql.UniqueIdentifier, id).query<SnapshotRow>(`
    SELECT d.id, d.lifecycle_state, d.fulfillment_mode, d.review_status, d.review_reason,
           d.closure, d.start_date, d.end_date, d.riders_directed, d.location, d.geometry_json,
           d.workflow_owner, d.conflict_override_reason, d.conflict_override_ids,
           (SELECT COUNT(*) FROM DetourWorkflowHistory h WHERE h.detour_id = d.id) AS history_count
    FROM Detours d WITH (UPDLOCK, HOLDLOCK)
    WHERE d.id = @id AND d.is_deleted = 0;
    SELECT routes, directions FROM DetourSegments WHERE detour_id = @id ORDER BY sort_order;
  `);
  const sets = result.recordsets as unknown as [SnapshotRow[], { routes: string; directions: string | null }[]];
  const row = sets[0][0];
  if (!row) return null;
  let conflicts = null;
  if (withConflicts) {
    const context = await loadDetourConflictContext(tx);
    const subject = context.scopes.find((s) => s.id.toLowerCase() === row.id.toLowerCase());
    conflicts = subject ? detourConflicts(subject, context.scopes, context.stopName) : [];
  }
  return {
    id: row.id,
    lifecycle_state: row.lifecycle_state,
    fulfillment_mode: row.fulfillment_mode,
    review_status: row.review_status,
    review_reason: row.review_reason,
    workflow_owner: row.workflow_owner,
    history_count: row.history_count,
    facts: {
      closure: row.closure,
      start_date: toDateOnly(row.start_date),
      end_date: toDateOnly(row.end_date),
      riders_directed: row.riders_directed,
      location: row.location,
      geometry_json: row.geometry_json,
      segments: sets[1].map((s) => ({ routes: s.routes, directions: s.directions })),
    },
    override_reason: row.conflict_override_reason,
    override_ids: parseOverrideIds(row.conflict_override_ids),
    conflicts,
  };
}

export async function applyDecision(
  tx: sql.Transaction,
  snapshot: WorkflowSnapshot,
  patch: RowPatch,
  history: HistoryEntry,
  actor: Actor,
): Promise<DetourWorkflowState> {
  const request = new sql.Request(tx)
    .input("id", sql.UniqueIdentifier, snapshot.id)
    .input("actor", sql.NVarChar(200), actorName(actor));
  const sets: string[] = [];
  if (patch.lifecycle_state) {
    sets.push("lifecycle_state = @lifecycle_state");
    request.input("lifecycle_state", sql.NVarChar(30), patch.lifecycle_state);
  }
  if (patch.fulfillment_mode) {
    sets.push("fulfillment_mode = @fulfillment_mode");
    request.input("fulfillment_mode", sql.NVarChar(30), patch.fulfillment_mode);
  }
  if (patch.workflow) sets.push("workflow_updated_by = @actor", "workflow_updated_at = SYSUTCDATETIME()");
  if (patch.avail_build_confirmed === "now") sets.push("avail_build_confirmed_at = SYSUTCDATETIME()");
  if (patch.avail_build_confirmed === "clear") sets.push("avail_build_confirmed_at = NULL");
  if (patch.avail_entry) {
    sets.push(
      "avail_entry_result = @avail_entry_result",
      "avail_entry_confirmed_by = @actor",
      "avail_entry_confirmed_at = SYSUTCDATETIME()",
      "external_detour_id = COALESCE(@external_detour_id, external_detour_id)",
    );
    request.input("avail_entry_result", sql.NVarChar(20), patch.avail_entry.result);
    request.input("external_detour_id", sql.NVarChar(100), patch.avail_entry.external_detour_id);
  }
  if (patch.fulfillment_change_reason !== undefined) {
    sets.push("fulfillment_change_reason = @fulfillment_change_reason");
    request.input("fulfillment_change_reason", sql.NVarChar(1000), patch.fulfillment_change_reason);
  }
  if (patch.closure_reason !== undefined) {
    sets.push("closure_reason = @closure_reason", "closed_by = @actor", "closed_at = SYSUTCDATETIME()");
    request.input("closure_reason", sql.NVarChar(1000), patch.closure_reason);
  }
  if (patch.conflict_override) {
    sets.push(
      "conflict_override_reason = @conflict_override_reason",
      "conflict_override_by = @actor",
      "conflict_override_at = SYSUTCDATETIME()",
      "conflict_override_ids = @conflict_override_ids",
    );
    request.input("conflict_override_reason", sql.NVarChar(1000), patch.conflict_override.reason);
    request.input("conflict_override_ids", sql.NVarChar(sql.MAX), JSON.stringify(patch.conflict_override.ids));
  }
  if (patch.owner !== undefined) {
    sets.push("workflow_owner = @owner");
    request.input("owner", sql.NVarChar(200), patch.owner);
  }
  if (patch.review) {
    sets.push("review_status = @review_status", "review_reason = @review_reason");
    request.input("review_status", sql.NVarChar(20), patch.review.status);
    request.input("review_reason", sql.NVarChar(1000), patch.review.reason);
  }
  if (sets.length > 0) {
    sets.push("updated_by = @actor", "updated_at = SYSUTCDATETIME()");
    await request.query(`UPDATE Detours SET ${sets.join(", ")} WHERE id = @id`);
  }

  await new sql.Request(tx)
    .input("detour_id", sql.UniqueIdentifier, snapshot.id)
    .input("event_type", sql.NVarChar(30), history.event_type)
    .input("from_state", sql.NVarChar(30), history.from_state)
    .input("to_state", sql.NVarChar(30), history.to_state)
    .input("source", sql.NVarChar(20), actor.kind === "avail_sync" ? "avail" : "manual")
    .input("detail", sql.NVarChar(1000), history.detail)
    .input("changed_by", sql.NVarChar(200), actorName(actor))
    .query(`
      INSERT INTO DetourWorkflowHistory (detour_id, event_type, from_state, to_state, source, detail, changed_by)
      VALUES (@detour_id, @event_type, @from_state, @to_state, @source, @detail, @changed_by)
    `);

  return {
    id: snapshot.id,
    lifecycle_state: (patch.lifecycle_state ?? snapshot.lifecycle_state) as DetourLifecycleState,
    fulfillment_mode: patch.fulfillment_mode ?? snapshot.fulfillment_mode,
    review_status: patch.review?.status ?? snapshot.review_status,
  };
}

interface ViewRow {
  id: string;
  lifecycle_state: string;
  fulfillment_mode: DetourFulfillmentMode;
  review_status: "current" | "needs_review";
  review_reason: string | null;
  workflow_owner: string | null;
  conflict_override_reason: string | null;
  conflict_override_ids: string | null;
}

// Snapshots for the read side: no lock, no reviewed facts (nothing is being
// edited), conflicts always loaded.
export async function loadSnapshots(pool: sql.ConnectionPool, ids: string[]): Promise<WorkflowSnapshot[]> {
  const wanted = new Set(ids.map((id) => id.toLowerCase()));
  if (wanted.size === 0) return [];
  const rows = await pool.request().query<ViewRow>(`
    SELECT id, lifecycle_state, fulfillment_mode, review_status, review_reason, workflow_owner,
           conflict_override_reason, conflict_override_ids
    FROM Detours WHERE is_deleted = 0
  `);
  const context = await loadDetourConflictContext(pool);
  const scopeById = new Map(context.scopes.map((s) => [s.id.toLowerCase(), s]));
  return rows.recordset
    .filter((row) => wanted.has(row.id.toLowerCase()))
    .map((row) => {
      const subject = scopeById.get(row.id.toLowerCase());
      return {
        id: row.id,
        lifecycle_state: row.lifecycle_state,
        fulfillment_mode: row.fulfillment_mode,
        workflow_owner: row.workflow_owner,
        review_status: row.review_status,
        review_reason: row.review_reason,
        history_count: 1,
        facts: { closure: "", start_date: null, end_date: null, riders_directed: null, location: null, geometry_json: null, segments: [] },
        override_reason: row.conflict_override_reason,
        override_ids: parseOverrideIds(row.conflict_override_ids),
        conflicts: subject ? detourConflicts(subject, context.scopes, context.stopName) : [],
      };
    });
}
