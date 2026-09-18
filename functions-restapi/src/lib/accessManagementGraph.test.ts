import assert from "node:assert/strict";
import test from "node:test";
import { GraphAccessDirectory, type AccessEnvironmentConfig } from "./accessManagementGraph";

const config: AccessEnvironmentConfig = {
  environment: "test",
  application_id: "app-client-id",
  service_principal_id: "onboard-sp",
  guest_redirect_url: "https://onboard.example.test/",
  roles: {
    "OCC.Viewer": { app_role_id: "role-viewer" },
    "OCC.Detour": { app_role_id: "role-detour" },
    "System.Ingestion": { app_role_id: "role-ingestion" },
  },
};

test("guest recovery looks up an existing Entra guest by exact email", async () => {
  let requestedUrl = "";
  const directory = new GraphAccessDirectory(
    config,
    async () => "graph-access-token",
    async (input) => {
      requestedUrl = decodeURIComponent(String(input));
      return Response.json({ value: [{ id: "existing-guest" }] });
    },
  );

  const result = await directory.findGuestByEmail("guest@example.com", "test", { user_assertion: "api-token" });

  assert.match(requestedUrl, /mail eq 'guest@example.com' and userType eq 'Guest'/);
  assert.deepEqual(result, { principal_id: "existing-guest" });
});

test("a guest invitation writes the invitation and nothing else", async () => {
  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  const directory = new GraphAccessDirectory(
    config,
    async () => "graph-access-token",
    async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return Response.json({ invitedUser: { id: "guest-user-1" } }, { status: 201, headers: { "request-id": "invite-1" } });
    },
  );

  const result = await directory.inviteGuest({
    action: "invite_guest",
    principal_id: "contractor@example.com",
    principal_type: "user",
    reason: "Project access",
    sponsor: "sponsor@mvta.com",
    organization: "Example Contractor",
    expires_at: "2026-09-01T00:00:00Z",
  }, "test", { user_assertion: "api-token" });

  // One call, and it is the invitation: no appRoleAssignedTo POST and no group
  // membership reference, because the role is an OnBoard Role Grant now.
  assert.deepEqual(requests, [{
    url: "https://graph.microsoft.com/v1.0/invitations",
    method: "POST",
    body: {
      invitedUserEmailAddress: "contractor@example.com",
      inviteRedirectUrl: "https://onboard.example.test/",
      sendInvitationMessage: true,
    },
  }]);
  assert.deepEqual(result, { principal_id: "guest-user-1", correlation_id: "invite-1" });
});

test("directory listing distinguishes direct assignments from direct group membership", async () => {
  const directory = new GraphAccessDirectory(
    config,
    async () => "graph-access-token",
    async (input) => {
      const url = String(input);
      if (url.includes("/servicePrincipals/onboard-sp/appRoleAssignedTo")) {
        return Response.json({ value: [
          { id: "assign-group", principalId: "group-viewers", principalDisplayName: "OnBoard Viewers", principalType: "Group", appRoleId: "role-viewer" },
          { id: "assign-workload", principalId: "workload-1", principalDisplayName: "Delay Ingestion", principalType: "ServicePrincipal", appRoleId: "role-ingestion" },
        ] });
      }
      if (url.includes("/groups/group-viewers/members")) {
        return Response.json({ value: [{
          "@odata.type": "#microsoft.graph.user",
          id: "user-1",
          displayName: "Taylor Operator",
          userPrincipalName: "taylor@mvta.com",
          accountEnabled: true,
          userType: "Member",
          externalUserState: null,
        }] });
      }
      if (url.includes("/servicePrincipals/workload-1")) {
        return Response.json({ id: "workload-1", displayName: "Delay Ingestion", accountEnabled: true });
      }
      throw new Error(`Unexpected Graph request: ${url}`);
    },
  );

  const principals = await directory.listAccessPrincipals("test", { user_assertion: "api-token" });

  assert.deepEqual(principals, [
    {
      id: "workload-1",
      display_name: "Delay Ingestion",
      sign_in_name: null,
      principal_type: "service_principal",
      account_enabled: true,
      guest_state: null,
      assignments: [{
        role: "System.Ingestion",
        source: "direct",
        source_id: "assign-workload",
        source_name: "Enterprise application assignment",
      }],
    },
    {
      id: "group-viewers",
      display_name: "OnBoard Viewers",
      sign_in_name: null,
      principal_type: "group",
      account_enabled: null,
      guest_state: null,
      assignments: [{
        role: "OCC.Viewer",
        source: "direct",
        source_id: "assign-group",
        source_name: "Enterprise application assignment",
      }],
    },
    {
      id: "user-1",
      display_name: "Taylor Operator",
      sign_in_name: "taylor@mvta.com",
      principal_type: "user",
      account_enabled: true,
      guest_state: null,
      assignments: [{
        role: "OCC.Viewer",
        source: "group",
        source_id: "group-viewers",
        source_name: "OnBoard Viewers",
      }],
    },
  ]);
});

test("directory listing retains a missing assigned object rather than dropping it", async () => {
  const directory = new GraphAccessDirectory(
    config,
    async () => "graph-access-token",
    async (input) => {
      const url = String(input);
      if (url.includes("/servicePrincipals/onboard-sp/appRoleAssignedTo")) {
        return Response.json({ value: [{
          id: "orphan-assignment",
          principalId: "deleted-user",
          principalDisplayName: "Former Operator",
          principalType: "User",
          appRoleId: "role-viewer",
        }] });
      }
      return Response.json({ error: { message: "Object not found" } }, { status: 404 });
    },
  );

  const principals = await directory.listAccessPrincipals("test", { user_assertion: "api-token" });

  assert.equal(principals[0]?.id, "deleted-user");
  assert.equal(principals[0]?.directory_status, "missing");
  assert.equal(principals[0]?.assignments[0]?.source_id, "orphan-assignment");
});
test("sign-in lookup keeps directory summary separate from OnBoard-filtered events", async () => {
  const requestedUrls: string[] = [];
  const directory = new GraphAccessDirectory(
    config,
    async () => "graph-access-token",
    async (input) => {
      const url = String(input);
      requestedUrls.push(decodeURIComponent(url));
      if (url.includes("/users/user-1")) {
        return Response.json({ signInActivity: {
          lastSuccessfulSignInDateTime: "2026-08-14T10:00:00Z",
          lastSignInDateTime: "2026-08-14T10:00:00Z",
          lastNonInteractiveSignInDateTime: "2026-08-14T11:30:00Z",
        } });
      }
      if (url.includes("/auditLogs/signIns")) {
        return Response.json({ value: [{
          createdDateTime: "2026-08-14T10:00:00Z",
          status: { errorCode: 0 },
          clientAppUsed: "Browser",
          correlationId: "signin-1",
          ipAddress: "192.0.2.10",
        }] });
      }
      throw new Error(`Unexpected Graph request: ${url}`);
    },
  );

  const signIns = await directory.getSignIns("user-1", "test", { user_assertion: "api-token" });

  assert.ok(requestedUrls.some((url) => url.includes("appId eq 'app-client-id'")));
  assert.deepEqual(signIns, {
    summary: {
      last_successful_at: "2026-08-14T10:00:00Z",
      last_interactive_attempt_at: "2026-08-14T10:00:00Z",
      last_noninteractive_at: "2026-08-14T11:30:00Z",
    },
    events: [{
      occurred_at: "2026-08-14T10:00:00Z",
      successful: true,
      client_app: "Browser",
      correlation_id: "signin-1",
    }],
  });
});
