// Granting and revoking OnBoard access (ADR-0032, increment 5).
//
// A grant names a person and a Role. Ordinary grants are written straight to
// AccessRoleGrants and take effect within one resolver cache window. A
// Privileged Access Change - a locked Role, or one holding an Access & Identity
// action - is written as a request instead, and waits for a second Access
// Administrator.
//
// The rules carried over from the Entra-era flow, because they were the right
// rules and only their storage changes: a requester never decides their own
// request; a decision needs a recent step-up; an approval goes stale after 24
// hours; and OnBoard never ends up with nobody who can manage access.
import { sql } from "../db";
import { ACCESS_MODULE, accessSummaryLines, actionKey, allActionKeysExceptAccess } from "./catalog";
import { listRoles, RoleRuleError, type RoleView } from "./roles";

type Executor = sql.ConnectionPool | sql.Transaction;
const request = (executor: Executor) =>
  executor instanceof sql.Transaction ? new sql.Request(executor) : executor.request();

export const APPROVAL_WINDOW_HOURS = 24;

export interface Actor {
  objectId: string | null;
  name: string | null;
  /** The caller met the privileged authentication context on this request. */
  steppedUp: boolean;
}

export interface HeldGrant {
  grantId: string;
  roleKey: string;
  roleName: string;
  grantedAt: string;
  grantedBy: string | null;
  approvedBy: string | null;
  expiresAt: string | null;
}

export interface PersonAccess {
  personId: string;
  objectId: string;
  tenantId: string | null;
  name: string | null;
  email: string | null;
  kind: "member" | "guest";
  status: string;
  sponsorName: string | null;
  organization: string | null;
  justification: string | null;
  importedFrom: string | null;
  lastSeenAt: string | null;
  roles: HeldGrant[];
  actions: string[];
  summary: string[];
}

export interface GrantRequest {
  requestId: string;
  personId: string;
  personName: string | null;
  personEmail: string | null;
  roleKey: string;
  roleName: string;
  action: "grant" | "revoke";
  reason: string;
  expiresAt: string | null;
  status: string;
  requestedByObjectId: string | null;
  requestedByName: string | null;
  requestedAt: string;
  approvalExpiresAt: string;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
}

export type GrantOutcome =
  | { disposition: "applied"; grantId: string }
  | { disposition: "already_held" }
  | { disposition: "pending_approval"; requestId: string };

/**
 * A Privileged Access Change: a locked Role, or any Role that can manage
 * access. Granting either one hands over the ability to hand out access, so it
 * is the case a second person exists for.
 */
export function isPrivilegedRole(role: RoleView): boolean {
  return role.locked || role.actions.some((action) => action.startsWith(`${ACCESS_MODULE}.`));
}

function requireStepUp(actor: Actor): void {
  if (!actor.steppedUp) {
    throw new RoleRuleError(
      "This change needs a recent sign-in confirmation. Sign in again and retry.",
      401,
    );
  }
}

interface PersonRow {
  person_id: string;
  entra_object_id: string;
  entra_tenant_id: string | null;
  display_name: string | null;
  email: string | null;
  kind: string;
  status: string;
  sponsor_name: string | null;
  organization: string | null;
  justification: string | null;
  imported_from: string | null;
  last_seen_at: Date | null;
}

interface GrantRow {
  grant_id: string;
  person_id: string;
  role_key: string;
  granted_at: Date;
  granted_by: string | null;
  approved_by: string | null;
  expires_at: Date | null;
}

