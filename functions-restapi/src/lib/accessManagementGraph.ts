import type {
  AccessDirectory,
  AccessPrincipal,
  AccessReconciliationFinding,
  AccessReconciliationReport,
  AccessRole,
  DirectoryChange,
  DirectoryChangeResult,
  DirectoryRequestContext,
  SignInInformation,
} from "./accessManagementHttp";
import { ACCESS_ADMIN_ROLE, HUMAN_ACCESS_ROLES, WORKLOAD_ACCESS_ROLE } from "./accessManagementHttp";

export interface AccessRoleConfig {
  app_role_id: string;
  group_id?: string;
}

export interface AccessEnvironmentConfig {
  environment: string;
  application_id: string;
  service_principal_id: string;
  guest_redirect_url?: string;
  roles: Partial<Record<AccessRole, AccessRoleConfig>>;
}

export type DelegatedGraphTokenProvider = (userAssertion: string) => Promise<string>;
export type GraphFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class GraphAccessError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retry_after_seconds: number | null,
  ) {
    super(message);
    this.name = "GraphAccessError";
  }
}

export class GraphAccessDirectory implements AccessDirectory {
  constructor(
    private readonly config: AccessEnvironmentConfig,
    private readonly getDelegatedToken: DelegatedGraphTokenProvider,
    private readonly fetchGraph: GraphFetch = fetch,
  ) {}

  private assertEnvironment(environment: string) {
    if (environment !== this.config.environment) {
      throw new Error(`Access environment ${environment} is not configured.`);
    }
  }

  private roleConfig(role: AccessRole): AccessRoleConfig {
    const config = this.config.roles[role];
    if (!config) throw new Error(`OnBoard role ${role} is not configured for ${this.config.environment}.`);
    return config;
  }

  private roleForAppRoleId(appRoleId: string): AccessRole | null {
    for (const [role, config] of Object.entries(this.config.roles)) {
      if (config?.app_role_id === appRoleId) return role as AccessRole;
    }
    return null;
  }

