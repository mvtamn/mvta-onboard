import assert from "node:assert/strict";
import test from "node:test";
import { GraphAccessDirectory, type AccessEnvironmentConfig } from "./accessManagementGraph";

const config: AccessEnvironmentConfig = {
  environment: "test",
  application_id: "app-client-id",
  service_principal_id: "onboard-sp",
  guest_redirect_url: "https://onboard.example.test/",
  roles: {
    "OCC.Viewer": { app_role_id: "role-viewer", group_id: "group-viewers" },
    "OCC.Detour": { app_role_id: "role-detour", group_id: "group-detour" },
    "System.Ingestion": { app_role_id: "role-ingestion" },
  },
};

test("group access revocation deletes only the membership reference", async () => {
  const requests: Array<{ url: string; method: string }> = [];
  const directory = new GraphAccessDirectory(
    config,
    async (assertion) => {
      assert.equal(assertion, "api-access-token");
      return "graph-access-token";
    },
    async (input, init) => {
      requests.push({ url: String(input), method: init?.method ?? "GET" });
      return new Response(null, { status: 204, headers: { "request-id": "graph-request-1" } });
    },
  );

  const result = await directory.applyChange({
    action: "revoke",
    principal_id: "user-1",
    principal_type: "user",
    role: "OCC.Detour",
    source: "group",
    source_id: "group-detour",
    reason: "Coverage ended",
  }, "test", { user_assertion: "api-access-token" });

  assert.deepEqual(requests, [{
    url: "https://graph.microsoft.com/v1.0/groups/group-detour/members/user-1/$ref",
    method: "DELETE",
  }]);
  assert.deepEqual(result, { status: "completed", correlation_id: "graph-request-1", source_id: "group-detour" });
});

test("group revocation removes the exact OnBoard-assigned source group", async () => {
  const requests: Array<{ url: string; method: string }> = [];
  const directory = new GraphAccessDirectory(
    config,
    async () => "graph-access-token",
    async (input, init) => {
      const request = { url: decodeURIComponent(String(input)), method: init?.method ?? "GET" };
      requests.push(request);
      if (request.method === "GET") {
        return Response.json({ value: [
          { principalId: "legacy-detour-group", appRoleId: "role-detour" },
        ] });
      }
      return new Response(null, { status: 204, headers: { "request-id": "legacy-revoke-1" } });
    },
  );

  const result = await directory.applyChange({
    action: "revoke",
    principal_id: "user-1",
    principal_type: "user",
    role: "OCC.Detour",
    source: "group",
    source_id: "legacy-detour-group",
    reason: "Remove legacy source",
  }, "test", { user_assertion: "api-token" });

  assert.equal(requests[1]?.url, "https://graph.microsoft.com/v1.0/groups/legacy-detour-group/members/user-1/$ref");
  assert.deepEqual(result, { status: "completed", correlation_id: "legacy-revoke-1", source_id: "legacy-detour-group" });
});

test("group access grant posts a directory reference and awaits verification", async () => {
  let request: { url: string; method: string; body: string | null } | null = null;
  const directory = new GraphAccessDirectory(
    config,
    async () => "graph-access-token",
    async (input, init) => {
      request = { url: String(input), method: init?.method ?? "GET", body: String(init?.body ?? "") || null };
      return new Response(null, { status: 204, headers: { "request-id": "graph-request-2" } });
    },
  );

  const result = await directory.applyChange({
    action: "grant",
    principal_id: "user-1",
    principal_type: "user",
    role: "OCC.Detour",
    source: "group",
    reason: "Detour coverage",
  }, "test", { user_assertion: "api-token" });

  assert.deepEqual(request, {
    url: "https://graph.microsoft.com/v1.0/groups/group-detour/members/$ref",
    method: "POST",
    body: JSON.stringify({ "@odata.id": "https://graph.microsoft.com/v1.0/directoryObjects/user-1" }),
  });
  assert.deepEqual(result, { status: "pending_verification", correlation_id: "graph-request-2", source_id: "group-detour" });
});

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