/** Everyone OnBoard knows, with what each of them currently holds. */
export async function listPeople(executor: Executor): Promise<PersonAccess[]> {
  const people = await request(executor).query<PersonRow>(`
    SELECT person_id, entra_object_id, entra_tenant_id, display_name, email, kind, status,
           sponsor_name, organization, justification, imported_from, last_seen_at
    FROM AccessPeople ORDER BY display_name, email, entra_object_id
  `);
  const grants = await request(executor).query<GrantRow>(`
    SELECT grant_id, person_id, role_key, granted_at, granted_by, approved_by, expires_at
    FROM AccessRoleGrants
    WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > SYSUTCDATETIME())
  `);
  const roles = new Map((await listRoles(executor)).map((role) => [role.key, role]));

  return people.recordset.map((row) => {
    const held = grants.recordset
      .filter((grant) => grant.person_id === row.person_id)
      .map((grant) => ({
        grant,
        role: roles.get(grant.role_key),
      }))
      // A grant of an archived role is kept as a row but grants nothing, the
      // same rule the resolver applies, so the page cannot imply otherwise.
      .filter((entry) => entry.role && !entry.role.archived);
    const actions = [
      ...new Set(held.flatMap((entry) => (entry.role!.allActions ? allActionKeysExceptAccess() : entry.role!.actions))),
    ].sort();
    return {
      personId: row.person_id,
      objectId: row.entra_object_id,
      tenantId: row.entra_tenant_id,
      name: row.display_name,
      email: row.email,
      kind: row.kind === "guest" ? "guest" : "member",
      status: row.status,
      sponsorName: row.sponsor_name,
      organization: row.organization,
      justification: row.justification,
      importedFrom: row.imported_from,
      lastSeenAt: row.last_seen_at ? row.last_seen_at.toISOString() : null,
      roles: held.map((entry) => ({
        grantId: entry.grant.grant_id,
        roleKey: entry.grant.role_key,
        roleName: entry.role!.name,
        grantedAt: entry.grant.granted_at.toISOString(),
        grantedBy: entry.grant.granted_by,
        approvedBy: entry.grant.approved_by,
        expiresAt: entry.grant.expires_at ? entry.grant.expires_at.toISOString() : null,
      })),
      actions,
      summary: accessSummaryLines(actions),
    };
  });
}

/**
 * Records who signed in. The People page can only offer somebody a role once
 * OnBoard has seen them, and this is where it sees them - GET /me/access calls
 * it, so signing in once is the whole of "ask an administrator for access".
 */
export async function recordSignIn(
  executor: Executor,
  person: { objectId: string; tenantId: string | null; name: string | null; email: string | null },
): Promise<void> {
  await request(executor)
    .input("oid", sql.NVarChar(64), person.objectId)
    .input("tid", sql.NVarChar(64), person.tenantId)
    .input("name", sql.NVarChar(200), person.name)
    .input("email", sql.NVarChar(320), person.email)
    .query(`
      UPDATE AccessPeople
         SET last_seen_at = SYSUTCDATETIME(),
             entra_tenant_id = COALESCE(entra_tenant_id, @tid),
             display_name = COALESCE(@name, display_name),
             email = COALESCE(@email, email)
       WHERE entra_object_id = @oid;
      IF @@ROWCOUNT = 0
        INSERT AccessPeople (entra_object_id, entra_tenant_id, display_name, email, created_by, last_seen_at)
        VALUES (@oid, @tid, @name, @email, 'sign-in', SYSUTCDATETIME());
    `);
}

async function personRow(executor: Executor, personId: string): Promise<PersonRow> {
  const result = await request(executor)
    .input("id", sql.UniqueIdentifier, personId)
    .query<PersonRow>(`
      SELECT person_id, entra_object_id, entra_tenant_id, display_name, email, kind, status,
             sponsor_name, organization, justification, imported_from, last_seen_at
      FROM AccessPeople WHERE person_id = @id
    `);
  const row = result.recordset[0];
  if (!row) throw new RoleRuleError("No such person.", 404);
  return row;
}

async function roleOrFail(executor: Executor, roleKey: string): Promise<RoleView> {
  const role = (await listRoles(executor)).find((r) => r.key === roleKey);
  if (!role) throw new RoleRuleError("No such role.", 404);
  if (role.archived) throw new RoleRuleError(`${role.name} is archived and cannot be granted.`, 409);
  return role;
}