  private async request(
    path: string,
    init: RequestInit,
    context?: DirectoryRequestContext,
  ): Promise<{ response: Response; correlation_id: string | null }> {
    if (!context?.user_assertion) {
      throw new GraphAccessError("A delegated user assertion is required for Microsoft Graph.", 401, null);
    }
    const token = await this.getDelegatedToken(context.user_assertion);
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const response = await this.fetchGraph(`https://graph.microsoft.com/v1.0${path}`, { ...init, headers });
    const correlationId = response.headers.get("request-id") ?? response.headers.get("client-request-id");
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      const retryAfter = response.headers.get("retry-after");
      throw new GraphAccessError(
        payload?.error?.message ?? `Microsoft Graph request failed (${response.status}).`,
        response.status,
        retryAfter && Number.isFinite(Number(retryAfter)) ? Number(retryAfter) : null,
      );
    }
    return { response, correlation_id: correlationId };
  }

  private async listAll<T>(path: string, context?: DirectoryRequestContext): Promise<T[]> {
    const values: T[] = [];
    let next: string | null = path;
    while (next) {
      const requestPath: string = next.startsWith("https://graph.microsoft.com/v1.0")
        ? next.slice("https://graph.microsoft.com/v1.0".length)
        : next;
      const { response } = await this.request(requestPath, { method: "GET" }, context);
      const payload = await response.json() as { value?: T[]; "@odata.nextLink"?: string };
      values.push(...(payload.value ?? []));
      next = payload["@odata.nextLink"] ?? null;
    }
    return values;
  }

  private async getJson<T>(path: string, context?: DirectoryRequestContext): Promise<T> {
    const { response } = await this.request(path, { method: "GET" }, context);
    return await response.json() as T;
  }

  async getPrincipal(
    principalId: string,
    environment: string,
    context?: DirectoryRequestContext,
  ): Promise<AccessPrincipal | null> {
    this.assertEnvironment(environment);
    try {
      const object = await this.getJson<{
        "@odata.type"?: string;
        id: string;
        displayName?: string;
        userPrincipalName?: string | null;
        accountEnabled?: boolean | null;
        userType?: string | null;
        externalUserState?: string | null;
      }>(`/directoryObjects/${encodeURIComponent(principalId)}`, context);
      const principalType = object["@odata.type"] === "#microsoft.graph.user"
        ? "user"
        : object["@odata.type"] === "#microsoft.graph.group"
          ? "group"
          : object["@odata.type"] === "#microsoft.graph.servicePrincipal"
            ? "service_principal"
            : null;
      if (!principalType) return null;
      return {
        id: object.id,
        display_name: object.displayName ?? object.userPrincipalName ?? object.id,
        sign_in_name: object.userPrincipalName ?? null,
        principal_type: principalType,
        account_enabled: object.accountEnabled ?? null,
        guest_state: principalType === "user" && object.userType === "Guest"
          ? (object.externalUserState ?? "PendingAcceptance")
          : null,
        assignments: [],
      };
    } catch (error) {
      if (error instanceof GraphAccessError && error.status === 404) return null;
      throw error;
    }
  }

  async applyChange(
    change: DirectoryChange,
    environment: string,
    context?: DirectoryRequestContext,
  ): Promise<DirectoryChangeResult> {
    this.assertEnvironment(environment);
    const role = this.roleConfig(change.role);
    if (change.action === "invite_guest") {
      const invitation = await this.inviteGuest(change, environment, context);
      const invitedUserId = invitation.principal_id;
      const invitationCorrelationId = invitation.correlation_id;
      try {
        const result = await this.applyChange(
          { ...change, action: "grant", principal_id: invitedUserId },
          environment,
          context,
        );
        return {
          ...result,
          principal_id: invitedUserId,
          steps: [
            { step: "invitation", status: "completed", correlation_id: invitationCorrelationId },
            { step: "access_assignment", status: result.status, correlation_id: result.correlation_id, ...(result.message ? { message: result.message } : {}) },
          ],
        };
      } catch (error) {
        return {
          status: "failed",
          correlation_id: invitationCorrelationId,
          principal_id: invitedUserId,
          message: error instanceof Error ? `Guest was invited, but access assignment failed: ${error.message}` : "Guest was invited, but access assignment failed.",
          steps: [
            { step: "invitation", status: "completed", correlation_id: invitationCorrelationId },
            { step: "access_assignment", status: "failed", correlation_id: null },
          ],
        };
      }
    }
    if (change.source === "group") {
      if (!role.group_id) throw new Error(`OnBoard role ${change.role} has no configured access group.`);
      if (change.action === "grant") {
        const { correlation_id } = await this.request(
          `/groups/${encodeURIComponent(role.group_id)}/members/$ref`,
          {
            method: "POST",
            body: JSON.stringify({
              "@odata.id": `https://graph.microsoft.com/v1.0/directoryObjects/${change.principal_id}`,
            }),
          },
          context,
        );
        return { status: "pending_verification", correlation_id, source_id: role.group_id };
      }
      if (change.action === "revoke") {
        const sourceGroupId = change.source_id ?? role.group_id;
        if (sourceGroupId !== role.group_id) {
          const assignments = await this.listAll<{ principalId: string; appRoleId: string }>(
            `/servicePrincipals/${encodeURIComponent(this.config.service_principal_id)}/appRoleAssignedTo?$select=principalId,appRoleId`,
            context,
          );
          const isOnBoardRoleSource = assignments.some((assignment) =>
            assignment.principalId === sourceGroupId && assignment.appRoleId === role.app_role_id,
          );
          if (!isOnBoardRoleSource) {
            throw new Error("The requested group is not an OnBoard assignment source for this role.");
          }
        }
        try {
          const { correlation_id } = await this.request(
            `/groups/${encodeURIComponent(sourceGroupId)}/members/${encodeURIComponent(change.principal_id)}/$ref`,
            { method: "DELETE" },
            context,
          );
          return { status: "completed", correlation_id, source_id: sourceGroupId };
        } catch (error) {
          if (error instanceof GraphAccessError && error.status === 404) {
            return { status: "completed", correlation_id: null, source_id: sourceGroupId, message: "Access was already absent." };
          }
          throw error;
        }
      }
    }
    if (change.source === "direct" && change.action === "grant") {
      const { correlation_id } = await this.request(
        `/servicePrincipals/${encodeURIComponent(this.config.service_principal_id)}/appRoleAssignedTo`,
        {
          method: "POST",
          body: JSON.stringify({
            principalId: change.principal_id,
            resourceId: this.config.service_principal_id,
            appRoleId: role.app_role_id,
          }),
        },
        context,
      );
      return { status: "pending_verification", correlation_id };
    }
    if (change.source === "direct" && change.action === "revoke") {
      const filter = encodeURIComponent(`principalId eq '${change.principal_id.replaceAll("'", "''")}'`);
      const assignments = await this.listAll<{ id: string; principalId: string; appRoleId: string }>(
        `/servicePrincipals/${encodeURIComponent(this.config.service_principal_id)}/appRoleAssignedTo?$filter=${filter}&$select=id,principalId,appRoleId`,
        context,
      );
      const assignment = assignments.find((candidate) =>
        candidate.principalId === change.principal_id
        && candidate.appRoleId === role.app_role_id
        && (!change.source_id || candidate.id === change.source_id),
      );
      if (!assignment) return { status: "completed", correlation_id: null, message: "Access was already absent." };
      const { correlation_id } = await this.request(
        `/servicePrincipals/${encodeURIComponent(this.config.service_principal_id)}/appRoleAssignedTo/${encodeURIComponent(assignment.id)}`,
        { method: "DELETE" },
        context,
      );
      return { status: "completed", correlation_id };
    }
    throw new Error("This directory change is not implemented yet.");
  }

  async inviteGuest(
    change: DirectoryChange,
    environment: string,
    context?: DirectoryRequestContext,
  ): Promise<{ principal_id: string; correlation_id: string | null }> {
    this.assertEnvironment(environment);
    if (!this.config.guest_redirect_url) throw new Error("Guest invitation redirect URL is not configured.");
    const { response, correlation_id } = await this.request(
      "/invitations",
      {
        method: "POST",
        body: JSON.stringify({
          invitedUserEmailAddress: change.principal_id,
          inviteRedirectUrl: this.config.guest_redirect_url,
          sendInvitationMessage: true,
        }),
      },
      context,
    );
    const invitation = await response.json() as { invitedUser?: { id?: string } };
    const principalId = invitation.invitedUser?.id;
    if (!principalId) throw new GraphAccessError("Microsoft Graph did not return the invited guest identity.", 502, null);
    return { principal_id: principalId, correlation_id };
  }

  async findGuestByEmail(
    email: string,
    environment: string,
    context?: DirectoryRequestContext,
  ): Promise<{ principal_id: string } | null> {
    this.assertEnvironment(environment);
    const escaped = email.replaceAll("'", "''");
    const filter = encodeURIComponent(`mail eq '${escaped}' and userType eq 'Guest'`);
    const users = await this.listAll<{ id: string }>(
      `/users?$filter=${filter}&$top=2&$select=id`,
      context,
    );
    return users[0] ? { principal_id: users[0].id } : null;
  }

  async listAccessPrincipals(environment: string, context?: DirectoryRequestContext): Promise<AccessPrincipal[]> {
    this.assertEnvironment(environment);
    type Assignment = {
      id: string;
      principalId: string;
      principalDisplayName: string;
      principalType: "User" | "Group" | "ServicePrincipal";
      appRoleId: string;
    };
    type DirectoryObject = {
      "@odata.type"?: string;
      id: string;
      displayName?: string;
      userPrincipalName?: string | null;
      accountEnabled?: boolean | null;
      userType?: string | null;
      externalUserState?: string | null;
    };
    const assignments = await this.listAll<Assignment>(
      `/servicePrincipals/${encodeURIComponent(this.config.service_principal_id)}/appRoleAssignedTo?$select=id,principalId,principalDisplayName,principalType,appRoleId`,
      context,
    );
    const principals = new Map<string, AccessPrincipal>();
    const addAssignment = (principal: AccessPrincipal, assignment: AccessPrincipal["assignments"][number]) => {
      const existing = principals.get(principal.id) ?? principal;
      if (!existing.assignments.some((candidate) =>
        candidate.role === assignment.role
        && candidate.source === assignment.source
        && candidate.source_id === assignment.source_id)) {
        existing.assignments.push(assignment);
      }
      principals.set(existing.id, existing);
    };

    for (const assignment of assignments) {
      const role = this.roleForAppRoleId(assignment.appRoleId);
      if (!role) continue;
      if (assignment.principalType === "Group") {
        addAssignment({
          id: assignment.principalId,
          display_name: assignment.principalDisplayName,
          sign_in_name: null,
          principal_type: "group",
          account_enabled: null,
          guest_state: null,
          assignments: [],
        }, {
          role,
          source: "direct",
          source_id: assignment.id,
          source_name: "Enterprise application assignment",
        });
        let members: DirectoryObject[];
        try {
          members = await this.listAll<DirectoryObject>(
            `/groups/${encodeURIComponent(assignment.principalId)}/members?$select=id,displayName,userPrincipalName,accountEnabled,userType,externalUserState`,
            context,
          );
        } catch (error) {
          if (!(error instanceof GraphAccessError) || error.status !== 404) throw error;
          const missing = principals.get(assignment.principalId);
          if (missing) missing.directory_status = "missing";
          continue;
        }
        for (const member of members) {
          if (member["@odata.type"] && member["@odata.type"] !== "#microsoft.graph.user") continue;
          addAssignment({
            id: member.id,
            display_name: member.displayName ?? member.userPrincipalName ?? member.id,
            sign_in_name: member.userPrincipalName ?? null,
            principal_type: "user",
            account_enabled: member.accountEnabled ?? null,
            guest_state: member.userType === "Guest" ? (member.externalUserState ?? "PendingAcceptance") : null,
            assignments: [],
          }, {
            role,
            source: "group",
            source_id: assignment.principalId,
            source_name: assignment.principalDisplayName,
          });
        }
        continue;
      }

      let object: DirectoryObject;
      try {
        object = assignment.principalType === "User"
          ? await this.getJson<DirectoryObject>(
            `/users/${encodeURIComponent(assignment.principalId)}?$select=id,displayName,userPrincipalName,accountEnabled,userType,externalUserState`,
            context,
          )
          : await this.getJson<DirectoryObject>(
            `/servicePrincipals/${encodeURIComponent(assignment.principalId)}?$select=id,displayName,accountEnabled`,
            context,
          );
      } catch (error) {
        if (!(error instanceof GraphAccessError) || error.status !== 404) throw error;
        addAssignment({
          id: assignment.principalId,
          display_name: assignment.principalDisplayName || `[Missing ${assignment.principalType}]`,
          sign_in_name: null,
          principal_type: assignment.principalType === "User" ? "user" : "service_principal",
          account_enabled: null,
          guest_state: null,
          directory_status: "missing",
          assignments: [],
        }, {
          role,
          source: "direct",
          source_id: assignment.id,
          source_name: "Enterprise application assignment",
        });
        continue;
      }
      addAssignment({
        id: object.id,
        display_name: object.displayName ?? assignment.principalDisplayName,
        sign_in_name: object.userPrincipalName ?? null,
        principal_type: assignment.principalType === "User" ? "user" : "service_principal",
        account_enabled: object.accountEnabled ?? null,
        guest_state: assignment.principalType === "User" && object.userType === "Guest"
          ? (object.externalUserState ?? "PendingAcceptance")
          : null,
        assignments: [],
      }, {
        role,
        source: "direct",
        source_id: assignment.id,
        source_name: "Enterprise application assignment",
      });
    }
    return [...principals.values()].sort((left, right) => left.display_name.localeCompare(right.display_name));
  }

  async searchPrincipals(query: string, environment: string, context?: DirectoryRequestContext): Promise<AccessPrincipal[]> {
    this.assertEnvironment(environment);
    const escaped = query.replaceAll("'", "''");
    const userFilter = encodeURIComponent(
      `startsWith(displayName,'${escaped}') or startsWith(userPrincipalName,'${escaped}') or mail eq '${escaped}'`,
    );
    const groupFilter = encodeURIComponent(`startsWith(displayName,'${escaped}')`);
    const [users, groups, servicePrincipals] = await Promise.all([
      this.listAll<{
        id: string;
        displayName?: string;
        userPrincipalName?: string | null;
        accountEnabled?: boolean | null;
        userType?: string | null;
        externalUserState?: string | null;
      }>(`/users?$filter=${userFilter}&$top=25&$select=id,displayName,userPrincipalName,accountEnabled,userType,externalUserState`, context),
      this.listAll<{ id: string; displayName?: string }>(
        `/groups?$filter=${groupFilter}&$top=25&$select=id,displayName`,
        context,
      ),
      this.listAll<{ id: string; displayName?: string; accountEnabled?: boolean | null }>(
        `/servicePrincipals?$filter=${groupFilter}&$top=25&$select=id,displayName,accountEnabled`,
        context,
      ),
    ]);
    return [
      ...users.map((user): AccessPrincipal => ({
        id: user.id,
        display_name: user.displayName ?? user.userPrincipalName ?? user.id,
        sign_in_name: user.userPrincipalName ?? null,
        principal_type: "user",
        account_enabled: user.accountEnabled ?? null,
        guest_state: user.userType === "Guest" ? (user.externalUserState ?? "PendingAcceptance") : null,
        assignments: [],
      })),
      ...groups.map((group): AccessPrincipal => ({
        id: group.id,
        display_name: group.displayName ?? group.id,
        sign_in_name: null,
        principal_type: "group",
        account_enabled: null,
        guest_state: null,
        assignments: [],
      })),
      ...servicePrincipals
        .filter((principal) => principal.id !== this.config.service_principal_id)
        .map((principal): AccessPrincipal => ({
          id: principal.id,
          display_name: principal.displayName ?? principal.id,
          sign_in_name: null,
          principal_type: "service_principal",
          account_enabled: principal.accountEnabled ?? null,
          guest_state: null,
          assignments: [],
        })),
    ].sort((left, right) => left.display_name.localeCompare(right.display_name));
  }

  async getSignIns(principalId: string, environment: string, context?: DirectoryRequestContext): Promise<SignInInformation> {
    this.assertEnvironment(environment);
    const user = await this.getJson<{
      signInActivity?: {
        lastSuccessfulSignInDateTime?: string | null;
        lastSignInDateTime?: string | null;
        lastNonInteractiveSignInDateTime?: string | null;
      } | null;
    }>(`/users/${encodeURIComponent(principalId)}?$select=signInActivity`, context);
    const filter = encodeURIComponent(`userId eq '${principalId.replaceAll("'", "''")}' and appId eq '${this.config.application_id.replaceAll("'", "''")}'`);
    const events = await this.listAll<{
      createdDateTime: string;
      status?: { errorCode?: number };
      clientAppUsed?: string | null;
      correlationId?: string | null;
    }>(`/auditLogs/signIns?$filter=${filter}&$top=20&$orderby=createdDateTime desc&$select=createdDateTime,status,clientAppUsed,correlationId`, context);
    const activity = user.signInActivity;
    return {
      summary: activity ? {
        last_successful_at: activity.lastSuccessfulSignInDateTime ?? null,
        last_interactive_attempt_at: activity.lastSignInDateTime ?? null,
        last_noninteractive_at: activity.lastNonInteractiveSignInDateTime ?? null,
      } : null,
      events: events.map((event) => ({
        occurred_at: event.createdDateTime,
        successful: event.status?.errorCode === 0,
        client_app: event.clientAppUsed ?? null,
        correlation_id: event.correlationId ?? null,
      })),
    };
  }

  async reconcileAccess(environment: string, context?: DirectoryRequestContext): Promise<AccessReconciliationReport> {
    this.assertEnvironment(environment);
    const findings: AccessReconciliationFinding[] = [];
    const expectedRoles: AccessRole[] = [...HUMAN_ACCESS_ROLES, ACCESS_ADMIN_ROLE, WORKLOAD_ACCESS_ROLE];
    const configuredIds = new Map<string, AccessRole>();
    for (const role of expectedRoles) {
      const roleConfig = this.config.roles[role];
      if (!roleConfig) {
        findings.push({
          code: "role_not_configured",
          severity: "error",
          role,
          message: `${role} is missing from the ${environment} Access Management configuration.`,
        });
        continue;
      }
      const duplicate = configuredIds.get(roleConfig.app_role_id);
      if (duplicate) {
        findings.push({
          code: "duplicate_app_role_mapping",
          severity: "error",
          role,
          message: `${role} and ${duplicate} map to the same Entra app-role identifier.`,
        });
      } else {
        configuredIds.set(roleConfig.app_role_id, role);
      }
      if (role !== WORKLOAD_ACCESS_ROLE && !roleConfig.group_id) {
        findings.push({
          code: "role_group_not_configured",
          severity: "error",
          role,
          message: `${role} has no configured group-first assignment target.`,
        });
      }
    }

    const principals = await this.listAccessPrincipals(environment, context);
    for (const role of expectedRoles) {
      const groupId = this.config.roles[role]?.group_id;
      if (!groupId) continue;
      const assigned = principals.some((principal) =>
        principal.id === groupId
        && principal.principal_type === "group"
        && principal.assignments.some((assignment) => assignment.role === role && assignment.source === "direct"),
      );
      if (!assigned) {
        findings.push({
          code: "missing_role_group_assignment",
          severity: "error",
          principal_id: groupId,
          role,
          message: `Configured group ${groupId} is not assigned to ${role} on the OnBoard enterprise application.`,
          repair_change: {
            action: "grant",
            principal_id: groupId,
            principal_type: "group",
            role,
            source: "direct",
            reason: "Repair configured role-group assignment",
          },
        });
      }
    }

    for (const principal of principals) {
      if (principal.directory_status === "missing") {
        findings.push({
          code: "missing_directory_object",
          severity: "error",
          principal_id: principal.id,
          message: `${principal.display_name} has an OnBoard assignment but the directory object is missing.`,
        });
      }
      for (const assignment of principal.assignments) {
        if (principal.principal_type === "service_principal" && assignment.role !== WORKLOAD_ACCESS_ROLE) {
          findings.push({
            code: "workload_has_human_role",
            severity: "error",
            principal_id: principal.id,
            role: assignment.role,
            message: `${principal.display_name} is a workload identity with human role ${assignment.role}.`,
            repair_change: {
              action: "revoke",
              principal_id: principal.id,
              principal_type: "service_principal",
              role: assignment.role,
              source: assignment.source,
              reason: "Repair workload/human role conflict",
            },
          });
        }
        if (principal.principal_type !== "service_principal" && assignment.role === WORKLOAD_ACCESS_ROLE) {
          findings.push({
            code: "human_has_ingestion_role",
            severity: "error",
            principal_id: principal.id,
            role: assignment.role,
            message: `${principal.display_name} is not a workload identity but has System.Ingestion.`,
            repair_change: {
              action: "revoke",
              principal_id: principal.id,
              principal_type: principal.principal_type,
              role: assignment.role,
              source: assignment.source,
              reason: "Repair human/workload role conflict",
            },
          });
        }
        if (principal.principal_type === "user" && assignment.source === "direct") {
          findings.push({
            code: "direct_human_assignment",
            severity: "warning",
            principal_id: principal.id,
            role: assignment.role,
            message: `${principal.display_name} has direct ${assignment.role} access that requires documented exception metadata.`,
          });
        }
      }
    }
    return { environment, observed_at: new Date().toISOString(), findings };
  }
}
