import type { HttpRequest, HttpResponseInit } from "@azure/functions";
import { createHash } from "node:crypto";
import { getCallerPrincipal, type CallerPrincipal } from "./auth";

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

export interface AccessReconciliationFinding {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  principal_id?: string;
  role?: AccessRole;
  repair_change?: DirectoryChange;
}

export interface AccessReconciliationReport {
  environment: string;
  observed_at: string;
  findings: AccessReconciliationFinding[];
}

export interface DirectoryChange {
  action: "grant" | "revoke" | "invite_guest";
  principal_id: string;
  principal_type: PrincipalType;
  role: AccessRole;
  source: AssignmentSource;
  source_id?: string;
  reason: string;
  sponsor?: string;
  organization?: string;
  expires_at?: string;
}

export interface DirectoryChangeResult {
  status: "completed" | "pending_verification" | "failed";
  correlation_id: string | null;
  message?: string;
  principal_id?: string;
  source_id?: string;
  steps?: Array<{
    step: "invitation" | "access_assignment";
    status: "completed" | "pending_verification" | "failed";
    correlation_id: string | null;
    message?: string;
  }>;
}

export interface DirectoryRequestContext {
  user_assertion: string | null;
}

export interface AccessDirectory {
  listAccessPrincipals(environment: string, context?: DirectoryRequestContext): Promise<AccessPrincipal[]>;
  getPrincipal?(principalId: string, environment: string, context?: DirectoryRequestContext): Promise<AccessPrincipal | null>;
  searchPrincipals(query: string, environment: string, context?: DirectoryRequestContext): Promise<AccessPrincipal[]>;
  getSignIns(principalId: string, environment: string, context?: DirectoryRequestContext): Promise<SignInInformation>;
  applyChange(change: DirectoryChange, environment: string, context?: DirectoryRequestContext): Promise<DirectoryChangeResult>;
  inviteGuest?(
    change: DirectoryChange,
    environment: string,
    context?: DirectoryRequestContext,
  ): Promise<{ principal_id: string; correlation_id: string | null }>;
  findGuestByEmail?(
    email: string,
    environment: string,
    context?: DirectoryRequestContext,
  ): Promise<{ principal_id: string } | null>;
  reconcileAccess?(environment: string, context?: DirectoryRequestContext): Promise<AccessReconciliationReport>;
}

export type AccessChangeStatus = "pending" | "applying" | "approved" | "rejected" | "cancelled" | "expired" | "failed";