/**
 * The invariant the old flow called "recoverable administrator": at least one
 * active person must still be able to manage access after this change, or
 * nobody can grant anything again without a break-glass path through Entra.
 */
async function refuseLastAccessAdministrator(
  executor: Executor,
  losing: { personId: string; roleKey: string },
): Promise<void> {
  const roles = await listRoles(executor);
  const managing = new Set(
    roles
      .filter((role) => !role.archived && role.actions.includes(actionKey(ACCESS_MODULE, "manage")))
      .map((role) => role.key),
  );
  if (!managing.has(losing.roleKey)) return;
  const people = await listPeople(executor);
  const remaining = people.filter(
    (person) =>
      person.status === "active" &&
      person.roles.some(
        (held) => managing.has(held.roleKey) && !(person.personId === losing.personId && held.roleKey === losing.roleKey),
      ),
  );
  if (remaining.length === 0) {
    throw new RoleRuleError(
      "This would leave nobody able to manage OnBoard access. Grant somebody else an access-managing role first.",
      409,
    );
  }
}

export async function grantRole(
  executor: Executor,
  input: { personId: string; roleKey: string; reason?: string; expiresAt?: string | null },
  actor: Actor,
): Promise<GrantOutcome> {
  const person = await personRow(executor, input.personId);
  const role = await roleOrFail(executor, input.roleKey);
  const reason = (input.reason ?? "").trim();
  if (!reason) throw new RoleRuleError("Say why this access is needed.");
  const expiresAt = parseExpiry(input.expiresAt);

  const people = await listPeople(executor);
  const already = people.find((p) => p.personId === person.person_id)?.roles.some((r) => r.roleKey === role.key);
  if (already) return { disposition: "already_held" };

  if (isPrivilegedRole(role)) {
    requireStepUp(actor);
    const requestId = await openRequest(executor, {
      personId: person.person_id,
      roleKey: role.key,
      action: "grant",
      reason,
      expiresAt,
      actor,
    });
    return { disposition: "pending_approval", requestId };
  }

  const grantId = await writeGrant(executor, person.person_id, role.key, {
    grantedBy: actor.name ?? actor.objectId,
    approvedBy: null,
    expiresAt,
  });
  return { disposition: "applied", grantId };
}

export async function revokeGrant(
  executor: Executor,
  input: { grantId: string; reason?: string },
  actor: Actor,
): Promise<GrantOutcome> {
  const found = await request(executor)
    .input("id", sql.UniqueIdentifier, input.grantId)
    .query<{ person_id: string; role_key: string }>(`
      SELECT person_id, role_key FROM AccessRoleGrants WHERE grant_id = @id AND revoked_at IS NULL
    `);
  const grant = found.recordset[0];
  if (!grant) throw new RoleRuleError("That access has already been removed.", 404);
  const reason = (input.reason ?? "").trim();
  if (!reason) throw new RoleRuleError("Say why this access is being removed.");

  const role = (await listRoles(executor)).find((r) => r.key === grant.role_key);
  await refuseLastAccessAdministrator(executor, { personId: grant.person_id, roleKey: grant.role_key });

  if (role && isPrivilegedRole(role)) {
    requireStepUp(actor);
    const requestId = await openRequest(executor, {
      personId: grant.person_id,
      roleKey: grant.role_key,
      action: "revoke",
      reason,
      expiresAt: null,
      actor,
    });
    return { disposition: "pending_approval", requestId };
  }

  await applyRevoke(executor, input.grantId, reason, actor);
  return { disposition: "applied", grantId: input.grantId };
}

function parseExpiry(value: string | null | undefined): Date | null {
  if (!value) return null;
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) throw new RoleRuleError("That expiry date could not be read.");
  if (when.getTime() <= Date.now()) throw new RoleRuleError("An expiry date has to be in the future.");
  return when;
}

