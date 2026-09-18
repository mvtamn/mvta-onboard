import assert from "node:assert/strict";
import test from "node:test";
import { HttpRequest } from "@azure/functions";
import { fakeAccessDb, type FakeGrant } from "./access/testSupport";
import {
  ACCESS_GRANTED_IN_ONBOARD,
  createAccessManagementHttpHandler,
  type AccessDirectory,
  type AccessManagementStore,
} from "./accessManagementHttp";

function principalHeader(
  roles: string[],
  userId = "actor-1",
  userDetails = "alex@mvta.com",
) {
  return Buffer.from(JSON.stringify({
    userId,
    userDetails,
    claims: roles.map((role) => ({ typ: "roles", val: role })),
  })).toString("base64");
}

// Since the cutover the token says who the caller is and nothing about what
// they may do, so each case states what the actor holds as an OnBoard grant.
function holding(...roleKeys: string[]) {
  return { executor: fakeAccessDb(roleKeys.map((roleKey): FakeGrant => ({ objectId: "actor-1", roleKey }))) };
}

const accessAdmin = { "x-ms-client-principal": principalHeader([]) };

const emptyStore: AccessManagementStore = {
  appendAudit: async () => undefined,
  listAudit: async () => [],
  getOperation: async () => null,
  saveOperation: async () => undefined,
};

const inertDirectory: AccessDirectory = {
  listAccessPrincipals: async () => [],
  searchPrincipals: async () => [],
  getSignIns: async () => ({ summary: null, events: [] }),
  inviteGuest: async () => { throw new Error("must not invite"); },
};

const guestInvitation = {
  action: "invite_guest" as const,
  principal_id: "guest@example.com",
  principal_type: "user" as const,
  reason: "Sponsored project access",
  sponsor: "sponsor@mvta.com",
  organization: "Example Contractor",
  expires_at: "2026-09-01T00:00:00.000Z",
};

