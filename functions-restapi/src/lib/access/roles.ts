// Editing Roles (ADR-0032, increment 4).
//
// A Role is a name, a purpose an Access Administrator writes, and a grid of
// Module Actions. Adding a role is a row here, not an Entra app-role
// registration; what it grants takes effect within one resolver cache window,
// not at the next token refresh.
//
// The rules this file keeps, all of them about not letting a page hand out
// authority nobody intended:
//   - a role grants only actions the catalog defines;
//   - a locked role cannot be edited, renamed, archived or deleted;
//   - no edit here may add an Access & Identity action, because that is a
//     Privileged Access Change and needs a second Access Administrator, which
//     is increment 5's approval path;
//   - `all_actions` is not editable at all: System Administrator holds it and
//     is locked;
//   - a role with people still holding it is not archived out from under them.
import { sql } from "../db";
import { accessSummaryLines, ACCESS_MODULE, allActionKeysExceptAccess, isKnownAction } from "./catalog";
import type { AccessRole } from "./types";

type Executor = sql.ConnectionPool | sql.Transaction;
const request = (executor: Executor) =>
  executor instanceof sql.Transaction ? new sql.Request(executor) : executor.request();

export interface RoleEditor {
  objectId: string | null;
  name: string | null;
}

export interface RoleView extends AccessRole {
  /** Generated from the grid, never stored (ADR-0032). */
  summary: string[];
  /** People holding it right now: not revoked, not expired, not suspended. */
  members: number;
  seeded: boolean;
  archived: boolean;
}

export class RoleRuleError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const MAX_NAME = 100;
const MAX_PURPOSE = 400;

/** `Weekend Dispatcher` becomes `weekend-dispatcher`. Stable for the role's life. */
export function roleKeyFrom(name: string): string {
  const key = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (!key) throw new RoleRuleError("A role name must contain a letter or a number.");
  return key;
}

export function validateRoleInput(input: { name?: unknown; purpose?: unknown; actions?: unknown }): {
  name?: string;
  purpose?: string;
  actions?: string[];
} {
  const out: { name?: string; purpose?: string; actions?: string[] } = {};
  if (input.name !== undefined) {
    if (typeof input.name !== "string" || !input.name.trim()) throw new RoleRuleError("A role needs a name.");
    if (input.name.trim().length > MAX_NAME) throw new RoleRuleError(`A role name is at most ${MAX_NAME} characters.`);
    out.name = input.name.trim();
  }
  if (input.purpose !== undefined) {
    if (typeof input.purpose !== "string") throw new RoleRuleError("A purpose must be text.");
    if (input.purpose.trim().length > MAX_PURPOSE) {
      throw new RoleRuleError(`A purpose is at most ${MAX_PURPOSE} characters.`);
    }
    out.purpose = input.purpose.trim();
  }
  if (input.actions !== undefined) {
    if (!Array.isArray(input.actions) || input.actions.some((a) => typeof a !== "string")) {
      throw new RoleRuleError("Actions must be a list of module actions.");
    }
    const actions = [...new Set(input.actions as string[])].sort();
    const unknown = actions.filter((a) => !isKnownAction(a));
    if (unknown.length) throw new RoleRuleError(`No such action: ${unknown.join(", ")}.`);
    out.actions = actions;
  }
  return out;
}

/**
 * Granting access management is a Privileged Access Change: it needs a second
 * Access Administrator, and that path arrives with grants in increment 5. Until
 * then this refuses rather than letting one person widen their own authority.
 */
export function refuseAccessIdentityWidening(before: string[], after: string[]): void {
  const held = new Set(before);
  const added = after.filter((action) => action.startsWith(`${ACCESS_MODULE}.`) && !held.has(action));
  if (added.length) {
    throw new RoleRuleError(
      "Adding an Access & Identity action to a role is a Privileged Access Change and needs a second Access Administrator, which OnBoard cannot record yet. Ask for the Access Administrator role instead.",
      409,
    );
  }
}

interface RoleRow {
  role_key: string;
  name: string;
  purpose: string | null;
  is_locked: boolean;
  all_actions: boolean;
  is_seeded: boolean;
  archived_at: Date | null;
  members: number;
}