async function writeGrant(
  executor: Executor,
  personId: string,
  roleKey: string,
  meta: { grantedBy: string | null; approvedBy: string | null; expiresAt: Date | null },
): Promise<string> {
  const result = await request(executor)
    .input("person", sql.UniqueIdentifier, personId)
    .input("role", sql.NVarChar(64), roleKey)
    .input("by", sql.NVarChar(200), meta.grantedBy)
    .input("approvedBy", sql.NVarChar(200), meta.approvedBy)
    .input("expires", sql.DateTime2, meta.expiresAt)
    .query<{ grant_id: string }>(`
      INSERT AccessRoleGrants (person_id, role_key, granted_by, approved_by, expires_at)
      OUTPUT inserted.grant_id
      VALUES (@person, @role, @by, @approvedBy, @expires)
    `);
  return result.recordset[0].grant_id;
}

async function applyRevoke(executor: Executor, grantId: string, reason: string, actor: Actor): Promise<void> {
  await request(executor)
    .input("id", sql.UniqueIdentifier, grantId)
    .input("by", sql.NVarChar(200), actor.name ?? actor.objectId)
    .input("reason", sql.NVarChar(400), reason)
    .query(`
      UPDATE AccessRoleGrants
         SET revoked_at = SYSUTCDATETIME(), revoked_by = @by, revoke_reason = @reason
       WHERE grant_id = @id AND revoked_at IS NULL
    `);
}

async function openRequest(
  executor: Executor,
  input: {
    personId: string;
    roleKey: string;
    action: "grant" | "revoke";
    reason: string;
    expiresAt: Date | null;
    actor: Actor;
  },
): Promise<string> {
  const pending = await request(executor)
    .input("person", sql.UniqueIdentifier, input.personId)
    .input("role", sql.NVarChar(64), input.roleKey)
    .input("action", sql.NVarChar(20), input.action)
    .query<{ request_id: string }>(`
      SELECT request_id FROM AccessGrantRequests
      WHERE person_id = @person AND role_key = @role AND action = @action AND status = 'pending'
    `);
  if (pending.recordset[0]) return pending.recordset[0].request_id;

  const result = await request(executor)
    .input("person", sql.UniqueIdentifier, input.personId)
    .input("role", sql.NVarChar(64), input.roleKey)
    .input("action", sql.NVarChar(20), input.action)
    .input("reason", sql.NVarChar(1000), input.reason)
    .input("expires", sql.DateTime2, input.expiresAt)
    .input("byId", sql.NVarChar(64), input.actor.objectId)
    .input("byName", sql.NVarChar(320), input.actor.name)
    .input("hours", sql.Int, APPROVAL_WINDOW_HOURS)
    .query<{ request_id: string }>(`
      INSERT AccessGrantRequests (person_id, role_key, action, reason, expires_at,
        requested_by_object_id, requested_by_name, approval_expires_at)
      OUTPUT inserted.request_id
      VALUES (@person, @role, @action, @reason, @expires, @byId, @byName,
        DATEADD(hour, @hours, SYSUTCDATETIME()))
    `);
  return result.recordset[0].request_id;
}

