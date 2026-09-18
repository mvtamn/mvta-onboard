// Access Management over Microsoft Graph, after the ADR-0032 cutover.
//
// Roles and grants are OnBoard's own records now (increments 1-5). Microsoft
// Graph keeps exactly three jobs here: finding a person in the directory,
// inviting a guest into the tenant, and reporting sign-in activity. Everything
// that wrote an app-role assignment or a group membership - granting and
// revoking, the two-person approval around a privileged change, the expiry
// sweep and the reconciliation report - is gone, together with the delegated
// `AppRoleAssignment.ReadWrite.All` and `GroupMember.ReadWrite.All` consents it
// needed. A guest invitation is still an Entra act, so it stays; it invites and
// stops there, and the role the guest then holds is granted in OnBoard.
//
// `principals` survives as a read: the one-time import reads it, and the
// read-only Access groups and Workloads pages describe what Entra still holds.
import type { HttpRequest, HttpResponseInit } from "@azure/functions";
import { createHash } from "node:crypto";
import type { CallerPrincipal } from "./auth";
import { requireAccess, type AccessLookup } from "./access/require";

export const HUMAN_ACCESS_ROLES = [
  "OCC.Viewer",
  "OCC.Publisher",
  "OCC.Admin",
  "OCC.Compliance",
  "OCC.ComplianceManager",
  "OCC.Detour",
] as const;
export const WORKLOAD_ACCESS_ROLE = "System.Ingestion" as const;
export const ACCESS_ADMIN_ROLE = "OCC.AccessAdmin" as const;

export type HumanAccessRole = (typeof HUMAN_ACCESS_ROLES)[number];
export type AccessRole = HumanAccessRole | typeof WORKLOAD_ACCESS_ROLE | typeof ACCESS_ADMIN_ROLE;
export type PrincipalType = "user" | "group" | "service_principal";
export type AssignmentSource = "group" | "direct";

/**
 * The message every retired write path answers with. It names where the work
 * moved rather than only refusing, because the caller is an administrator who
 * still has the job to do.
 */
export const ACCESS_GRANTED_IN_ONBOARD =
  "Access is granted in OnBoard now - use Access & Identity to grant or revoke a role. This route only invites a guest into the tenant.";

export interface AccessAssignment {
  role: AccessRole;
  source: AssignmentSource;
  source_id: string;
  source_name: string;
  expires_at?: string | null;
  is_exception?: boolean;
  sponsor?: string | null;
  organization?: string | null;
  lifecycle_status?: "active" | "pending_verification" | "revoked" | "expiry_failed";
}

export interface AccessPrincipal {
  id: string;
  display_name: string;
  sign_in_name: string | null;
  principal_type: PrincipalType;
  account_enabled: boolean | null;
  guest_state: string | null;
  directory_status?: "missing";
  assignments: AccessAssignment[];
}

export interface SignInInformation {
  summary: {
    last_successful_at: string | null;
    last_interactive_attempt_at: string | null;
    last_noninteractive_at: string | null;
  } | null;
  events: Array<{
    occurred_at: string;
    successful: boolean;
    client_app: string | null;
    correlation_id: string | null;
  }>;
}

/**
 * The submitted item. `grant` and `revoke` are still parsed so that a console
 * that has not caught up is told where the work moved instead of being handed
 * a shapeless 400; only `invite_guest` is carried out. `role` and `source`
 * survive as optional fields for the same reason: an invitation does not need
 * them any more, and a payload that still carries them is not rejected for it.
 */
export interface DirectoryChange {
  action: "grant" | "revoke" | "invite_guest";
  principal_id: string;
  principal_type: PrincipalType;
  role?: AccessRole;
  source?: AssignmentSource;
  source_id?: string;
  reason: string;
  sponsor?: string;
  organization?: string;
  expires_at?: string;
}

export interface GuestInvitationResult {
  status: "completed" | "failed";
  correlation_id: string | null;
  principal_id?: string;
  message?: string;
}

export interface DirectoryRequestContext {
  user_assertion: string | null;
}