export interface AccessChangeRecord {
  id: string;
  environment: string;
  change: DirectoryChange;
  status: AccessChangeStatus;
  requested_by_id: string;
  requested_by_name: string;
  requested_at: string;
  approval_expires_at?: string;
  decided_by_id: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  result: DirectoryChangeResult | null;
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
  listPendingChanges(environment: string): Promise<AccessChangeRecord[]>;
  getChange(id: string, environment: string): Promise<AccessChangeRecord | null>;
  createChange(input: Omit<AccessChangeRecord, "id">): Promise<AccessChangeRecord>;
  decideChange(
    id: string,
    decision: Exclude<AccessChangeStatus, "pending" | "applying">,
    actor: { id: string; name: string },
    decidedAt: string,
    result: DirectoryChangeResult | null,
  ): Promise<AccessChangeRecord>;
  claimChange?(id: string, environment: string, actor: { id: string; name: string }, claimedAt: string): Promise<boolean>;
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
  recordMetadata?(
    change: DirectoryChange,
    environment: string,
    actor: string,
    changedAt: string,
    result: DirectoryChangeResult,
  ): Promise<void>;
  listDueExpirations?(environment: string, asOf: string): Promise<AccessMetadata[]>;
  markMetadataStatus?(
    id: string,
    status: AccessMetadata["status"],
    actor: string,
    changedAt: string,
    correlationId: string | null,
  ): Promise<void>;
  claimMetadataExpiry?(id: string, environment: string, actor: string, claimedAt: string): Promise<boolean>;
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
    status: "invited" | "assigned" | "assignment_failed",
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

async function applyDirectoryChange(
  change: DirectoryChange,
  environment: string,
  context: DirectoryRequestContext,
  directory: AccessDirectory,
  store: AccessManagementStore,
  changedAt: string,
): Promise<DirectoryChangeResult> {
  if (change.action !== "invite_guest"
    || !directory.inviteGuest
    || !store.getGuestInvitation
    || !store.saveGuestInvitation) {
    return directory.applyChange(change, environment, context);
  }
  const email = change.principal_id.toLowerCase();
  let invitation = await store.getGuestInvitation(email, environment);
  if (!invitation && store.claimGuestInvitation) {
    const claim = await store.claimGuestInvitation(email, environment, changedAt);
    if (claim.state === "existing") {
      invitation = { principal_id: claim.principal_id, correlation_id: claim.correlation_id };
    } else if (claim.state === "in_progress") {
      return {
        status: "failed",
        correlation_id: null,
        message: "A guest invitation for this email is already in progress; retry after it completes.",
        steps: [{ step: "invitation", status: "pending_verification", correlation_id: null }],
      };
    } else if (claim.state === "recover") {
      const recovered = await directory.findGuestByEmail?.(email, environment, context);
      if (recovered) {
        invitation = { principal_id: recovered.principal_id, correlation_id: null };
        await store.saveGuestInvitation(email, environment, recovered.principal_id, null, "invited", changedAt);
      } else {
        return {
          status: "failed",
          correlation_id: null,
          message: "The prior guest invitation is not visible in Entra yet; retry after directory propagation completes.",
          steps: [{ step: "invitation", status: "pending_verification", correlation_id: null }],
        };
      }
    }
  }
  if (!invitation) {
    invitation = await directory.inviteGuest(change, environment, context);
    await store.saveGuestInvitation(email, environment, invitation.principal_id, invitation.correlation_id, "invited", changedAt);
  }
  let assignment: DirectoryChangeResult;
  try {
    assignment = await directory.applyChange(
      { ...change, action: "grant", principal_id: invitation.principal_id },
      environment,
      context,
    );
  } catch (error) {
    assignment = {
      status: "failed",
      correlation_id: null,
      message: error instanceof Error ? error.message : "Guest access assignment failed.",
    };
  }
  await store.saveGuestInvitation(
    email,
    environment,
    invitation.principal_id,
    invitation.correlation_id,
    assignment.status === "failed" ? "assignment_failed" : "assigned",
    changedAt,
  );
  return {
    ...assignment,
    principal_id: invitation.principal_id,
    steps: [
      { step: "invitation", status: "completed", correlation_id: invitation.correlation_id },
      { step: "access_assignment", status: assignment.status, correlation_id: assignment.correlation_id, ...(assignment.message ? { message: assignment.message } : {}) },
    ],
  };
}

export interface AccessManagementDependencies {
  directory: AccessDirectory;
  store: AccessManagementStore;
  environment: string;
  now?: () => Date;
  allowAdminFallback?: boolean;
  privilegedAuthContext?: string;
  minimumRecoverableAdministrators?: number;
  privilegedApprovalHours?: number;
}

function accessAdministrator(request: HttpRequest, allowAdminFallback: boolean): CallerPrincipal | null {
  const principal = getCallerPrincipal(request);
  if (!principal) return null;
  if (principal.roles.includes(WORKLOAD_ACCESS_ROLE) && principal.roles.some((role) => role !== WORKLOAD_ACCESS_ROLE)) {
    return null;
  }
  const allowed = principal.roles.includes(ACCESS_ADMIN_ROLE)
    || (allowAdminFallback && principal.roles.includes("OCC.Admin"));
  return allowed ? principal : null;
}

function forbidden(request: HttpRequest, allowAdminFallback: boolean): HttpResponseInit | null {
  const principal = getCallerPrincipal(request);
  if (!principal) return { status: 401, jsonBody: { error: "Not authenticated." } };
  if (!accessAdministrator(request, allowAdminFallback)) {
    return { status: 403, jsonBody: { error: "Access Management permission is required." } };
  }
  return null;
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

function hasAuthenticationContext(principal: CallerPrincipal, context: string): boolean {
  return Object.entries(principal.claims).some(([type, values]) =>
    (type === "acrs" || type.endsWith("/authcontextclassreference")) && values.includes(context),
  );
}

function directoryContext(request: HttpRequest): DirectoryRequestContext {
  const authorization = request.headers.get("authorization");
  return {
    user_assertion: request.headers.get("x-ms-token-aad-access-token")
      ?? (authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7) : null),
  };
}

function assignmentRemovedBy(change: DirectoryChange, principal: AccessPrincipal, assignment: AccessAssignment): boolean {
  if (change.action !== "revoke" || assignment.role !== change.role) return false;
  if (change.principal_type === "group") {
    return (principal.id === change.principal_id && assignment.source === "direct")
      || (assignment.source === "group" && assignment.source_id === change.principal_id);
  }
  return principal.id === change.principal_id
    && assignment.source === change.source
    && (change.source !== "group" || !change.source_id || assignment.source_id === change.source_id);
}

function recoverableAdministratorCountAfter(principals: AccessPrincipal[], change: DirectoryChange): number {
  return principals.filter((principal) =>
    principal.principal_type === "user"
    && principal.account_enabled !== false
    && principal.assignments.some((assignment) =>
      (assignment.role === ACCESS_ADMIN_ROLE || assignment.role === "OCC.Admin")
      && !assignmentRemovedBy(change, principal, assignment),
    ),
  ).length;
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
    && typeof change.role === "string"
    && ALL_ACCESS_ROLES.has(change.role)
    && (change.source === "group" || change.source === "direct")
    && (change.source_id === undefined || typeof change.source_id === "string")
    && typeof change.reason === "string";
}

function validateChange(
  change: DirectoryChange,
  now: Date,
  principal?: AccessPrincipal,
  principalLookupPerformed = false,
): string[] {
  const errors: string[] = [];
  if (!change.principal_id.trim()) errors.push("A directory principal is required.");
  if (!change.reason.trim()) errors.push("A reason is required.");
  if (principalLookupPerformed && change.action !== "invite_guest" && !principal) {
    errors.push("The directory principal does not exist in this tenant.");
  }
  if (principal && principal.principal_type !== change.principal_type) {
    errors.push(`The directory principal is ${principal.principal_type}, not ${change.principal_type}.`);
  }
  if (change.role === WORKLOAD_ACCESS_ROLE && change.principal_type !== "service_principal") {
    errors.push("System.Ingestion can be assigned only to a workload identity.");
  }
  if (change.principal_type === "service_principal" && change.role !== WORKLOAD_ACCESS_ROLE) {
    errors.push("Workload identities can be assigned only System.Ingestion.");
  }
  if (change.principal_type === "group" && change.source === "group") {
    errors.push("OnBoard access groups must be assigned directly; nested group membership is not supported.");
  }
  if (change.action === "revoke" && change.source === "group" && !change.source_id?.trim()) {
    errors.push("The exact group assignment source is required for revocation.");
  }
  if (principal?.account_enabled === false && change.action !== "revoke") {
    errors.push("Disabled directory identities cannot receive OnBoard access.");
  }
  if (change.action === "grant" && principal) {
    const otherRoles = principal.assignments.map((assignment) => assignment.role).filter((role) => role !== change.role);
    if (change.role === WORKLOAD_ACCESS_ROLE && otherRoles.length > 0) {
      errors.push("System.Ingestion is exclusive and cannot be combined with another OnBoard role.");
    }
    if (change.role !== WORKLOAD_ACCESS_ROLE && principal.assignments.some((assignment) => assignment.role === WORKLOAD_ACCESS_ROLE)) {
      errors.push("A workload with System.Ingestion cannot receive a human OnBoard role.");
    }
  }
  if (change.action === "invite_guest") {
    if (change.principal_type !== "user") errors.push("A guest invitation must target a person.");
    if (!change.sponsor?.trim()) errors.push("A guest sponsor is required.");
    if (!change.organization?.trim()) errors.push("A guest organization is required.");
    if (!change.expires_at) {
      errors.push("Guest access requires an expiry.");
    }
  }
  if (change.expires_at) {
    const expiresAt = new Date(change.expires_at);
    if (Number.isNaN(expiresAt.valueOf()) || expiresAt <= now) {
      errors.push("Expiry must be a valid future date and time.");
    }
  }
  return errors;
}

function alreadySatisfied(change: DirectoryChange, principal?: AccessPrincipal): boolean {
  if (!principal || change.action !== "grant") return false;
  return principal.assignments.some((assignment) =>
    assignment.role === change.role && assignment.source === change.source,
  );
}

function changeAlreadyApplied(change: DirectoryChange, principal?: AccessPrincipal): boolean {
  const matchingAssignment = principal?.assignments.some((assignment) =>
    assignment.role === change.role
    && assignment.source === change.source
    && (change.source !== "group" || !change.source_id || assignment.source_id === change.source_id),
  ) ?? false;
  return change.action === "grant" ? matchingAssignment : change.action === "revoke" ? !matchingAssignment : false;
}

async function readJson(request: HttpRequest): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function createAccessManagementHttpHandler({
  directory,
  store,
  environment,
  now = () => new Date(),
  allowAdminFallback = false,
  privilegedAuthContext = "c1",
  minimumRecoverableAdministrators = 1,
  privilegedApprovalHours = 24,
}: AccessManagementDependencies) {
  return async function accessManagementHttpHandler(request: HttpRequest): Promise<HttpResponseInit> {
    const authFailure = forbidden(request, allowAdminFallback);
    if (authFailure) return authFailure;

    const path = operationPath(request);
    if (request.method === "GET" && path === "principals") {
      const [principals, metadata] = await Promise.all([
        directory.listAccessPrincipals(environment, directoryContext(request)),
        store.listMetadata ? store.listMetadata(environment) : Promise.resolve([]),
      ]);
      return {
        status: 200,
        jsonBody: {
          environment,
          access_admin_fallback: allowAdminFallback,
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
      const actor = accessAdministrator(request, allowAdminFallback)!;
      const principalId = decodeURIComponent(signInsMatch[1]);
      const signIns = await directory.getSignIns(principalId, environment, directoryContext(request));
      const queriedAt = now().toISOString();
      await store.appendAudit({
        environment,
        actor_id: actor.userId ?? actor.userDetails ?? "unknown",
        actor_name: actor.userDetails ?? actor.userId ?? "unknown",
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

    if (request.method === "POST" && path === "changes/preview") {
      const raw = await readJson(request);
      const changes = raw && typeof raw === "object" && Array.isArray((raw as { changes?: unknown }).changes)
        ? (raw as { changes: unknown[] }).changes
        : null;
      if (!changes || changes.length === 0 || !changes.every(isDirectoryChange)) {
        return { status: 400, jsonBody: { error: "changes must be a non-empty array of access changes." } };
      }
      const currentTime = now();
      const principals = await directory.listAccessPrincipals(environment, directoryContext(request));
      const resolvedPrincipals = await Promise.all(changes.map(async (change) => {
        const assigned = principals.find((candidate) => candidate.id === change.principal_id);
        if (change.action === "invite_guest" || !directory.getPrincipal) return assigned;
        const authoritative = await directory.getPrincipal(change.principal_id, environment, directoryContext(request));
        return authoritative ? { ...authoritative, assignments: assigned?.assignments ?? [] } : null;
      }));
      const items = changes.map((change, index) => {
        const principal = resolvedPrincipals[index] ?? undefined;
        const errors = validateChange(change, currentTime, principal, !!directory.getPrincipal);
        return {
          index,
          disposition: errors.length > 0
            ? "invalid"
            : alreadySatisfied(change, principal)
              ? "already_satisfied"
            : (change.role === "OCC.Admin" || change.role === ACCESS_ADMIN_ROLE)
              ? "approval_required"
              : "immediate",
          errors,
        };
      });
      const actor = accessAdministrator(request, allowAdminFallback)!;
      await store.appendAudit({
        environment,
        actor_id: actor.userId ?? actor.userDetails ?? "unknown",
        actor_name: actor.userDetails ?? actor.userId ?? "unknown",
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

    if (request.method === "GET" && path === "audit") {
      return { status: 200, jsonBody: { audit: await store.listAudit(environment) } };
    }

    if (request.method === "POST" && path === "export") {
      const actor = accessAdministrator(request, allowAdminFallback)!;
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
        actor_id: actor.userId ?? actor.userDetails ?? "unknown",
        actor_name: actor.userDetails ?? actor.userId ?? "unknown",
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

    if (request.method === "GET" && path === "changes") {
      return { status: 200, jsonBody: { changes: await store.listPendingChanges(environment) } };
    }

    if (request.method === "GET" && path === "reconciliation") {
      if (!directory.reconcileAccess) {
        return { status: 503, jsonBody: { error: "Access reconciliation is unavailable." } };
      }
      const actor = accessAdministrator(request, allowAdminFallback)!;
      const report = await directory.reconcileAccess(environment, directoryContext(request));
      await store.appendAudit({
        environment,
        actor_id: actor.userId ?? actor.userDetails ?? "unknown",
        actor_name: actor.userDetails ?? actor.userId ?? "unknown",
        action: "access_reconciliation_viewed",
        target_id: null,
        reason: null,
        outcome: report.findings.some((finding) => finding.severity === "error") ? "drift_found" : "completed",
        correlation_id: null,
        occurred_at: now().toISOString(),
        details: { finding_count: report.findings.length },
      });
      return { status: 200, jsonBody: report };
    }

    const cancelMatch = /^changes\/([^/]+)\/cancel$/.exec(path);
    if (request.method === "POST" && cancelMatch) {
      const actor = accessAdministrator(request, allowAdminFallback)!;
      const actorId = actor.userId ?? actor.userDetails ?? "unknown";
      const actorName = actor.userDetails ?? actor.userId ?? "unknown";
      const existing = await store.getChange(decodeURIComponent(cancelMatch[1]), environment);
      if (!existing) return { status: 404, jsonBody: { error: "Privileged access change not found." } };
      if (existing.status !== "pending") return { status: 409, jsonBody: { error: "Privileged access change is no longer pending." } };
      if (existing.requested_by_id !== actorId) {
        return { status: 403, jsonBody: { error: "Only the requester can cancel this privileged access change." } };
      }
      const raw = await readJson(request);
      const reason = raw && typeof raw === "object" && typeof (raw as { reason?: unknown }).reason === "string"
        ? (raw as { reason: string }).reason.trim()
        : "";
      if (!reason) return { status: 400, jsonBody: { error: "A cancellation reason is required." } };
      const cancelledAt = now().toISOString();
      const cancelled = await store.decideChange(existing.id, "cancelled", { id: actorId, name: actorName }, cancelledAt, null);
      await store.appendAudit({
        environment,
        actor_id: actorId,
        actor_name: actorName,
        action: "privileged_change_cancelled",
        target_id: existing.change.principal_id,
        reason,
        outcome: "cancelled",
        correlation_id: null,
        occurred_at: cancelledAt,
        details: { change_id: existing.id, role: existing.change.role },
      });
      return { status: 200, jsonBody: { change_id: cancelled.id, status: cancelled.status } };
    }

    const decisionMatch = /^changes\/([^/]+)\/decision$/.exec(path);
    if (request.method === "POST" && decisionMatch) {
      const idempotencyKey = request.headers.get("idempotency-key")?.trim();
      if (!idempotencyKey) return { status: 400, jsonBody: { error: "Idempotency-Key header is required." } };

      const actor = accessAdministrator(request, allowAdminFallback)!;
      if (!hasAuthenticationContext(actor, privilegedAuthContext)) {
        return { status: 403, jsonBody: { error: "Fresh authentication is required for privileged access changes." } };
      }
      const raw = await readJson(request);
      const decision = raw && typeof raw === "object" ? (raw as { decision?: unknown }).decision : null;
      if (decision !== "approved" && decision !== "rejected") {
        return { status: 400, jsonBody: { error: "decision must be approved or rejected." } };
      }
      const replay = await reserveOperation(store, idempotencyKey, environment, {
        operation: "privileged_decision",
        change_id: decodeURIComponent(decisionMatch[1]),
        decision,
      });
      if (replay) return replay;
      const existing = await store.getChange(decodeURIComponent(decisionMatch[1]), environment);
      if (!existing) return { status: 404, jsonBody: { error: "Privileged access change not found." } };
      const applyingLeaseExpired = existing.status === "applying"
        && !!existing.decided_at
        && new Date(existing.decided_at).valueOf() <= now().valueOf() - 5 * 60 * 1000;
      if (existing.status !== "pending" && !(decision === "approved" && applyingLeaseExpired)) {
        return { status: 409, jsonBody: { error: "Privileged access change is no longer pending." } };
      }
      const actorId = actor.userId ?? actor.userDetails ?? "unknown";
      const actorName = actor.userDetails ?? actor.userId ?? "unknown";
      if (existing.requested_by_id === actorId) {
        return { status: 409, jsonBody: { error: "The requester cannot approve or reject their own privileged change." } };
      }
      if (existing.approval_expires_at && new Date(existing.approval_expires_at) <= now()) {
        const expiredAt = now().toISOString();
        await store.decideChange(existing.id, "expired", { id: actorId, name: actorName }, expiredAt, null);
        await store.appendAudit({
          environment,
          actor_id: actorId,
          actor_name: actorName,
          action: "privileged_change_expired",
          target_id: existing.change.principal_id,
          reason: existing.change.reason,
          outcome: "expired",
          correlation_id: null,
          occurred_at: expiredAt,
          details: { change_id: existing.id, role: existing.change.role },
        });
        return { status: 410, jsonBody: { error: "Privileged access change has expired." } };
      }

      let result: DirectoryChangeResult | null = null;
      if (decision === "approved") {
        if (store.claimChange) {
          const claimed = await store.claimChange(existing.id, environment, { id: actorId, name: actorName }, now().toISOString());
          if (!claimed) {
            return { status: 409, jsonBody: { error: "Privileged access change is already being decided." } };
          }
        }
        try {
          const observedPrincipals = await directory.listAccessPrincipals(environment, directoryContext(request));
          if (existing.change.action === "revoke"
            && (existing.change.role === "OCC.Admin" || existing.change.role === ACCESS_ADMIN_ROLE)
            && recoverableAdministratorCountAfter(observedPrincipals, existing.change) < minimumRecoverableAdministrators) {
            const blockedResult: DirectoryChangeResult = {
              status: "failed",
              correlation_id: null,
              message: "This change would remove the last recoverable Access Administrator.",
            };
            if (store.claimChange) {
              await store.decideChange(existing.id, "failed", { id: actorId, name: actorName }, now().toISOString(), blockedResult);
            }
            await store.appendAudit({
              environment,
              actor_id: actorId,
              actor_name: actorName,
              action: "privileged_change_blocked",
              target_id: existing.change.principal_id,
              reason: existing.change.reason,
              outcome: "recovery_invariant",
              correlation_id: null,
              occurred_at: now().toISOString(),
              details: { change_id: existing.id, role: existing.change.role },
            });
            const blockedResponse = { error: blockedResult.message };
            await store.saveOperation(idempotencyKey, environment, blockedResponse);
            return { status: 409, jsonBody: blockedResponse };
          }
          const observedPrincipal = observedPrincipals.find((principal) => principal.id === existing.change.principal_id);
          result = changeAlreadyApplied(existing.change, observedPrincipal)
            ? { status: "completed", correlation_id: null, message: "Directory state already reflects this change." }
            : await applyDirectoryChange(existing.change, environment, directoryContext(request), directory, store, now().toISOString());
          if (store.recordMetadata && result.status !== "failed") {
            const metadataChange = result.source_id ? { ...existing.change, source_id: result.source_id } : existing.change;
            await store.recordMetadata(metadataChange, environment, actorName, now().toISOString(), result);
          }
        } catch (error) {
          const failedResult: DirectoryChangeResult = {
            status: "failed",
            correlation_id: null,
            message: error instanceof Error ? error.message : "Directory change failed.",
          };
          const failed = await store.decideChange(existing.id, "failed", { id: actorId, name: actorName }, now().toISOString(), failedResult);
          await store.appendAudit({
            environment,
            actor_id: actorId,
            actor_name: actorName,
            action: "privileged_change_failed",
            target_id: existing.change.principal_id,
            reason: existing.change.reason,
            outcome: "failed",
            correlation_id: null,
            occurred_at: now().toISOString(),
            details: { change_id: existing.id, role: existing.change.role, error: failedResult.message },
          });
          const response = { change_id: failed.id, status: failed.status, result: failedResult };
          await store.saveOperation(idempotencyKey, environment, response);
          return { status: 502, jsonBody: response };
        }
        if (result.status === "failed") {
          const failed = await store.decideChange(existing.id, "failed", { id: actorId, name: actorName }, now().toISOString(), result);
          await store.appendAudit({
            environment,
            actor_id: actorId,
            actor_name: actorName,
            action: "privileged_change_failed",
            target_id: existing.change.principal_id,
            reason: existing.change.reason,
            outcome: "failed",
            correlation_id: result.correlation_id,
            occurred_at: now().toISOString(),
            details: { change_id: existing.id, role: existing.change.role, error: result.message, ...(result.steps ? { steps: result.steps } : {}) },
          });
          const response = { change_id: failed.id, status: failed.status, result };
          await store.saveOperation(idempotencyKey, environment, response);
          return { status: 502, jsonBody: response };
        }
      }
      const changed = await store.decideChange(existing.id, decision, { id: actorId, name: actorName }, now().toISOString(), result);
      await store.appendAudit({
        environment,
        actor_id: actorId,
        actor_name: actorName,
        action: decision === "approved" ? "privileged_change_approved" : "privileged_change_rejected",
        target_id: existing.change.principal_id,
        reason: existing.change.reason,
        outcome: result?.status ?? decision,
        correlation_id: result?.correlation_id ?? null,
        occurred_at: now().toISOString(),
        details: { change_id: existing.id, role: existing.change.role, requested_by: existing.requested_by_name },
      });
      const response = { change_id: changed.id, status: changed.status, result };
      await store.saveOperation(idempotencyKey, environment, response);
      return { status: 200, jsonBody: response };
    }

    if (request.method === "GET" && path === "expirations") {
      if (!store.listDueExpirations) return { status: 503, jsonBody: { error: "Access expiry storage is unavailable." } };
      return { status: 200, jsonBody: { expirations: await store.listDueExpirations(environment, now().toISOString()) } };
    }

    if (request.method === "POST" && path === "expirations/apply") {
      if (!store.listDueExpirations || !store.markMetadataStatus) {
        return { status: 503, jsonBody: { error: "Access expiry storage is unavailable." } };
      }
      const idempotencyKey = request.headers.get("idempotency-key")?.trim();
      if (!idempotencyKey) return { status: 400, jsonBody: { error: "Idempotency-Key header is required." } };
      const replay = await reserveOperation(store, idempotencyKey, environment, { operation: "apply_expirations" });
      if (replay) return replay;
      const actor = accessAdministrator(request, allowAdminFallback)!;
      const actorId = actor.userId ?? actor.userDetails ?? "unknown";
      const actorName = actor.userDetails ?? actor.userId ?? "unknown";
      const occurredAt = now().toISOString();
      const due = await store.listDueExpirations(environment, occurredAt);
      const results: Array<Record<string, unknown>> = [];
      for (const metadata of due) {
        if (store.claimMetadataExpiry) {
          const claimed = await store.claimMetadataExpiry(metadata.id, environment, actorName, occurredAt);
          if (!claimed) continue;
        }
        const change: DirectoryChange = {
          action: "revoke",
          principal_id: metadata.principal_id,
          principal_type: metadata.principal_type,
          role: metadata.role,
          source: metadata.source,
          ...(metadata.source_id ? { source_id: metadata.source_id } : {}),
          reason: `Expired access: ${metadata.reason}`,
        };
        try {
          const result = await directory.applyChange(change, environment, directoryContext(request));
          const status = result.status === "failed" ? "expiry_failed" : "revoked";
          await store.markMetadataStatus(metadata.id, status, actorName, occurredAt, result.correlation_id);
          results.push({
            metadata_id: metadata.id,
            principal_id: metadata.principal_id,
            role: metadata.role,
            disposition: result.status,
            correlation_id: result.correlation_id,
          });
          await store.appendAudit({
            environment,
            actor_id: actorId,
            actor_name: actorName,
            action: "access_expired",
            target_id: metadata.principal_id,
            reason: metadata.reason,
            outcome: result.status,
            correlation_id: result.correlation_id,
            occurred_at: occurredAt,
            details: { role: metadata.role, source: metadata.source, metadata_id: metadata.id },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Directory change failed.";
          await store.markMetadataStatus(metadata.id, "expiry_failed", actorName, occurredAt, null);
          results.push({
            metadata_id: metadata.id,
            principal_id: metadata.principal_id,
            role: metadata.role,
            disposition: "failed",
            correlation_id: null,
            message,
          });
          await store.appendAudit({
            environment,
            actor_id: actorId,
            actor_name: actorName,
            action: "access_expiry_failed",
            target_id: metadata.principal_id,
            reason: metadata.reason,
            outcome: "failed",
            correlation_id: null,
            occurred_at: occurredAt,
            details: { role: metadata.role, source: metadata.source, metadata_id: metadata.id, error: message },
          });
        }
      }
      const response = { environment, results };
      await store.saveOperation(idempotencyKey, environment, response);
      return { status: 200, jsonBody: response };
    }

    if (request.method === "POST" && path === "changes") {
      const idempotencyKey = request.headers.get("idempotency-key")?.trim();
      if (!idempotencyKey) {
        return { status: 400, jsonBody: { error: "Idempotency-Key header is required." } };
      }

      const raw = await readJson(request);
      const changes = raw && typeof raw === "object" && Array.isArray((raw as { changes?: unknown }).changes)
        ? (raw as { changes: unknown[] }).changes
        : null;
      if (!changes || changes.length === 0 || !changes.every(isDirectoryChange)) {
        return { status: 400, jsonBody: { error: "changes must be a non-empty array of access changes." } };
      }
      const replay = await reserveOperation(
        store,
        idempotencyKey,
        environment,
        { operation: "access_changes", changes },
        true,
      );
      if (replay) return replay;
      const actor = accessAdministrator(request, allowAdminFallback)!;
      const occurredAt = now().toISOString();
      const currentPrincipals = await directory.listAccessPrincipals(environment, directoryContext(request));
      const resolvedPrincipals = await Promise.all(changes.map(async (change) => {
        const assigned = currentPrincipals.find((candidate) => candidate.id === change.principal_id);
        if (change.action === "invite_guest" || !directory.getPrincipal) return assigned;
        const authoritative = await directory.getPrincipal(change.principal_id, environment, directoryContext(request));
        return authoritative ? { ...authoritative, assignments: assigned?.assignments ?? [] } : null;
      }));
      const results: Array<Record<string, unknown>> = [];
      for (const [index, change] of changes.entries()) {
        const principal = resolvedPrincipals[index] ?? undefined;
        const errors = validateChange(change, new Date(occurredAt), principal, !!directory.getPrincipal);
        if (errors.length > 0) {
          results.push({ index, disposition: "invalid", errors });
          continue;
        }
        if (changeAlreadyApplied(change, principal)) {
          results.push({ index, disposition: "already_satisfied", correlation_id: null });
          continue;
        }
        if (change.role === "OCC.Admin" || change.role === ACCESS_ADMIN_ROLE) {
          if (!hasAuthenticationContext(actor, privilegedAuthContext)) {
            results.push({ index, disposition: "invalid", errors: ["Fresh authentication is required for privileged access changes."] });
            continue;
          }
          const pending = await store.createChange({
            environment,
            change,
            status: "pending",
            requested_by_id: actor.userId ?? actor.userDetails ?? "unknown",
            requested_by_name: actor.userDetails ?? actor.userId ?? "unknown",
            requested_at: occurredAt,
            approval_expires_at: new Date(new Date(occurredAt).valueOf() + privilegedApprovalHours * 60 * 60 * 1000).toISOString(),
            decided_by_id: null,
            decided_by_name: null,
            decided_at: null,
            result: null,
          });
          await store.appendAudit({
            environment,
            actor_id: actor.userId ?? actor.userDetails ?? "unknown",
            actor_name: actor.userDetails ?? actor.userId ?? "unknown",
            action: "privileged_change_requested",
            target_id: change.principal_id,
            reason: change.reason,
            outcome: "pending",
            correlation_id: null,
            occurred_at: occurredAt,
            details: { change_id: pending.id, role: change.role, action: change.action },
          });
          results.push({ index, disposition: "pending_approval", change_id: pending.id });
          continue;
        }
        try {
          const result = await applyDirectoryChange(change, environment, directoryContext(request), directory, store, occurredAt);
          const appliedChange: DirectoryChange = change.action === "invite_guest" && result.principal_id
            ? { ...change, action: "grant", principal_id: result.principal_id }
            : change;
          if (store.recordMetadata && result.status !== "failed") {
            const metadataChange = result.source_id ? { ...appliedChange, source_id: result.source_id } : appliedChange;
            await store.recordMetadata(metadataChange, environment, actor.userDetails ?? actor.userId ?? "unknown", occurredAt, result);
          }
          results.push({
            index,
            disposition: result.status,
            correlation_id: result.correlation_id,
            ...(result.message ? { message: result.message } : {}),
          });
          await store.appendAudit({
            environment,
            actor_id: actor.userId ?? actor.userDetails ?? "unknown",
            actor_name: actor.userDetails ?? actor.userId ?? "unknown",
            action: change.action === "grant" ? "access_grant" : change.action === "revoke" ? "access_revoke" : "guest_invitation",
            target_id: change.principal_id,
            reason: change.reason,
            outcome: result.status,
            correlation_id: result.correlation_id,
            occurred_at: occurredAt,
            details: {
              role: change.role,
              source: change.source,
              ...(change.source_id ? { source_id: change.source_id } : {}),
              principal_type: change.principal_type,
              ...(result.steps ? { steps: result.steps } : {}),
            },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Directory change failed.";
          results.push({ index, disposition: "failed", correlation_id: null, message });
          await store.appendAudit({
            environment,
            actor_id: actor.userId ?? actor.userDetails ?? "unknown",
            actor_name: actor.userDetails ?? actor.userId ?? "unknown",
            action: change.action === "grant" ? "access_grant" : change.action === "revoke" ? "access_revoke" : "guest_invitation",
            target_id: change.principal_id,
            reason: change.reason,
            outcome: "failed",
            correlation_id: null,
            occurred_at: occurredAt,
            details: { role: change.role, source: change.source, principal_type: change.principal_type, error: message },
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