export async function listRequests(executor: Executor): Promise<GrantRequest[]> {
  const result = await request(executor).query<{
    request_id: string; person_id: string; display_name: string | null; email: string | null;
    role_key: string; name: string; action: string; reason: string; expires_at: Date | null;
    status: string; requested_by_object_id: string | null; requested_by_name: string | null;
    requested_at: Date; approval_expires_at: Date; decided_by_name: string | null;
    decided_at: Date | null; decision_reason: string | null;
  }>(`
    SELECT TOP 200 r.request_id, r.person_id, p.display_name, p.email, r.role_key, ro.name,
      r.action, r.reason, r.expires_at, r.status, r.requested_by_object_id, r.requested_by_name,
      r.requested_at, r.approval_expires_at, r.decided_by_name, r.decided_at, r.decision_reason
    FROM AccessGrantRequests r
    JOIN AccessPeople p ON p.person_id = r.person_id
    JOIN AccessRoles ro ON ro.role_key = r.role_key
    ORDER BY CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END, r.requested_at DESC
  `);
  return result.recordset.map((row) => ({
    requestId: row.request_id,
    personId: row.person_id,
    personName: row.display_name,
    personEmail: row.email,
    roleKey: row.role_key,
    roleName: row.name,
    action: row.action === "revoke" ? "revoke" : "grant",
    reason: row.reason,
    expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
    // A pending request past its window is reported as expired without waiting
    // for somebody to try to decide it.
    status: row.status === "pending" && row.approval_expires_at.getTime() < Date.now() ? "expired" : row.status,
    requestedByObjectId: row.requested_by_object_id,
    requestedByName: row.requested_by_name,
    requestedAt: row.requested_at.toISOString(),
    approvalExpiresAt: row.approval_expires_at.toISOString(),
    decidedByName: row.decided_by_name,
    decidedAt: row.decided_at ? row.decided_at.toISOString() : null,
    decisionReason: row.decision_reason,
  }));
}

export async function decideRequest(
  executor: Executor,
  input: { requestId: string; approve: boolean; reason?: string },
  actor: Actor,
): Promise<{ status: string; grantId?: string }> {
  requireStepUp(actor);
  const found = await request(executor)
    .input("id", sql.UniqueIdentifier, input.requestId)
    .query<{
      person_id: string; role_key: string; action: string; status: string;
      requested_by_object_id: string | null; approval_expires_at: Date; expires_at: Date | null;
    }>(`
      SELECT person_id, role_key, action, status, requested_by_object_id, approval_expires_at, expires_at
      FROM AccessGrantRequests WHERE request_id = @id
    `);
  const req = found.recordset[0];
  if (!req) throw new RoleRuleError("No such request.", 404);
  if (req.status !== "pending") throw new RoleRuleError(`That request is already ${req.status}.`, 409);
  if (req.requested_by_object_id && actor.objectId && req.requested_by_object_id === actor.objectId) {
    throw new RoleRuleError("A Privileged Access Change is decided by a second Access Administrator.", 403);
  }
  if (req.approval_expires_at.getTime() < Date.now()) {
    await setRequestStatus(executor, input.requestId, "expired", actor, "The approval window passed.");
    throw new RoleRuleError("That request is older than the approval window and can no longer be decided.", 410);
  }

  if (!input.approve) {
    await setRequestStatus(executor, input.requestId, "rejected", actor, input.reason ?? null);
    return { status: "rejected" };
  }

  if (req.action === "grant") {
    const grantId = await writeGrant(executor, req.person_id, req.role_key, {
      grantedBy: null,
      approvedBy: actor.name ?? actor.objectId,
      expiresAt: req.expires_at,
    });
    await setRequestStatus(executor, input.requestId, "approved", actor, input.reason ?? null, grantId);
    return { status: "approved", grantId };
  }

  await refuseLastAccessAdministrator(executor, { personId: req.person_id, roleKey: req.role_key });
  const live = await request(executor)
    .input("person", sql.UniqueIdentifier, req.person_id)
    .input("role", sql.NVarChar(64), req.role_key)
    .query<{ grant_id: string }>(`
      SELECT grant_id FROM AccessRoleGrants
      WHERE person_id = @person AND role_key = @role AND revoked_at IS NULL
    `);
  for (const row of live.recordset) {
    await applyRevoke(executor, row.grant_id, input.reason ?? "Approved removal.", actor);
  }
  await setRequestStatus(executor, input.requestId, "approved", actor, input.reason ?? null);
  return { status: "approved" };
}

