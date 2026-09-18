// Effective Access: what the signed-in person may do, resolved on the server
// for every request (ADR-0032).
//
// Entra still says who may sign in and the token still identifies them; it no
// longer says what they may do. Roles live in `AccessRoles` and are granted to
// people in `AccessRoleGrants`, so a revocation takes effect within one cache
// window instead of waiting for the next token refresh, and a new role is a
// migration rather than a manual app-role registration.
//
// The cutover (increment 6) is done: the `roles` claim in the token no longer
// grants a person anything. Only `System.Ingestion` is still read from a token,
// because a workload identity has no person record to grant anything to.
//
// A consequence worth stating plainly: until migrations 129-131 are applied and
// people have been granted their roles, nobody holds anything. Applying the
// migrations and running the one-time import is part of deploying this.
import { getPool, sql } from "../db";
import type { CallerPrincipal } from "../auth";
import { accessSummaryLines, allActionKeysExceptAccess, isKnownAction } from "./catalog";
import { INGESTION_APP_ROLE } from "./seeds";
import type { AccessRole, EffectiveAccess, HeldRole } from "./types";

export * from "./catalog";
export * from "./seeds";
export * from "./types";

type Executor = sql.ConnectionPool | sql.Transaction;
const request = (executor: Executor) =>
  executor instanceof sql.Transaction ? new sql.Request(executor) : executor.request();

/**
 * A single worker serves many requests, so the resolved answer is held briefly
 * rather than queried per call. Thirty seconds is the delay between revoking
 * access and it taking hold - the Entra token it replaces took up to an hour.
 */
export const ACCESS_CACHE_TTL_MS = 30_000;

interface CacheEntry {
  at: number;
  value: EffectiveAccess;
}

const cache = new Map<string, CacheEntry>();

export function clearAccessCache(): void {
  cache.clear();
}

let testExecutor: Executor | null = null;

/**
 * Tests only. Since the cutover a token grants nobody anything, so a test that
 * exercises a handler has to say what the caller holds the way production does
 * - as rows. This points the resolver at a stand-in for those rows (see
 * testSupport.ts) instead of at the pool. Production never calls it.
 */
export function useAccessExecutorForTests(executor: Executor | null): void {
  testExecutor = executor;
  cache.clear();
}

function cacheKey(principal: CallerPrincipal): string {
  return `${principal.userId ?? ""}|${principal.claims.tid?.[0] ?? ""}|${[...principal.roles].sort().join(",")}`;
}

interface RoleRow {
  role_key: string;
  name: string;
  purpose: string | null;
  is_locked: boolean;
  all_actions: boolean;
}

interface RoleActionRow {
  role_key: string;
  action_key: string;
}

interface GrantRow {
  role_key: string;
  scope: string | null;
  expires_at: Date | null;
}

async function tablesReady(executor: Executor): Promise<boolean> {
  const row = await request(executor).query<{ ready: number }>(`
    SELECT CASE WHEN OBJECT_ID('dbo.AccessRoles','U') IS NULL
      OR OBJECT_ID('dbo.AccessRoleActions','U') IS NULL
      OR OBJECT_ID('dbo.AccessRoleGrants','U') IS NULL
      OR OBJECT_ID('dbo.AccessPeople','U') IS NULL THEN 0 ELSE 1 END AS ready
  `);
  return row.recordset[0]?.ready === 1;
}

export async function loadRoles(executor: Executor): Promise<AccessRole[]> {
  const roles = await request(executor).query<RoleRow>(`
    SELECT role_key, name, purpose, is_locked, all_actions
    FROM AccessRoles WHERE archived_at IS NULL ORDER BY name
  `);
  const actions = await request(executor).query<RoleActionRow>(`
    SELECT role_key, action_key FROM AccessRoleActions
  `);
  const byRole = new Map<string, string[]>();
  for (const row of actions.recordset) {
    const list = byRole.get(row.role_key);
    if (list) list.push(row.action_key);
    else byRole.set(row.role_key, [row.action_key]);
  }
  return roles.recordset.map((row) => ({
    key: row.role_key,
    name: row.name,
    purpose: row.purpose ?? "",
    locked: !!row.is_locked,
    allActions: !!row.all_actions,
    // An action the catalog has since dropped is ignored rather than served.
    actions: (byRole.get(row.role_key) ?? []).filter(isKnownAction).sort(),
  }));
}