export interface AccessDirectory {
  listAccessPrincipals(environment: string, context?: DirectoryRequestContext): Promise<AccessPrincipal[]>;
  searchPrincipals(query: string, environment: string, context?: DirectoryRequestContext): Promise<AccessPrincipal[]>;
  getSignIns(principalId: string, environment: string, context?: DirectoryRequestContext): Promise<SignInInformation>;
  inviteGuest(
    change: DirectoryChange,
    environment: string,
    context?: DirectoryRequestContext,
  ): Promise<{ principal_id: string; correlation_id: string | null }>;
  findGuestByEmail?(
    email: string,
    environment: string,
    context?: DirectoryRequestContext,
  ): Promise<{ principal_id: string } | null>;
}

export interface AccessAuditEntry {
  id?: string;
  environment: string;
  actor_id: string;
  actor_name: string;
  action: string;
  target_id: string | null;
  reason: string | null;
  outcome: string;
  correlation_id: string | null;
  occurred_at: string;
  details?: Record<string, unknown>;
}

/**
 * Migration 052's metadata rows, kept as history. Nothing writes them now that
 * expiry, sponsor and organization belong to an OnBoard Role Grant; the
 * inventory reads still decorate what Entra reports with what was recorded
 * while the Entra-era flow was live.
 */
export interface AccessMetadata {
  id: string;
  environment: string;
  principal_id: string;
  principal_type: PrincipalType;
  role: AccessRole;
  source: AssignmentSource;
  source_id: string | null;
  reason: string;
  sponsor: string | null;
  organization: string | null;
  expires_at: string | null;
  status: "active" | "pending_verification" | "expiring" | "revoked" | "expiry_failed";
  last_correlation_id: string | null;
  updated_at?: string;
}

export interface AccessManagementStore {
  appendAudit(entry: AccessAuditEntry): Promise<void>;
  listAudit(environment: string): Promise<AccessAuditEntry[]>;
  getOperation(idempotencyKey: string, environment: string): Promise<unknown | null>;
  reserveOperation?(
    idempotencyKey: string,
    environment: string,
    requestHash: string,
    allowStaleRecovery: boolean,
  ): Promise<{ state: "reserved" } | { state: "in_progress" } | { state: "completed"; response: unknown }>;
  saveOperation(idempotencyKey: string, environment: string, response: unknown): Promise<void>;
  listMetadata?(environment: string): Promise<AccessMetadata[]>;
  getGuestInvitation?(email: string, environment: string): Promise<{ principal_id: string; correlation_id: string | null } | null>;
  claimGuestInvitation?(
    email: string,
    environment: string,
    claimedAt: string,
  ): Promise<
    | { state: "claimed" }
    | { state: "in_progress" }
    | { state: "recover" }
    | { state: "existing"; principal_id: string; correlation_id: string | null }
  >;
  saveGuestInvitation?(
    email: string,
    environment: string,
    principalId: string,
    correlationId: string | null,
    status: "invited",
    changedAt: string,
  ): Promise<void>;
}

function operationHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function reserveOperation(
  store: AccessManagementStore,
  idempotencyKey: string,
  environment: string,
  request: unknown,
  allowStaleRecovery = true,
): Promise<HttpResponseInit | null> {
  if (store.reserveOperation) {
    const reservation = await store.reserveOperation(idempotencyKey, environment, operationHash(request), allowStaleRecovery);
    if (reservation.state === "completed") return { status: 200, jsonBody: reservation.response };
    if (reservation.state === "in_progress") {
      return { status: 409, jsonBody: { error: "An operation with this Idempotency-Key is already in progress." } };
    }
    return null;
  }
  const prior = await store.getOperation(idempotencyKey, environment);
  return prior ? { status: 200, jsonBody: prior } : null;
}

/**
 * One invitation per email, however many callers ask at once. The store's claim
 * decides who sends it; a claim left behind by a crashed attempt is recovered
 * by looking the guest up in Entra rather than inviting a second time.
 */