test("an Access Administrator can list effective OnBoard access", async () => {
  const directory: AccessDirectory = {
    ...inertDirectory,
    listAccessPrincipals: async () => [{
      id: "user-1",
      display_name: "Taylor Operator",
      sign_in_name: "taylor@mvta.com",
      principal_type: "user",
      account_enabled: true,
      guest_state: null,
      assignments: [{ role: "OCC.Viewer", source: "group", source_id: "group-viewers", source_name: "OnBoard Viewers" }],
    }],
  };
  const handler = createAccessManagementHttpHandler({
    directory,
    store: emptyStore,
    environment: "test",
    now: () => new Date("2026-08-14T12:00:00.000Z"),
    accessLookup: holding("access-administrator"),
  });

  const response = await handler(new HttpRequest({
    method: "GET",
    url: "https://example.test/api/admin/access-management/principals",
    headers: accessAdmin,
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(response.jsonBody, {
    environment: "test",
    principals: [{
      id: "user-1",
      display_name: "Taylor Operator",
      sign_in_name: "taylor@mvta.com",
      principal_type: "user",
      account_enabled: true,
      guest_state: null,
      assignments: [{ role: "OCC.Viewer", source: "group", source_id: "group-viewers", source_name: "OnBoard Viewers" }],
      effective_roles: ["OCC.Viewer"],
    }],
  });
});

test("a System Administrator is refused: managing access is its own authority", async () => {
  const directory: AccessDirectory = {
    ...inertDirectory,
    listAccessPrincipals: async () => { throw new Error("must not query the directory"); },
  };
  const handler = createAccessManagementHttpHandler({
    directory,
    store: emptyStore,
    environment: "production",
    accessLookup: holding("system-administrator"),
  });

  const response = await handler(new HttpRequest({
    method: "GET",
    url: "https://example.test/api/admin/access-management/principals",
    headers: accessAdmin,
  }));

  assert.equal(response.status, 403);
});

test("a person holding no OnBoard role at all is refused", async () => {
  const directory: AccessDirectory = {
    ...inertDirectory,
    listAccessPrincipals: async () => { throw new Error("must not query the directory"); },
  };
  const handler = createAccessManagementHttpHandler({
    directory,
    store: emptyStore,
    environment: "test",
    accessLookup: holding(),
  });

  const response = await handler(new HttpRequest({
    method: "GET",
    url: "https://example.test/api/admin/access-management/principals",
    headers: accessAdmin,
  }));

  assert.equal(response.status, 403);
});

test("an unauthenticated caller is told so rather than refused for a missing role", async () => {
  const handler = createAccessManagementHttpHandler({
    directory: inertDirectory,
    store: emptyStore,
    environment: "test",
    accessLookup: holding("access-administrator"),
  });

  const response = await handler(new HttpRequest({
    method: "GET",
    url: "https://example.test/api/admin/access-management/principals",
  }));

  assert.equal(response.status, 401);
});

test("a workload identity holds no Access Management authority", async () => {
  const directory: AccessDirectory = {
    ...inertDirectory,
    listAccessPrincipals: async () => { throw new Error("must not query the directory"); },
  };
  const handler = createAccessManagementHttpHandler({
    directory,
    store: emptyStore,
    environment: "test",
    accessLookup: holding("access-administrator"),
  });

  const response = await handler(new HttpRequest({
    method: "GET",
    url: "https://example.test/api/admin/access-management/principals",
    headers: { "x-ms-client-principal": principalHeader(["System.Ingestion"]) },
  }));

  assert.equal(response.status, 403);
});

test("granting a role through Entra is refused and says where the work moved", async () => {
  let invited = false;
  const directory: AccessDirectory = {
    ...inertDirectory,
    inviteGuest: async () => { invited = true; throw new Error("must not reach Entra"); },
  };
  const handler = createAccessManagementHttpHandler({
    directory,
    store: emptyStore,
    environment: "test",
    accessLookup: holding("access-administrator"),
  });

  const response = await handler(new HttpRequest({
    method: "POST",
    url: "https://example.test/api/admin/access-management/changes",
    headers: { ...accessAdmin, "idempotency-key": "legacy-grant" },
    body: { string: JSON.stringify({ changes: [{
      action: "grant",
      principal_id: "user-1",
      principal_type: "user",
      role: "OCC.Viewer",
      source: "group",
      reason: "Duty manager",
    }] }) },
  }));

  assert.equal(response.status, 400);
  assert.deepEqual(response.jsonBody, { error: ACCESS_GRANTED_IN_ONBOARD });
  assert.equal(invited, false);
});

test("a batch mixing a revoke with an invitation is refused whole, not half-carried-out", async () => {
  let invitations = 0;
  const directory: AccessDirectory = {
    ...inertDirectory,
    inviteGuest: async () => { invitations += 1; return { principal_id: "guest-1", correlation_id: null }; },
  };
  const handler = createAccessManagementHttpHandler({
    directory,
    store: emptyStore,
    environment: "test",
    accessLookup: holding("access-administrator"),
  });

  const response = await handler(new HttpRequest({
    method: "POST",
    url: "https://example.test/api/admin/access-management/changes",
    headers: { ...accessAdmin, "idempotency-key": "mixed-batch" },
    body: { string: JSON.stringify({ changes: [
      guestInvitation,
      { action: "revoke", principal_id: "user-1", principal_type: "user", role: "OCC.Viewer", source: "group", source_id: "group-viewers", reason: "Left the agency" },
    ] }) },
  }));

  assert.equal(response.status, 400);
  assert.deepEqual(response.jsonBody, { error: ACCESS_GRANTED_IN_ONBOARD });
  assert.equal(invitations, 0);
});

test("the retired decision route is gone", async () => {
  const handler = createAccessManagementHttpHandler({
    directory: inertDirectory,
    store: emptyStore,
    environment: "test",
    accessLookup: holding("access-administrator"),
  });

  const response = await handler(new HttpRequest({
    method: "POST",
    url: "https://example.test/api/admin/access-management/changes/change-1/decision",
    headers: { ...accessAdmin, "idempotency-key": "decide" },
    body: { string: JSON.stringify({ decision: "approved" }) },
  }));

  assert.equal(response.status, 404);
});

test("a guest invitation preview names every missing sponsorship detail", async () => {
  const handler = createAccessManagementHttpHandler({
    directory: inertDirectory,
    store: emptyStore,
    environment: "test",
    now: () => new Date("2026-08-14T12:00:00.000Z"),
    accessLookup: holding("access-administrator"),
  });

  const response = await handler(new HttpRequest({
    method: "POST",
    url: "https://example.test/api/admin/access-management/changes/preview",
    headers: accessAdmin,
    body: { string: JSON.stringify({ changes: [{
      action: "invite_guest",
      principal_id: "guest@example.com",
      principal_type: "group",
      reason: "Sponsored access",
    }] }) },
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(response.jsonBody, {
    environment: "test",
    valid: false,
    items: [{
      index: 0,
      disposition: "invalid",
      errors: [
        "A guest invitation must target a person.",
        "A guest sponsor is required.",
        "A guest organization is required.",
        "Guest access requires an expiry.",
      ],
    }],
  });
});

test("a guest invitation preview refuses an expiry that has already passed", async () => {
  const handler = createAccessManagementHttpHandler({
    directory: inertDirectory,
    store: emptyStore,
    environment: "test",
    now: () => new Date("2026-08-14T12:00:00.000Z"),
    accessLookup: holding("access-administrator"),
  });

  const response = await handler(new HttpRequest({
    method: "POST",
    url: "https://example.test/api/admin/access-management/changes/preview",
    headers: accessAdmin,
    body: { string: JSON.stringify({ changes: [{ ...guestInvitation, expires_at: "2026-08-01T00:00:00.000Z" }] }) },
  }));

  assert.deepEqual((response.jsonBody as { items: Array<{ errors: string[] }> }).items[0].errors, [
    "Expiry must be a valid future date and time.",
  ]);
});

test("a guest invitation invites into the tenant and grants nothing there", async () => {
  const invited: string[] = [];
  const saved: Array<{ principalId: string; status: string }> = [];
  const directory: AccessDirectory = {
    ...inertDirectory,
    inviteGuest: async (change) => {
      invited.push(change.principal_id);
      return { principal_id: "guest-1", correlation_id: "invite-1" };
    },
  };
  const audit: Parameters<AccessManagementStore["appendAudit"]>[0][] = [];
  const store: AccessManagementStore = {
    ...emptyStore,
    appendAudit: async (entry) => { audit.push(entry); },
    getGuestInvitation: async () => null,
    claimGuestInvitation: async () => ({ state: "claimed" }),
    saveGuestInvitation: async (_email, _environment, principalId, _correlationId, status) => {
      saved.push({ principalId, status });
    },
  };
  const handler = createAccessManagementHttpHandler({
    directory,
    store,
    environment: "test",
    now: () => new Date("2026-08-14T12:00:00.000Z"),
    accessLookup: holding("access-administrator"),
  });

  const response = await handler(new HttpRequest({
    method: "POST",
    url: "https://example.test/api/admin/access-management/changes",
    headers: { ...accessAdmin, "idempotency-key": "invite-one" },
    body: { string: JSON.stringify({ changes: [guestInvitation] }) },
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(response.jsonBody, {
    environment: "test",
    results: [{ index: 0, disposition: "completed", correlation_id: "invite-1", principal_id: "guest-1" }],
  });
  assert.deepEqual(invited, ["guest@example.com"]);
  assert.deepEqual(saved, [{ principalId: "guest-1", status: "invited" }]);
  assert.equal(audit[0]?.action, "guest_invitation");
  assert.equal(audit[0]?.target_id, "guest@example.com");
  assert.equal(audit[0]?.outcome, "completed");
});

test("two invitations for one email in a batch send one invitation", async () => {
  let invitations = 0;
  const directory: AccessDirectory = {
    ...inertDirectory,
    inviteGuest: async () => {
      invitations += 1;
      return { principal_id: "guest-1", correlation_id: "invite-1" };
    },
  };
  let guestRecord: { principal_id: string; correlation_id: string | null } | null = null;
  const store: AccessManagementStore = {
    ...emptyStore,
    getGuestInvitation: async () => guestRecord,
    claimGuestInvitation: async () => guestRecord ? { state: "existing", ...guestRecord } : { state: "claimed" },
    saveGuestInvitation: async (_email, _environment, principalId, correlationId) => {
      guestRecord = { principal_id: principalId, correlation_id: correlationId };
    },
  };
  const handler = createAccessManagementHttpHandler({
    directory,
    store,
    environment: "test",
    now: () => new Date("2026-08-14T12:00:00.000Z"),
    accessLookup: holding("access-administrator"),
  });

  const response = await handler(new HttpRequest({
    method: "POST",
    url: "https://example.test/api/admin/access-management/changes",
    headers: { ...accessAdmin, "idempotency-key": "guest-twice" },
    body: { string: JSON.stringify({ changes: [guestInvitation, guestInvitation] }) },
  }));

  assert.equal(response.status, 200);
  assert.equal(invitations, 1);
  const results = (response.jsonBody as { results: Array<{ disposition: string; principal_id?: string }> }).results;
  assert.deepEqual(results.map((result) => result.disposition), ["completed", "completed"]);
  assert.deepEqual(results.map((result) => result.principal_id), ["guest-1", "guest-1"]);
});

test("concurrent guest onboarding does not issue a second invitation", async () => {
  let invitations = 0;
  const directory: AccessDirectory = {
    ...inertDirectory,
    inviteGuest: async () => {
      invitations += 1;
      return { principal_id: "duplicate", correlation_id: "duplicate" };
    },
  };
  const store: AccessManagementStore = {
    ...emptyStore,
    claimGuestInvitation: async () => ({ state: "in_progress" }),
    getGuestInvitation: async () => null,
    saveGuestInvitation: async () => undefined,
  };
  const handler = createAccessManagementHttpHandler({
    directory,
    store,
    environment: "test",
    now: () => new Date("2026-08-14T12:00:00.000Z"),
    accessLookup: holding("access-administrator"),
  });

  const response = await handler(new HttpRequest({
    method: "POST",
    url: "https://example.test/api/admin/access-management/changes",
    headers: { ...accessAdmin, "idempotency-key": "concurrent-guest" },
    body: { string: JSON.stringify({ changes: [guestInvitation] }) },
  }));

  assert.equal(response.status, 200);
  assert.equal(invitations, 0);
  assert.equal((response.jsonBody as { results: Array<{ disposition: string }> }).results[0]?.disposition, "failed");
});

test("stale guest invitation recovery reuses the guest found in Entra", async () => {
  let invitations = 0;
  const saved: string[] = [];
  const directory: AccessDirectory = {
    ...inertDirectory,
    findGuestByEmail: async () => ({ principal_id: "existing-guest" }),
    inviteGuest: async () => {
      invitations += 1;
      return { principal_id: "duplicate", correlation_id: "duplicate" };
    },
  };
  const store: AccessManagementStore = {
    ...emptyStore,
    claimGuestInvitation: async () => ({ state: "recover" }),
    getGuestInvitation: async () => null,
    saveGuestInvitation: async (_email, _environment, principalId) => { saved.push(principalId); },
  };
  const handler = createAccessManagementHttpHandler({
    directory,
    store,
    environment: "test",
    now: () => new Date("2026-08-14T12:00:00.000Z"),
    accessLookup: holding("access-administrator"),
  });

  const response = await handler(new HttpRequest({
    method: "POST",
    url: "https://example.test/api/admin/access-management/changes",
    headers: { ...accessAdmin, "idempotency-key": "recover-guest" },
    body: { string: JSON.stringify({ changes: [guestInvitation] }) },
  }));

  assert.equal(invitations, 0);
  assert.deepEqual(saved, ["existing-guest"]);
  const result = (response.jsonBody as { results: Array<{ disposition: string; principal_id?: string }> }).results[0];
  assert.equal(result?.disposition, "completed");
  assert.equal(result?.principal_id, "existing-guest");
});

test("stale guest recovery waits when the accepted invitation is not visible in Entra", async () => {
  let invitations = 0;
  const directory: AccessDirectory = {
    ...inertDirectory,
    findGuestByEmail: async () => null,
    inviteGuest: async () => {
      invitations += 1;
      return { principal_id: "duplicate", correlation_id: "duplicate" };
    },
  };
  const store: AccessManagementStore = {
    ...emptyStore,
    claimGuestInvitation: async () => ({ state: "recover" }),
    getGuestInvitation: async () => null,
    saveGuestInvitation: async () => { throw new Error("nothing was invited"); },
  };
  const handler = createAccessManagementHttpHandler({
    directory,
    store,
    environment: "test",
    now: () => new Date("2026-08-14T12:00:00.000Z"),
    accessLookup: holding("access-administrator"),
  });

  const response = await handler(new HttpRequest({
    method: "POST",
    url: "https://example.test/api/admin/access-management/changes",
    headers: { ...accessAdmin, "idempotency-key": "recover-unobservable-guest" },
    body: { string: JSON.stringify({ changes: [guestInvitation] }) },
  }));

  assert.equal(invitations, 0);
  assert.equal((response.jsonBody as { results: Array<{ disposition: string }> }).results[0]?.disposition, "failed");
});

test("a concurrent idempotency reservation blocks a duplicate invitation", async () => {
  let invitations = 0;
  const directory: AccessDirectory = {
    ...inertDirectory,
    inviteGuest: async () => { invitations += 1; throw new Error("must not invite"); },
  };
  const store: AccessManagementStore = {
    ...emptyStore,
    reserveOperation: async () => ({ state: "in_progress" }),
  };
  const handler = createAccessManagementHttpHandler({
    directory,
    store,
    environment: "test",
    accessLookup: holding("access-administrator"),
  });

  const response = await handler(new HttpRequest({
    method: "POST",
    url: "https://example.test/api/admin/access-management/changes",
    headers: { ...accessAdmin, "idempotency-key": "same-operation" },
    body: { string: JSON.stringify({ changes: [guestInvitation] }) },
  }));

  assert.equal(response.status, 409);
  assert.equal(invitations, 0);
});

test("a completed reservation replays its recorded answer instead of inviting again", async () => {
  let invitations = 0;
  const directory: AccessDirectory = {
    ...inertDirectory,
    inviteGuest: async () => { invitations += 1; throw new Error("must not invite"); },
  };
  const store: AccessManagementStore = {
    ...emptyStore,
    reserveOperation: async () => ({
      state: "completed",
      response: { environment: "test", results: [{ index: 0, disposition: "completed", correlation_id: "invite-1" }] },
    }),
  };
  const handler = createAccessManagementHttpHandler({
    directory,
    store,
    environment: "test",
    accessLookup: holding("access-administrator"),
  });

  const response = await handler(new HttpRequest({
    method: "POST",
    url: "https://example.test/api/admin/access-management/changes",
    headers: { ...accessAdmin, "idempotency-key": "replayed" },
    body: { string: JSON.stringify({ changes: [guestInvitation] }) },
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(response.jsonBody, {
    environment: "test",
    results: [{ index: 0, disposition: "completed", correlation_id: "invite-1" }],
  });
  assert.equal(invitations, 0);
});

test("a submission without an Idempotency-Key is refused", async () => {
  const handler = createAccessManagementHttpHandler({
    directory: inertDirectory,
    store: emptyStore,
    environment: "test",
    accessLookup: holding("access-administrator"),
  });

  const response = await handler(new HttpRequest({
    method: "POST",
    url: "https://example.test/api/admin/access-management/changes",
    headers: accessAdmin,
    body: { string: JSON.stringify({ changes: [guestInvitation] }) },
  }));

  assert.equal(response.status, 400);
  assert.deepEqual(response.jsonBody, { error: "Idempotency-Key header is required." });
});

test("OnBoard sign-in details are queried on demand without being copied into audit", async () => {
  const directory: AccessDirectory = {
    ...inertDirectory,
    getSignIns: async () => ({
      summary: {
        last_successful_at: "2026-08-14T10:00:00.000Z",
        last_interactive_attempt_at: "2026-08-14T10:00:00.000Z",
        last_noninteractive_at: "2026-08-14T11:30:00.000Z",
      },
      events: [{
        occurred_at: "2026-08-14T10:00:00.000Z",
        successful: true,
        client_app: "Browser",
        correlation_id: "signin-correlation-1",
      }],
    }),
  };
  const audit: Parameters<AccessManagementStore["appendAudit"]>[0][] = [];
  const store: AccessManagementStore = {
    ...emptyStore,
    appendAudit: async (entry) => { audit.push(entry); },
    listAudit: async () => audit,
  };
  const handler = createAccessManagementHttpHandler({
    directory,
    store,
    environment: "production",
    now: () => new Date("2026-08-14T12:00:00.000Z"),
    accessLookup: holding("access-administrator"),
  });

  const signIns = await handler(new HttpRequest({
    method: "GET",
    url: "https://example.test/api/admin/access-management/principals/user-1/sign-ins",
    headers: accessAdmin,
  }));
  const auditResponse = await handler(new HttpRequest({
    method: "GET",
    url: "https://example.test/api/admin/access-management/audit",
    headers: accessAdmin,
  }));

  assert.deepEqual(signIns.jsonBody, {
    directory_summary: {
      scope: "directory_wide",
      last_successful_at: "2026-08-14T10:00:00.000Z",
      last_interactive_attempt_at: "2026-08-14T10:00:00.000Z",
      last_noninteractive_at: "2026-08-14T11:30:00.000Z",
    },
    onboard_events: {
      scope: "onboard_application",
      queried_at: "2026-08-14T12:00:00.000Z",
      events: [{
        occurred_at: "2026-08-14T10:00:00.000Z",
        successful: true,
        client_app: "Browser",
        correlation_id: "signin-correlation-1",
      }],
    },
  });
  assert.deepEqual(auditResponse.jsonBody, { audit: [{
    environment: "production",
    actor_id: "actor-1",
    actor_name: "alex@mvta.com",
    action: "sign_in_details_viewed",
    target_id: "user-1",
    reason: null,
    outcome: "completed",
    correlation_id: null,
    occurred_at: "2026-08-14T12:00:00.000Z",
    details: { scope: "onboard_application", event_count: 1 },
  }] });
});

test("Directory search returns eligible Entra principals without creating local users", async () => {
  const directory: AccessDirectory = {
    ...inertDirectory,
    searchPrincipals: async (query) => [{
      id: "user-9",
      display_name: `${query} Operator`,
      sign_in_name: "morgan@mvta.com",
      principal_type: "user",
      account_enabled: true,
      guest_state: null,
      assignments: [],
    }],
  };
  const handler = createAccessManagementHttpHandler({
    directory,
    store: emptyStore,
    environment: "test",
    accessLookup: holding("access-administrator"),
  });

  const response = await handler(new HttpRequest({
    method: "GET",
    url: "https://example.test/api/admin/access-management/directory/search?q=Morgan",
    headers: accessAdmin,
  }));

  assert.deepEqual(response.jsonBody, { candidates: [{
    id: "user-9",
    display_name: "Morgan Operator",
    sign_in_name: "morgan@mvta.com",
    principal_type: "user",
    account_enabled: true,
    guest_state: null,
    assignments: [],
    effective_roles: [],
  }] });
});

test("safe inventory export is audited and excludes sign-in diagnostics", async () => {
  const directory: AccessDirectory = {
    ...inertDirectory,
    listAccessPrincipals: async () => [{
      id: "user-1",
      display_name: "Taylor Operator",
      sign_in_name: "taylor@mvta.com",
      principal_type: "user",
      account_enabled: true,
      guest_state: null,
      assignments: [{ role: "OCC.Viewer", source: "group", source_id: "group-viewers", source_name: "OnBoard Viewers" }],
    }],
    getSignIns: async () => { throw new Error("export must not query sign-ins"); },
  };
  const audit: Parameters<AccessManagementStore["appendAudit"]>[0][] = [];
  const store: AccessManagementStore = {
    ...emptyStore,
    appendAudit: async (entry) => { audit.push(entry); },
    listAudit: async () => audit,
  };
  const handler = createAccessManagementHttpHandler({
    directory,
    store,
    environment: "test",
    now: () => new Date("2026-08-14T12:00:00.000Z"),
    accessLookup: holding("access-administrator"),
  });

  const response = await handler(new HttpRequest({
    method: "POST",
    url: "https://example.test/api/admin/access-management/export",
    headers: accessAdmin,
  }));

  assert.deepEqual(response.jsonBody, {
    environment: "test",
    generated_at: "2026-08-14T12:00:00.000Z",
    rows: [{
      display_name: "Taylor Operator",
      sign_in_name: "taylor@mvta.com",
      principal_type: "user",
      account_enabled: true,
      guest_state: null,
      effective_roles: ["OCC.Viewer"],
      reconciliation_status: "current",
      role: "OCC.Viewer",
      source: "group",
      source_name: "OnBoard Viewers",
      expires_at: null,
      sponsor: null,
      organization: null,
    }],
  });
  assert.equal(audit[0]?.action, "access_inventory_exported");
});

test("recorded access metadata still decorates the inventory it was written for", async () => {
  const directory: AccessDirectory = {
    ...inertDirectory,
    listAccessPrincipals: async () => [{
      id: "guest-1",
      display_name: "Contractor Guest",
      sign_in_name: "guest@example.com",
      principal_type: "user",
      account_enabled: true,
      guest_state: "PendingAcceptance",
      assignments: [{ role: "OCC.Viewer", source: "direct", source_id: "assignment-1", source_name: "Enterprise application assignment" }],
    }],
  };
  const store: AccessManagementStore = {
    ...emptyStore,
    listMetadata: async () => [{
      id: "metadata-1",
      environment: "test",
      principal_id: "guest-1",
      principal_type: "user",
      role: "OCC.Viewer",
      source: "direct",
      source_id: "assignment-1",
      reason: "Sponsored project access",
      sponsor: "sponsor@mvta.com",
      organization: "Example Contractor",
      expires_at: "2026-09-01T00:00:00.000Z",
      status: "active",
      last_correlation_id: null,
    }],
  };
  const handler = createAccessManagementHttpHandler({
    directory,
    store,
    environment: "test",
    accessLookup: holding("access-administrator"),
  });

  const response = await handler(new HttpRequest({
    method: "GET",
    url: "https://example.test/api/admin/access-management/principals",
    headers: accessAdmin,
  }));

  const principals = (response.jsonBody as { principals: Array<{ assignments: Array<Record<string, unknown>> }> }).principals;
  assert.deepEqual(principals[0]?.assignments[0], {
    role: "OCC.Viewer",
    source: "direct",
    source_id: "assignment-1",
    source_name: "Enterprise application assignment",
    expires_at: "2026-09-01T00:00:00.000Z",
    is_exception: true,
    sponsor: "sponsor@mvta.com",
    organization: "Example Contractor",
    lifecycle_status: "active",
  });
});