async function loadGrants(executor: Executor, objectId: string, tenantId: string | null): Promise<GrantRow[]> {
  const result = await request(executor)
    .input("oid", sql.NVarChar(64), objectId)
    .input("tid", sql.NVarChar(64), tenantId)
    .query<GrantRow>(`
      SELECT g.role_key, g.scope, g.expires_at
      FROM AccessRoleGrants g
      JOIN AccessPeople p ON p.person_id = g.person_id
      WHERE p.entra_object_id = @oid
        AND (@tid IS NULL OR p.entra_tenant_id IS NULL OR p.entra_tenant_id = @tid)
        AND p.status = 'active'
        AND g.revoked_at IS NULL
        AND (g.expires_at IS NULL OR g.expires_at > SYSUTCDATETIME())
    `);
  return result.recordset;
}

function actionsOf(role: AccessRole): string[] {
  return role.allActions ? allActionKeysExceptAccess() : role.actions;
}

function assemble(
  principal: CallerPrincipal,
  held: { role: AccessRole; source: HeldRole["source"]; scope: string | null; expiresAt: Date | null }[],
  rolesInOnBoard: boolean,
): EffectiveAccess {
  const actions = new Set<string>();
  for (const entry of held) {
    for (const action of actionsOf(entry.role)) actions.add(action);
  }
  const sorted = [...actions].sort();
  return {
    person: {
      objectId: principal.userId ?? null,
      tenantId: principal.claims.tid?.[0] ?? null,
      name: principal.claims.name?.[0] ?? principal.userDetails ?? null,
      email: principal.userDetails ?? principal.claims.preferred_username?.[0] ?? null,
    },
    roles: held
      .map((entry) => ({
        key: entry.role.key,
        name: entry.role.name,
        purpose: entry.role.purpose,
        locked: entry.role.locked,
        source: entry.source,
        scope: entry.scope,
        expiresAt: entry.expiresAt ? entry.expiresAt.toISOString() : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    actions: sorted,
    summary: accessSummaryLines(sorted),
    ingestion: false,
    rolesInOnBoard,
  };
}

function ingestionAccess(principal: CallerPrincipal, rolesInOnBoard: boolean): EffectiveAccess {
  const empty = assemble(principal, [], rolesInOnBoard);
  return { ...empty, ingestion: true };
}

/**
 * The caller's Effective Access. A caller with no principal, or one holding
 * `System.Ingestion`, gets no human actions: a workload identity never inherits
 * a person's authority, which is the rule requireRole enforced before.
 */
export async function resolveEffectiveAccess(
  principal: CallerPrincipal,
  options: { executor?: Executor; useCache?: boolean } = {},
): Promise<EffectiveAccess> {
  const useCache = options.useCache !== false && !options.executor;
  const key = cacheKey(principal);
  if (useCache) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ACCESS_CACHE_TTL_MS) return hit.value;
  }
  const value = await resolve(principal, options.executor);
  if (useCache) cache.set(key, { at: Date.now(), value });
  return value;
}

async function resolve(principal: CallerPrincipal, given?: Executor): Promise<EffectiveAccess> {
  if (principal.roles.includes(INGESTION_APP_ROLE)) {
    return ingestionAccess(principal, false);
  }

  let executor: Executor | null = given ?? testExecutor ?? null;
  let ready = false;
  if (!executor) {
    try {
      executor = await getPool();
    } catch {
      // The database being unreachable must not hand out access it cannot
      // confirm; the token's own app roles are all that remain.
      executor = null;
    }
  }
  if (executor) {
    ready = await tablesReady(executor);
  }

  // Without the tables there is nothing to read: an unmigrated environment
  // grants nobody anything rather than falling back to the token, which is the
  // safe direction and says so loudly on the No access page.
  const roles: AccessRole[] = ready && executor ? await loadRoles(executor) : [];
  const byKey = new Map(roles.map((r) => [r.key, r]));

  const held: { role: AccessRole; source: HeldRole["source"]; scope: string | null; expiresAt: Date | null }[] = [];
  const seen = new Set<string>();

  if (ready && executor && principal.userId) {
    for (const grant of await loadGrants(executor, principal.userId, principal.claims.tid?.[0] ?? null)) {
      const role = byKey.get(grant.role_key);
      if (!role || seen.has(role.key)) continue;
      seen.add(role.key);
      held.push({ role, source: "onboard", scope: grant.scope, expiresAt: grant.expires_at });
    }
  }

  return assemble(principal, held, ready);
}

/** The check increment 2 puts in front of every handler. */
export async function holdsAction(
  principal: CallerPrincipal,
  action: string,
  options: { executor?: Executor } = {},
): Promise<boolean> {
  const access = await resolveEffectiveAccess(principal, options);
  return access.actions.includes(action);
}