test("direct access grant is scoped to the configured OnBoard service principal and app role", async () => {
  let requestBody: unknown = null;
  const directory = new GraphAccessDirectory(
    config,
    async () => "graph-access-token",
    async (input, init) => {
      assert.equal(String(input), "https://graph.microsoft.com/v1.0/servicePrincipals/onboard-sp/appRoleAssignedTo");
      requestBody = JSON.parse(String(init?.body));
      return Response.json({ id: "assignment-1" }, { status: 201, headers: { "request-id": "graph-request-3" } });
    },
  );

  const result = await directory.applyChange({
    action: "grant",
    principal_id: "user-1",
    principal_type: "user",
    role: "OCC.Detour",
    source: "direct",
    reason: "Audited exception",
  }, "test", { user_assertion: "api-token" });

  assert.deepEqual(requestBody, {
    principalId: "user-1",
    resourceId: "onboard-sp",
    appRoleId: "role-detour",
  });
  assert.deepEqual(result, { status: "pending_verification", correlation_id: "graph-request-3" });
});

test("direct access revocation deletes the matching app-role assignment", async () => {
  const requests: Array<{ url: string; method: string }> = [];
  const directory = new GraphAccessDirectory(
    config,
    async () => "graph-access-token",
    async (input, init) => {
      const request = { url: decodeURIComponent(String(input)), method: init?.method ?? "GET" };
      requests.push(request);
      if (request.method === "GET") {
        return Response.json({ value: [
          { id: "assignment-other", principalId: "user-1", appRoleId: "role-viewer" },
          { id: "assignment-detour", principalId: "user-1", appRoleId: "role-detour" },
        ] });
      }
      return new Response(null, { status: 204, headers: { "request-id": "graph-request-4" } });
    },
  );

  const result = await directory.applyChange({
    action: "revoke",
    principal_id: "user-1",
    principal_type: "user",
    role: "OCC.Detour",
    source: "direct",
    reason: "Exception ended",
  }, "test", { user_assertion: "api-token" });

  assert.equal(requests[1]?.url, "https://graph.microsoft.com/v1.0/servicePrincipals/onboard-sp/appRoleAssignedTo/assignment-detour");
  assert.equal(requests[1]?.method, "DELETE");
  assert.deepEqual(result, { status: "completed", correlation_id: "graph-request-4" });
});

test("guest onboarding creates a B2B invitation before adding OnBoard group access", async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const directory = new GraphAccessDirectory(
    config,
    async () => "graph-access-token",
    async (input, init) => {
      requests.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
      if (String(input).endsWith("/invitations")) {
        return Response.json({ invitedUser: { id: "guest-user-1" } }, { status: 201, headers: { "request-id": "invite-1" } });
      }
      return new Response(null, { status: 204, headers: { "request-id": "membership-1" } });
    },
  );

  const result = await directory.applyChange({
    action: "invite_guest",
    principal_id: "contractor@example.com",
    principal_type: "user",
    role: "OCC.Viewer",
    source: "group",
    reason: "Project access",
    sponsor: "sponsor@mvta.com",
    organization: "Example Contractor",
    expires_at: "2026-09-01T00:00:00Z",
  }, "test", { user_assertion: "api-token" });

  assert.deepEqual(requests, [
    {
      url: "https://graph.microsoft.com/v1.0/invitations",
      body: {
        invitedUserEmailAddress: "contractor@example.com",
        inviteRedirectUrl: "https://onboard.example.test/",
        sendInvitationMessage: true,
      },
    },
    {
      url: "https://graph.microsoft.com/v1.0/groups/group-viewers/members/$ref",
      body: { "@odata.id": "https://graph.microsoft.com/v1.0/directoryObjects/guest-user-1" },
    },
  ]);
  assert.deepEqual(result, {
    status: "pending_verification",
    correlation_id: "membership-1",
    principal_id: "guest-user-1",
    source_id: "group-viewers",
    steps: [
      { step: "invitation", status: "completed", correlation_id: "invite-1" },
      { step: "access_assignment", status: "pending_verification", correlation_id: "membership-1" },
    ],
  });
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

test("directory listing retains a missing assigned object for reconciliation", async () => {
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