async function inviteGuestIntoTenant(
  change: DirectoryChange,
  environment: string,
  context: DirectoryRequestContext,
  directory: AccessDirectory,
  store: AccessManagementStore,
  invitedAt: string,
): Promise<GuestInvitationResult> {
  const email = change.principal_id.toLowerCase();
  let invitation = store.getGuestInvitation ? await store.getGuestInvitation(email, environment) : null;
  let reused = !!invitation;
  if (!invitation && store.claimGuestInvitation) {
    const claim = await store.claimGuestInvitation(email, environment, invitedAt);
    if (claim.state === "existing") {
      invitation = { principal_id: claim.principal_id, correlation_id: claim.correlation_id };
      reused = true;
    } else if (claim.state === "in_progress") {
      return {
        status: "failed",
        correlation_id: null,
        message: "A guest invitation for this email is already in progress; retry after it completes.",
      };
    } else if (claim.state === "recover") {
      const recovered = await directory.findGuestByEmail?.(email, environment, context);
      if (!recovered) {
        return {
          status: "failed",
          correlation_id: null,
          message: "The prior guest invitation is not visible in Entra yet; retry after directory propagation completes.",
        };
      }
      invitation = { principal_id: recovered.principal_id, correlation_id: null };
      reused = true;
      await store.saveGuestInvitation?.(email, environment, recovered.principal_id, null, "invited", invitedAt);
    }
  }
  if (!invitation) {
    invitation = await directory.inviteGuest(change, environment, context);
    await store.saveGuestInvitation?.(
      email,
      environment,
      invitation.principal_id,
      invitation.correlation_id,
      "invited",
      invitedAt,
    );
  }
  return {
    status: "completed",
    correlation_id: invitation.correlation_id,
    principal_id: invitation.principal_id,
    ...(reused ? { message: "This email was already invited; the existing guest identity was reused." } : {}),
  };
}

export interface AccessManagementDependencies {
  directory: AccessDirectory;
  store: AccessManagementStore;
  environment: string;
  now?: () => Date;
  /**
   * The seam requireAccess documents: production leaves it empty and the
   * resolver reads the pool; a test says what the caller holds as a grant.
   */
  accessLookup?: AccessLookup;
}

function effectiveRoles(assignments: AccessAssignment[]): AccessRole[] {
  return [...new Set(assignments.map((assignment) => assignment.role))].sort();
}

function operationPath(request: HttpRequest): string {
  const pathname = new URL(request.url).pathname;
  const marker = "/access-management";
  const index = pathname.indexOf(marker);
  return index < 0 ? "" : pathname.slice(index + marker.length).replace(/^\/+|\/+$/g, "");
}

function directoryContext(request: HttpRequest): DirectoryRequestContext {
  const authorization = request.headers.get("authorization");
  return {
    user_assertion: request.headers.get("x-ms-token-aad-access-token")
      ?? (authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7) : null),
  };
}

function actorIdentity(principal: CallerPrincipal): { actor_id: string; actor_name: string } {
  return {
    actor_id: principal.userId ?? principal.userDetails ?? "unknown",
    actor_name: principal.userDetails ?? principal.userId ?? "unknown",
  };
}

const ALL_ACCESS_ROLES = new Set<string>([
  ...HUMAN_ACCESS_ROLES,
  WORKLOAD_ACCESS_ROLE,
  ACCESS_ADMIN_ROLE,
]);

function isDirectoryChange(value: unknown): value is DirectoryChange {
  if (!value || typeof value !== "object") return false;
  const change = value as Record<string, unknown>;
  return (change.action === "grant" || change.action === "revoke" || change.action === "invite_guest")
    && typeof change.principal_id === "string"
    && (change.principal_type === "user" || change.principal_type === "group" || change.principal_type === "service_principal")
    && (change.role === undefined || (typeof change.role === "string" && ALL_ACCESS_ROLES.has(change.role)))
    && (change.source === undefined || change.source === "group" || change.source === "direct")
    && (change.source_id === undefined || typeof change.source_id === "string")
    && typeof change.reason === "string";
}

function validateInvitation(change: DirectoryChange, now: Date): string[] {
  const errors: string[] = [];
  if (!change.principal_id.trim()) errors.push("A directory principal is required.");
  if (!change.reason.trim()) errors.push("A reason is required.");
  if (change.principal_type !== "user") errors.push("A guest invitation must target a person.");
  if (!change.sponsor?.trim()) errors.push("A guest sponsor is required.");
  if (!change.organization?.trim()) errors.push("A guest organization is required.");
  if (!change.expires_at) {
    errors.push("Guest access requires an expiry.");
  } else {
    const expiresAt = new Date(change.expires_at);
    if (Number.isNaN(expiresAt.valueOf()) || expiresAt <= now) {
      errors.push("Expiry must be a valid future date and time.");
    }
  }
  return errors;
}