export async function cancelRequest(
  executor: Executor,
  input: { requestId: string; reason?: string },
  actor: Actor,
): Promise<{ status: string }> {
  const found = await request(executor)
    .input("id", sql.UniqueIdentifier, input.requestId)
    .query<{ status: string; requested_by_object_id: string | null }>(`
      SELECT status, requested_by_object_id FROM AccessGrantRequests WHERE request_id = @id
    `);
  const req = found.recordset[0];
  if (!req) throw new RoleRuleError("No such request.", 404);
  if (req.status !== "pending") throw new RoleRuleError(`That request is already ${req.status}.`, 409);
  await setRequestStatus(executor, input.requestId, "cancelled", actor, input.reason ?? null);
  return { status: "cancelled" };
}

async function setRequestStatus(
  executor: Executor,
  requestId: string,
  status: string,
  actor: Actor,
  reason: string | null,
  grantId?: string,
): Promise<void> {
  await request(executor)
    .input("id", sql.UniqueIdentifier, requestId)
    .input("status", sql.NVarChar(20), status)
    .input("byId", sql.NVarChar(64), actor.objectId)
    .input("byName", sql.NVarChar(320), actor.name)
    .input("reason", sql.NVarChar(1000), reason)
    .input("grant", sql.UniqueIdentifier, grantId ?? null)
    .query(`
      UPDATE AccessGrantRequests
         SET status = @status, decided_by_object_id = @byId, decided_by_name = @byName,
             decided_at = SYSUTCDATETIME(), decision_reason = @reason,
             applied_grant_id = COALESCE(@grant, applied_grant_id)
       WHERE request_id = @id
    `);
}

export interface ImportedAssignment {
  objectId: string;
  tenantId: string | null;
  name: string | null;
  email: string | null;
  /** The OnBoard role key the Entra app role maps to. */
  roleKey: string;
  /** "app role" or the group that carried it, for the record. */
  via: string;
}

export interface ImportOutcome {
  people: number;
  granted: number;
  skipped: number;
  unknownRoles: string[];
}

/**
 * The one-time import: today's Entra assignments become OnBoard grants, so
 * nobody has to be granted twice. Idempotent - a second run finds every grant
 * already there and adds nothing - and it never imports a privileged role
 * without leaving a record of where it came from.
 */
export async function importAssignments(
  executor: Executor,
  assignments: ImportedAssignment[],
  actor: Actor,
): Promise<ImportOutcome> {
  const roles = new Map((await listRoles(executor)).filter((r) => !r.archived).map((r) => [r.key, r]));
  const outcome: ImportOutcome = { people: 0, granted: 0, skipped: 0, unknownRoles: [] };
  const seenPeople = new Set<string>();

  for (const assignment of assignments) {
    if (!roles.has(assignment.roleKey)) {
      if (!outcome.unknownRoles.includes(assignment.roleKey)) outcome.unknownRoles.push(assignment.roleKey);
      outcome.skipped += 1;
      continue;
    }
    await request(executor)
      .input("oid", sql.NVarChar(64), assignment.objectId)
      .input("tid", sql.NVarChar(64), assignment.tenantId)
      .input("name", sql.NVarChar(200), assignment.name)
      .input("email", sql.NVarChar(320), assignment.email)
      .query(`
        UPDATE AccessPeople
           SET display_name = COALESCE(@name, display_name), email = COALESCE(@email, email),
               entra_tenant_id = COALESCE(entra_tenant_id, @tid),
               imported_from = COALESCE(imported_from, 'entra')
         WHERE entra_object_id = @oid;
        IF @@ROWCOUNT = 0
          INSERT AccessPeople (entra_object_id, entra_tenant_id, display_name, email, created_by, imported_from)
          VALUES (@oid, @tid, @name, @email, 'entra import', 'entra');
      `);
    if (!seenPeople.has(assignment.objectId)) {
      seenPeople.add(assignment.objectId);
      outcome.people += 1;
    }

    const result = await request(executor)
      .input("oid", sql.NVarChar(64), assignment.objectId)
      .input("role", sql.NVarChar(64), assignment.roleKey)
      .input("by", sql.NVarChar(200), `imported from Entra (${assignment.via})`)
      .query<{ grant_id: string }>(`
        INSERT AccessRoleGrants (person_id, role_key, granted_by)
        OUTPUT inserted.grant_id
        SELECT p.person_id, @role, @by
        FROM AccessPeople p
        WHERE p.entra_object_id = @oid
          AND NOT EXISTS (
            SELECT 1 FROM AccessRoleGrants g
            WHERE g.person_id = p.person_id AND g.role_key = @role AND g.revoked_at IS NULL
          )
      `);
    if (result.recordset.length) outcome.granted += 1;
    else outcome.skipped += 1;
  }
  return outcome;
}