/** Every role, archived ones included, with what each grants and who holds it. */
export async function listRoles(executor: Executor): Promise<RoleView[]> {
  const rows = await request(executor).query<RoleRow>(`
    SELECT r.role_key, r.name, r.purpose, r.is_locked, r.all_actions, r.is_seeded, r.archived_at,
      (SELECT COUNT(*)
         FROM AccessRoleGrants g
         JOIN AccessPeople p ON p.person_id = g.person_id
        WHERE g.role_key = r.role_key AND g.revoked_at IS NULL
          AND (g.expires_at IS NULL OR g.expires_at > SYSUTCDATETIME())
          AND p.status = 'active') AS members
    FROM AccessRoles r
    ORDER BY r.name
  `);
  const actions = await request(executor).query<{ role_key: string; action_key: string }>(
    `SELECT role_key, action_key FROM AccessRoleActions`,
  );
  const byRole = new Map<string, string[]>();
  for (const row of actions.recordset) {
    const list = byRole.get(row.role_key);
    if (list) list.push(row.action_key);
    else byRole.set(row.role_key, [row.action_key]);
  }
  return rows.recordset.map((row) => {
    const held = (byRole.get(row.role_key) ?? []).filter(isKnownAction).sort();
    return {
      key: row.role_key,
      name: row.name,
      purpose: row.purpose ?? "",
      locked: !!row.is_locked,
      allActions: !!row.all_actions,
      actions: held,
      // A wildcard role's summary is written from what it actually resolves to,
      // so the page never describes it as holding nothing.
      summary: accessSummaryLines(row.all_actions ? allActionKeysExceptAccess() : held),
      members: row.members,
      seeded: !!row.is_seeded,
      archived: !!row.archived_at,
    };
  });
}

async function roleOf(executor: Executor, roleKey: string): Promise<RoleView> {
  const role = (await listRoles(executor)).find((r) => r.key === roleKey);
  if (!role) throw new RoleRuleError("No such role.", 404);
  return role;
}

async function recordHistory(
  executor: Executor,
  roleKey: string,
  change: "created" | "updated" | "archived",
  editor: RoleEditor,
  before: unknown,
  after: unknown,
): Promise<void> {
  await request(executor)
    .input("roleKey", sql.NVarChar(64), roleKey)
    .input("change", sql.NVarChar(20), change)
    .input("actorId", sql.NVarChar(64), editor.objectId)
    .input("actorName", sql.NVarChar(320), editor.name)
    .input("before", sql.NVarChar(sql.MAX), before ? JSON.stringify(before) : null)
    .input("after", sql.NVarChar(sql.MAX), after ? JSON.stringify(after) : null)
    .query(`
      INSERT AccessRoleHistory (role_key, change, actor_object_id, actor_name, before_json, after_json)
      VALUES (@roleKey, @change, @actorId, @actorName, @before, @after)
    `);
}

const snapshot = (role: RoleView) => ({ name: role.name, purpose: role.purpose, actions: role.actions });

export async function createRole(
  executor: Executor,
  input: { name?: unknown; purpose?: unknown; actions?: unknown },
  editor: RoleEditor,
): Promise<RoleView> {
  const { name, purpose, actions } = validateRoleInput(input);
  if (!name) throw new RoleRuleError("A role needs a name.");
  const key = roleKeyFrom(name);
  refuseAccessIdentityWidening([], actions ?? []);

  const existing = await listRoles(executor);
  if (existing.some((r) => r.key === key || r.name.toLowerCase() === name.toLowerCase())) {
    throw new RoleRuleError("A role with that name already exists.", 409);
  }

  await request(executor)
    .input("key", sql.NVarChar(64), key)
    .input("name", sql.NVarChar(100), name)
    .input("purpose", sql.NVarChar(400), purpose ?? "")
    .input("by", sql.NVarChar(200), editor.name ?? editor.objectId)
    .query(`INSERT AccessRoles (role_key, name, purpose, created_by) VALUES (@key, @name, @purpose, @by)`);
  await writeActions(executor, key, actions ?? []);
  const role = await roleOf(executor, key);
  await recordHistory(executor, key, "created", editor, null, snapshot(role));
  return role;
}