async function readJson(request: HttpRequest): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/** The submitted batch, or the response that refuses it. */
function parseInvitations(raw: unknown): DirectoryChange[] | HttpResponseInit {
  const changes = raw && typeof raw === "object" && Array.isArray((raw as { changes?: unknown }).changes)
    ? (raw as { changes: unknown[] }).changes
    : null;
  if (!changes || changes.length === 0 || !changes.every(isDirectoryChange)) {
    return { status: 400, jsonBody: { error: "changes must be a non-empty array of access changes." } };
  }
  // Refused as a batch rather than item by item: a half-carried-out submission
  // would leave the caller guessing which half.
  if (changes.some((change) => change.action !== "invite_guest")) {
    return { status: 400, jsonBody: { error: ACCESS_GRANTED_IN_ONBOARD } };
  }
  return changes;
}

export function createAccessManagementHttpHandler({
  directory,
  store,
  environment,
  now = () => new Date(),
  accessLookup = {},
}: AccessManagementDependencies) {
  return async function accessManagementHttpHandler(request: HttpRequest): Promise<HttpResponseInit> {
    const path = operationPath(request);

    if (request.method === "GET" && path === "principals") {
      const auth = await requireAccess(request, "access-identity.view", accessLookup);
      if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
      const [principals, metadata] = await Promise.all([
        directory.listAccessPrincipals(environment, directoryContext(request)),
        store.listMetadata ? store.listMetadata(environment) : Promise.resolve([]),
      ]);
      return {
        status: 200,
        jsonBody: {
          environment,
          principals: principals.map((principal) => ({
            ...principal,
            assignments: principal.assignments.map((assignment) => {
              const details = metadata.find((item) =>
                item.principal_id === principal.id
                && item.role === assignment.role
                && item.source === assignment.source,
              );
              return details ? {
                ...assignment,
                expires_at: details.expires_at,
                is_exception: principal.principal_type === "user" && assignment.source === "direct",
                sponsor: details.sponsor,
                organization: details.organization,
                lifecycle_status: details.status,
              } : assignment;
            }),
            effective_roles: effectiveRoles(principal.assignments),
          })),
        },
      };
    }

    if (request.method === "GET" && path === "directory/search") {
      const auth = await requireAccess(request, "access-identity.view", accessLookup);
      if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
      const query = request.query.get("q")?.trim() ?? "";
      if (query.length < 2) {
        return { status: 400, jsonBody: { error: "q must contain at least two characters." } };
      }
      const candidates = await directory.searchPrincipals(query, environment, directoryContext(request));
      return {
        status: 200,
        jsonBody: {
          candidates: candidates.map((principal) => ({
            ...principal,
            effective_roles: effectiveRoles(principal.assignments),
          })),
        },
      };
    }

    const signInsMatch = /^principals\/([^/]+)\/sign-ins$/.exec(path);
    if (request.method === "GET" && signInsMatch) {
      const auth = await requireAccess(request, "access-identity.view", accessLookup);
      if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
      const principalId = decodeURIComponent(signInsMatch[1]);
      const signIns = await directory.getSignIns(principalId, environment, directoryContext(request));
      const queriedAt = now().toISOString();
      await store.appendAudit({
        environment,
        ...actorIdentity(auth.principal),
        action: "sign_in_details_viewed",
        target_id: principalId,
        reason: null,
        outcome: "completed",
        correlation_id: null,
        occurred_at: queriedAt,
        details: { scope: "onboard_application", event_count: signIns.events.length },
      });
      return {
        status: 200,
        jsonBody: {
          directory_summary: signIns.summary ? { scope: "directory_wide", ...signIns.summary } : null,
          onboard_events: { scope: "onboard_application", queried_at: queriedAt, events: signIns.events },
        },
      };
    }

    if (request.method === "GET" && path === "audit") {
      const auth = await requireAccess(request, "access-identity.view", accessLookup);
      if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
      return { status: 200, jsonBody: { audit: await store.listAudit(environment) } };
    }

    if (request.method === "POST" && path === "export") {
      const auth = await requireAccess(request, "access-identity.view", accessLookup);
      if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
      const [principals, metadata] = await Promise.all([
        directory.listAccessPrincipals(environment, directoryContext(request)),
        store.listMetadata ? store.listMetadata(environment) : Promise.resolve([]),
      ]);
      const generatedAt = now().toISOString();
      const rows = principals.flatMap((principal) => principal.assignments.map((assignment) => {
        const details = metadata.find((item) =>
          item.principal_id === principal.id
          && item.role === assignment.role
          && item.source === assignment.source,
        );
        return {
          display_name: principal.display_name,
          sign_in_name: principal.sign_in_name,
          principal_type: principal.principal_type,
          account_enabled: principal.account_enabled,
          guest_state: principal.guest_state,
          effective_roles: effectiveRoles(principal.assignments),
          reconciliation_status: principal.directory_status === "missing" ? "missing_directory_object" : "current",
          role: assignment.role,
          source: assignment.source,
          source_name: assignment.source_name,
          expires_at: details?.expires_at ?? assignment.expires_at ?? null,
          sponsor: details?.sponsor ?? null,
          organization: details?.organization ?? null,
        };
      }));
      await store.appendAudit({
        environment,
        ...actorIdentity(auth.principal),
        action: "access_inventory_exported",
        target_id: null,
        reason: null,
        outcome: "completed",
        correlation_id: null,
        occurred_at: generatedAt,
        details: { row_count: rows.length, fields: "access_inventory_only" },
      });
      return { status: 200, jsonBody: { environment, generated_at: generatedAt, rows } };
    }

    if (request.method === "POST" && path === "changes/preview") {
      const auth = await requireAccess(request, "access-identity.manage", accessLookup);
      if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
      const parsed = parseInvitations(await readJson(request));
      if (!Array.isArray(parsed)) return parsed;
      const currentTime = now();
      const items = parsed.map((change, index) => {
        const errors = validateInvitation(change, currentTime);
        return { index, disposition: errors.length > 0 ? "invalid" : "immediate", errors };
      });
      await store.appendAudit({
        environment,
        ...actorIdentity(auth.principal),
        action: "access_change_previewed",
        target_id: null,
        reason: null,
        outcome: items.every((item) => item.errors.length === 0) ? "validated" : "validation_failed",
        correlation_id: null,
        occurred_at: currentTime.toISOString(),
        details: { item_count: items.length, invalid_count: items.filter((item) => item.errors.length > 0).length },
      });
      return {
        status: 200,
        jsonBody: { environment, valid: items.every((item) => item.errors.length === 0), items },
      };
    }

    if (request.method === "POST" && path === "changes") {
      const auth = await requireAccess(request, "access-identity.manage", accessLookup);
      if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
      const idempotencyKey = request.headers.get("idempotency-key")?.trim();
      if (!idempotencyKey) {
        return { status: 400, jsonBody: { error: "Idempotency-Key header is required." } };
      }
      const parsed = parseInvitations(await readJson(request));
      if (!Array.isArray(parsed)) return parsed;
      const replay = await reserveOperation(
        store,
        idempotencyKey,
        environment,
        { operation: "guest_invitations", changes: parsed },
        true,
      );
      if (replay) return replay;
      const occurredAt = now().toISOString();
      const results: Array<Record<string, unknown>> = [];
      for (const [index, change] of parsed.entries()) {
        const errors = validateInvitation(change, new Date(occurredAt));
        if (errors.length > 0) {
          results.push({ index, disposition: "invalid", errors });
          continue;
        }
        try {
          const result = await inviteGuestIntoTenant(
            change,
            environment,
            directoryContext(request),
            directory,
            store,
            occurredAt,
          );
          results.push({
            index,
            disposition: result.status,
            correlation_id: result.correlation_id,
            ...(result.principal_id ? { principal_id: result.principal_id } : {}),
            ...(result.message ? { message: result.message } : {}),
          });
          await store.appendAudit({
            environment,
            ...actorIdentity(auth.principal),
            action: "guest_invitation",
            target_id: change.principal_id,
            reason: change.reason,
            outcome: result.status,
            correlation_id: result.correlation_id,
            occurred_at: occurredAt,
            details: {
              principal_type: change.principal_type,
              sponsor: change.sponsor ?? null,
              organization: change.organization ?? null,
            },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Guest invitation failed.";
          results.push({ index, disposition: "failed", correlation_id: null, message });
          await store.appendAudit({
            environment,
            ...actorIdentity(auth.principal),
            action: "guest_invitation",
            target_id: change.principal_id,
            reason: change.reason,
            outcome: "failed",
            correlation_id: null,
            occurred_at: occurredAt,
            details: { principal_type: change.principal_type, error: message },
          });
        }
      }
      const response = { environment, results };
      await store.saveOperation(idempotencyKey, environment, response);
      return { status: 200, jsonBody: response };
    }

    return { status: 404, jsonBody: { error: "Access Management operation not found." } };
  };
}