export interface HealthFinding {
  code: string;
  severity: "attention" | "watch";
  headline: string;
  detail: string;
  people?: string[];
}

/**
 * What is worth an Access Administrator's attention now that roles are
 * OnBoard's. The old findings were about Entra app-role and group drift, which
 * no longer decides anything.
 */
export async function accessFindings(executor: Executor): Promise<HealthFinding[]> {
  const people = await listPeople(executor);
  const roles = await listRoles(executor);
  const findings: HealthFinding[] = [];

  const signedInWithNothing = people.filter((p) => p.status === "active" && p.lastSeenAt && p.roles.length === 0);
  if (signedInWithNothing.length) {
    findings.push({
      code: "signed_in_without_access",
      severity: "attention",
      headline: `${signedInWithNothing.length} ${signedInWithNothing.length === 1 ? "person has" : "people have"} signed in and hold no role`,
      detail: "They can reach OnBoard but see the No access page. Grant a role, or leave them if that is intended.",
      people: signedInWithNothing.map((p) => p.name ?? p.email ?? p.objectId),
    });
  }

  const soon = Date.now() + 14 * 24 * 60 * 60 * 1000;
  const expiring = people.flatMap((p) =>
    p.roles.filter((r) => r.expiresAt && new Date(r.expiresAt).getTime() < soon).map((r) => `${p.name ?? p.objectId} · ${r.roleName}`),
  );
  if (expiring.length) {
    findings.push({
      code: "expiring_access",
      severity: "watch",
      headline: `${expiring.length} ${expiring.length === 1 ? "grant expires" : "grants expire"} within a fortnight`,
      detail: "Access ends on its own at that point. Extend it now if the work continues.",
      people: expiring,
    });
  }

  const managing = roles.filter((r) => !r.archived && r.actions.includes(actionKey(ACCESS_MODULE, "manage")));
  const administrators = people.filter(
    (p) => p.status === "active" && p.roles.some((held) => managing.some((role) => role.key === held.roleKey)),
  );
  if (administrators.length < 2) {
    findings.push({
      code: "few_access_administrators",
      severity: "attention",
      headline:
        administrators.length === 0
          ? "Nobody in OnBoard can manage access"
          : "Only one person can manage access",
      detail:
        "A Privileged Access Change needs a second Access Administrator to decide it, so with fewer than two nothing privileged can be approved.",
      people: administrators.map((p) => p.name ?? p.objectId),
    });
  }

  const unheld = roles.filter((role) => !role.archived && role.members === 0 && !role.locked);
  if (unheld.length) {
    findings.push({
      code: "roles_nobody_holds",
      severity: "watch",
      headline: `${unheld.length} ${unheld.length === 1 ? "role is" : "roles are"} held by nobody`,
      detail: "Either somebody should hold it, or it can be archived so the list stays honest.",
      people: unheld.map((role) => role.name),
    });
  }

  return findings;
}

/** Present, so a page can tell "not set up yet" from "nothing to show". */
export async function grantsAvailable(executor: Executor): Promise<boolean> {
  const row = await request(executor).query<{ ready: number }>(`
    SELECT CASE WHEN OBJECT_ID('dbo.AccessGrantRequests','U') IS NULL
      OR COL_LENGTH('dbo.AccessPeople','kind') IS NULL THEN 0 ELSE 1 END AS ready
  `);
  return row.recordset[0]?.ready === 1;
}