export async function updateRole(
  executor: Executor,
  roleKey: string,
  input: { name?: unknown; purpose?: unknown; actions?: unknown },
  editor: RoleEditor,
): Promise<RoleView> {
  const before = await roleOf(executor, roleKey);
  if (before.locked) {
    throw new RoleRuleError(`${before.name} is a locked role: what it grants cannot be changed.`, 409);
  }
  const { name, purpose, actions } = validateRoleInput(input);
  if (actions) refuseAccessIdentityWidening(before.actions, actions);

  if (name && name.toLowerCase() !== before.name.toLowerCase()) {
    const taken = (await listRoles(executor)).some(
      (r) => r.key !== roleKey && r.name.toLowerCase() === name.toLowerCase(),
    );
    if (taken) throw new RoleRuleError("A role with that name already exists.", 409);
  }

  await request(executor)
    .input("key", sql.NVarChar(64), roleKey)
    .input("name", sql.NVarChar(100), name ?? before.name)
    .input("purpose", sql.NVarChar(400), purpose ?? before.purpose)
    .input("by", sql.NVarChar(200), editor.name ?? editor.objectId)
    .query(`
      UPDATE AccessRoles
         SET name = @name, purpose = @purpose, updated_at = SYSUTCDATETIME(), updated_by = @by
       WHERE role_key = @key
    `);
  if (actions) await writeActions(executor, roleKey, actions);

  const after = await roleOf(executor, roleKey);
  await recordHistory(executor, roleKey, "updated", editor, snapshot(before), snapshot(after));
  return after;
}

export async function archiveRole(executor: Executor, roleKey: string, editor: RoleEditor): Promise<RoleView> {
  const before = await roleOf(executor, roleKey);
  if (before.locked) throw new RoleRuleError(`${before.name} is a locked role and cannot be archived.`, 409);
  if (before.members > 0) {
    throw new RoleRuleError(
      `${before.name} is still held by ${before.members} ${before.members === 1 ? "person" : "people"}. Remove it from them first.`,
      409,
    );
  }
  await request(executor)
    .input("key", sql.NVarChar(64), roleKey)
    .input("by", sql.NVarChar(200), editor.name ?? editor.objectId)
    .query(`UPDATE AccessRoles SET archived_at = SYSUTCDATETIME(), archived_by = @by WHERE role_key = @key`);
  const after = await roleOf(executor, roleKey);
  await recordHistory(executor, roleKey, "archived", editor, snapshot(before), null);
  return after;
}

export async function restoreRole(executor: Executor, roleKey: string, editor: RoleEditor): Promise<RoleView> {
  const before = await roleOf(executor, roleKey);
  if (!before.archived) return before;
  await request(executor)
    .input("key", sql.NVarChar(64), roleKey)
    .input("by", sql.NVarChar(200), editor.name ?? editor.objectId)
    .query(`
      UPDATE AccessRoles
         SET archived_at = NULL, archived_by = NULL, updated_at = SYSUTCDATETIME(), updated_by = @by
       WHERE role_key = @key
    `);
  const after = await roleOf(executor, roleKey);
  await recordHistory(executor, roleKey, "updated", editor, snapshot(before), snapshot(after));
  return after;
}

async function writeActions(executor: Executor, roleKey: string, actions: string[]): Promise<void> {
  await request(executor)
    .input("key", sql.NVarChar(64), roleKey)
    .query(`DELETE FROM AccessRoleActions WHERE role_key = @key`);
  for (const action of actions) {
    await request(executor)
      .input("key", sql.NVarChar(64), roleKey)
      .input("action", sql.NVarChar(100), action)
      .query(`INSERT AccessRoleActions (role_key, action_key) VALUES (@key, @action)`);
  }
}

export interface RoleHistoryEntry {
  change: string;
  actorName: string | null;
  occurredAt: string;
  before: { name: string; purpose: string; actions: string[] } | null;
  after: { name: string; purpose: string; actions: string[] } | null;
}

export async function roleHistory(executor: Executor, roleKey: string): Promise<RoleHistoryEntry[]> {
  const result = await request(executor)
    .input("key", sql.NVarChar(64), roleKey)
    .query<{ change: string; actor_name: string | null; occurred_at: Date; before_json: string | null; after_json: string | null }>(`
      SELECT TOP 100 change, actor_name, occurred_at, before_json, after_json
      FROM AccessRoleHistory WHERE role_key = @key ORDER BY occurred_at DESC
    `);
  return result.recordset.map((row) => ({
    change: row.change,
    actorName: row.actor_name,
    occurredAt: row.occurred_at.toISOString(),
    before: row.before_json ? JSON.parse(row.before_json) : null,
    after: row.after_json ? JSON.parse(row.after_json) : null,
  }));
}

/** Present, so the Roles page never has to be taught the catalog a second time. */
export async function rolesAvailable(executor: Executor): Promise<boolean> {
  const row = await request(executor).query<{ ready: number }>(`
    SELECT CASE WHEN OBJECT_ID('dbo.AccessRoles','U') IS NULL
      OR OBJECT_ID('dbo.AccessRoleHistory','U') IS NULL THEN 0 ELSE 1 END AS ready
  `);
  return row.recordset[0]?.ready === 1;
}
