import assert from "node:assert/strict";
import test from "node:test";
import { HttpRequest } from "@azure/functions";
import {
  createAccessManagementHttpHandler,
  type AccessDirectory,
  type AccessManagementStore,
} from "./accessManagementHttp";

function principalHeader(
  roles: string[],
  userId = "actor-1",
  userDetails = "alex@mvta.com",
  extraClaims: Array<{ typ: string; val: string }> = [],
) {
  return Buffer.from(JSON.stringify({
    userId,
    userDetails,
    claims: [...roles.map((role) => ({ typ: "roles", val: role })), ...extraClaims],
  })).toString("base64");
}

const emptyStore: AccessManagementStore = {
  listPendingChanges: async () => [],
  getChange: async () => null,
  createChange: async () => { throw new Error("not used"); },
  decideChange: async () => { throw new Error("not used"); },
  appendAudit: async () => undefined,
  listAudit: async () => [],
  getOperation: async () => null,
  saveOperation: async () => undefined,
};

test("an Access Administrator can list effective OnBoard access", async () => {
  const directory: AccessDirectory = {
    listAccessPrincipals: async () => [{
      id: "user-1",
      display_name: "Taylor Operator",
      sign_in_name: "taylor@mvta.com",
      principal_type: "user",
      account_enabled: true,
      guest_state: null,
      assignments: [{ role: "OCC.Viewer", source: "group", source_id: "group-viewers", source_name: "OnBoard Viewers" }],
    }],
    searchPrincipals: async () => [],
    getSignIns: async () => ({ summary: null, events: [] }),
    applyChange: async () => ({ status: "completed", correlation_id: "unused" }),
  };
  const handler = createAccessManagementHttpHandler({
    directory,
    store: emptyStore,
    environment: "test",
    now: () => new Date("2026-08-14T12:00:00.000Z"),
  });

  const response = await handler(new HttpRequest({
    method: "GET",
    url: "https://example.test/api/admin/access-management/principals",
    headers: { "x-ms-client-principal": principalHeader(["OCC.AccessAdmin"]) },
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(response.jsonBody, {
    environment: "test",
    access_admin_fallback: false,
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

test("an OCC Admin cannot use Access Management when the bootstrap fallback is disabled", async () => {
  const directory: AccessDirectory = {
    listAccessPrincipals: async () => { throw new Error("must not query the directory"); },
    searchPrincipals: async () => [],
    getSignIns: async () => ({ summary: null, events: [] }),
    applyChange: async () => ({ status: "completed", correlation_id: null }),
  };
  const handler = createAccessManagementHttpHandler({
    directory,
    store: emptyStore,
    environment: "production",
  });

  const response = await handler(new HttpRequest({
    method: "GET",
    url: "https://example.test/api/admin/access-management/principals",
    headers: { "x-ms-client-principal": principalHeader(["OCC.Admin"]) },
  }));

  assert.equal(response.status, 403);
  assert.deepEqual(response.jsonBody, { error: "Access Management permission is required." });
});

test("a mixed ingestion and Access Administrator token is denied", async () => {
  const directory: AccessDirectory = {
    listAccessPrincipals: async () => { throw new Error("must not query the directory"); },
    searchPrincipals: async () => [],
    getSignIns: async () => ({ summary: null, events: [] }),
    applyChange: async () => ({ status: "completed", correlation_id: null }),
  };
  const handler = createAccessManagementHttpHandler({ directory, store: emptyStore, environment: "test" });
  const response = await handler(new HttpRequest({
    method: "GET",
    url: "https://example.test/api/admin/access-management/principals",
    headers: { "x-ms-client-principal": principalHeader(["System.Ingestion", "OCC.AccessAdmin"]) },
  }));

  assert.equal(response.status, 403);
});

test("Access Management requires a stable requester identity", async () => {
  const directory: AccessDirectory = {
    listAccessPrincipals: async () => [],
    searchPrincipals: async () => [],
    getSignIns: async () => ({ summary: null, events: [] }),
    applyChange: async () => ({ status: "completed", correlation_id: null }),
  };
  const handler = createAccessManagementHttpHandler({ directory, store: emptyStore, environment: "test" });

  const response = await handler(new HttpRequest({
    method: "POST",
    url: "https://example.test/api/admin/access-management/changes",
    headers: {
      "idempotency-key": "missing-requester-identity",
      "x-ms-client-principal": principalHeader(["OCC.AccessAdmin"], "", "", [{ typ: "acrs", val: "c1" }]),
    },
    body: { string: JSON.stringify({ changes: [{
      action: "grant",
      principal_id: "user-1",
      principal_type: "user",
      role: "OCC.Admin",
      source: "group",
      reason: "Duty manager",
    }] }) },
  }));

  assert.equal(response.status, 401);
  assert.deepEqual(response.jsonBody, { error: "A stable sign-in identity is required to manage access." });
});

test("Directory Onboarding preview rejects System.Ingestion for a person", async () => {
  const directory: AccessDirectory = {
    listAccessPrincipals: async () => [],
    searchPrincipals: async () => [],
    getSignIns: async () => ({ summary: null, events: [] }),
    applyChange: async () => ({ status: "completed", correlation_id: null }),
  };
  const handler = createAccessManagementHttpHandler({ directory, store: emptyStore, environment: "test" });

  const response = await handler(new HttpRequest({
    method: "POST",
    url: "https://example.test/api/admin/access-management/changes/preview",
    headers: { "x-ms-client-principal": principalHeader(["OCC.AccessAdmin"]) },
    body: { string: JSON.stringify({ changes: [{
      action: "grant",
      principal_id: "user-1",
      principal_type: "user",
      role: "System.Ingestion",
      source: "direct",
      reason: "Needed for the import process",
    }] }) },
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(response.jsonBody, {
    environment: "test",
    valid: false,
    items: [{
      index: 0,
      disposition: "invalid",
      errors: ["System.Ingestion can be assigned only to a workload identity."],
    }],
  });
});

test("Directory Onboarding rejects a forged workload principal type", async () => {
  const directory: AccessDirectory = {
    listAccessPrincipals: async () => [],
    getPrincipal: async () => ({
      id: "user-1",
      display_name: "Taylor Operator",
      sign_in_name: "taylor@mvta.com",
      principal_type: "user",
      account_enabled: true,
      guest_state: null,
      assignments: [],
    }),
    searchPrincipals: async () => [],
    getSignIns: async () => ({ summary: null, events: [] }),
    applyChange: async () => { throw new Error("must not mutate Entra"); },
  };
  const handler = createAccessManagementHttpHandler({ directory, store: emptyStore, environment: "test" });
  const response = await handler(new HttpRequest({
    method: "POST",
    url: "https://example.test/api/admin/access-management/changes/preview",
    headers: { "x-ms-client-principal": principalHeader(["OCC.AccessAdmin"]) },
    body: { string: JSON.stringify({ changes: [{
      action: "grant",
      principal_id: "user-1",
      principal_type: "service_principal",
      role: "System.Ingestion",
      source: "direct",
      reason: "Attempted forged workload grant",
    }] }) },
  }));

  assert.equal(response.status, 200);
  assert.deepEqual((response.jsonBody as { items: Array<{ disposition: string; errors: string[] }> }).items[0], {
    index: 0,
    disposition: "invalid",
    errors: ["The directory principal is user, not service_principal."],
  });
});

test("an ordinary role grant becomes effective and auditable", async () => {
  const principals = [{
    id: "user-1",
    display_name: "Taylor Operator",
    sign_in_name: "taylor@mvta.com",
    principal_type: "user" as const,
    account_enabled: true,
    guest_state: null,
    assignments: [],
  }];
  const directory: AccessDirectory = {
    listAccessPrincipals: async () => principals,
    searchPrincipals: async () => [],
    getSignIns: async () => ({ summary: null, events: [] }),
    applyChange: async (change) => {
      principals[0].assignments.push({
        role: change.role,
        source: change.source,
        source_id: "assignment-1",
        source_name: "Direct exception",
      } as never);
      return { status: "completed", correlation_id: "graph-correlation-1" };
    },
  };
  const audit: Parameters<AccessManagementStore["appendAudit"]>[0][] = [];
  const operations = new Map<string, unknown>();
  const store: AccessManagementStore = {
    ...emptyStore,
    appendAudit: async (entry) => { audit.push(entry); },
    listAudit: async () => audit,
    getOperation: async (key) => operations.get(key) ?? null,
    saveOperation: async (key, _environment, response) => { operations.set(key, response); },
  };
  const handler = createAccessManagementHttpHandler({
    directory,
    store,
    environment: "test",
    now: () => new Date("2026-08-14T12:00:00.000Z"),
  });
  const headers = {
    "x-ms-client-principal": principalHeader(["OCC.AccessAdmin"]),
    "idempotency-key": "onboard-user-1-detour",
  };

  const grant = await handler(new HttpRequest({
    method: "POST",
    url: "https://example.test/api/admin/access-management/changes",
    headers,
    body: { string: JSON.stringify({ changes: [{
      action: "grant",
      principal_id: "user-1",
      principal_type: "user",
      role: "OCC.Detour",
      source: "direct",
      reason: "Temporary detour coverage",
    }] }) },
  }));
  const access = await handler(new HttpRequest({
    method: "GET",
    url: "https://example.test/api/admin/access-management/principals",
    headers,
  }));
  const auditResponse = await handler(new HttpRequest({
    method: "GET",
    url: "https://example.test/api/admin/access-management/audit",
    headers,
  }));

  assert.equal(grant.status, 200);
  assert.deepEqual(grant.jsonBody, {
    environment: "test",
    results: [{ index: 0, disposition: "completed", correlation_id: "graph-correlation-1" }],
  });
  assert.deepEqual((access.jsonBody as { principals: Array<{ effective_roles: string[] }> }).principals[0].effective_roles, ["OCC.Detour"]);
  assert.deepEqual(auditResponse.jsonBody, { audit: [{
    environment: "test",
    actor_id: "actor-1",
    actor_name: "alex@mvta.com",
    action: "access_grant",
    target_id: "user-1",
    reason: "Temporary detour coverage",
    outcome: "completed",
    correlation_id: "graph-correlation-1",
    occurred_at: "2026-08-14T12:00:00.000Z",
    details: { role: "OCC.Detour", source: "direct", principal_type: "user" },
  }] });
});

test("a different freshly authenticated Access Administrator approves a privileged grant", async () => {
  const principals = [{
    id: "user-1",
    display_name: "Taylor Operator",
    sign_in_name: "taylor@mvta.com",
    principal_type: "user" as const,
    account_enabled: true,
    guest_state: null,
    assignments: [],
  }];
  const directory: AccessDirectory = {
    listAccessPrincipals: async () => principals,
    searchPrincipals: async () => [],
    getSignIns: async () => ({ summary: null, events: [] }),
    applyChange: async (change) => {
      principals[0].assignments.push({
        role: change.role,
        source: change.source,
        source_id: "assignment-admin",
        source_name: "OnBoard Administrators",
      } as never);
      return { status: "completed", correlation_id: "graph-admin-1" };
    },
  };
  const changes = new Map<string, Awaited<ReturnType<AccessManagementStore["createChange"]>>>();
  const operations = new Map<string, unknown>();
  const store: AccessManagementStore = {
    ...emptyStore,
    listPendingChanges: async () => [...changes.values()].filter((change) => change.status === "pending"),
    getChange: async (id) => changes.get(id) ?? null,
    createChange: async (input) => {
      const change = { ...input, id: `change-${changes.size + 1}` };
      changes.set(change.id, change);
      return change;
    },
    decideChange: async (id, decision, actor, decidedAt, result) => {
      const existing = changes.get(id)!;
      const changed = {
        ...existing,
        status: decision,
        decided_by_id: actor.id,
        decided_by_name: actor.name,
        decided_at: decidedAt,
        result,
      };
      changes.set(id, changed);
      return changed;
    },
    getOperation: async (key) => operations.get(key) ?? null,
    saveOperation: async (key, _environment, response) => { operations.set(key, response); },
  };
  const handler = createAccessManagementHttpHandler({
    directory,
    store,
    environment: "test",
    now: () => new Date("2026-08-14T12:00:00.000Z"),
    privilegedAuthContext: "c1",
  });

  const requested = await handler(new HttpRequest({
    method: "POST",
    url: "https://example.test/api/admin/access-management/changes",
    headers: {
      "x-ms-client-principal": principalHeader(
        ["OCC.AccessAdmin"],
        "actor-1",
        "alex@mvta.com",
        [{ typ: "acrs", val: "c1" }],
      ),
      "idempotency-key": "request-admin-user-1",
    },
    body: { string: JSON.stringify({ changes: [{
      action: "grant",
      principal_id: "user-1",
      principal_type: "user",
      role: "OCC.Admin",
      source: "group",
      reason: "Primary duty manager",
    }] }) },
  }));
  const approved = await handler(new HttpRequest({
    method: "POST",
    url: "https://example.test/api/admin/access-management/changes/change-1/decision",
    headers: {
      "x-ms-client-principal": principalHeader(
        ["OCC.AccessAdmin"],
        "actor-2",
        "jamie@mvta.com",
        [{ typ: "acrs", val: "c1" }],
      ),
      "idempotency-key": "approve-admin-user-1",
    },
    body: { string: JSON.stringify({ decision: "approved" }) },
  }));
  const access = await handler(new HttpRequest({
    method: "GET",
    url: "https://example.test/api/admin/access-management/principals",
    headers: { "x-ms-client-principal": principalHeader(["OCC.AccessAdmin"]) },
  }));

  assert.deepEqual(requested.jsonBody, {
    environment: "test",
    results: [{ index: 0, disposition: "pending_approval", change_id: "change-1" }],
  });
  assert.equal(approved.status, 200);
  assert.deepEqual(approved.jsonBody, {
    change_id: "change-1",
    status: "approved",
    result: { status: "completed", correlation_id: "graph-admin-1" },
  });
  assert.deepEqual((access.jsonBody as { principals: Array<{ effective_roles: string[] }> }).principals[0].effective_roles, ["OCC.Admin"]);
});

test("a privileged request with an unknown legacy requester cannot be approved", async () => {
  const directory: AccessDirectory = {
    listAccessPrincipals: async () => [],
    searchPrincipals: async () => [],
    getSignIns: async () => ({ summary: null, events: [] }),
    applyChange: async () => ({ status: "completed", correlation_id: null }),
  };
  const store: AccessManagementStore = {
    ...emptyStore,
    getChange: async () => ({
      id: "legacy-change",
      environment: "test",
      change: { action: "grant", principal_id: "user-1", principal_type: "user", role: "OCC.Admin", source: "group", reason: "Legacy request" },
      status: "pending",
      requested_by_id: "unknown",
      requested_by_name: "unknown",
      requested_at: "2026-08-14T12:00:00.000Z",
      approval_expires_at: "2026-08-15T12:00:00.000Z",
      decided_by_id: null,
      decided_by_name: null,
      decided_at: null,
      result: null,
    }),
  };
  const handler = createAccessManagementHttpHandler({ directory, store, environment: "test" });

  const response = await handler(new HttpRequest({
    method: "POST",
    url: "https://example.test/api/admin/access-management/changes/legacy-change/decision",
    headers: {
      "idempotency-key": "legacy-approval",
      "x-ms-client-principal": principalHeader(["OCC.AccessAdmin"], "actor-2", "jamie@mvta.com", [{ typ: "acrs", val: "c1" }]),
    },
    body: { string: JSON.stringify({ decision: "approved" }) },
  }));

  assert.equal(response.status, 409);
  assert.deepEqual(response.jsonBody, { error: "This legacy request has no verifiable requester and cannot be approved. Reject it and create a new request." });
});

test("OnBoard sign-in details are queried on demand without being copied into audit", async () => {
  const directory: AccessDirectory = {
    listAccessPrincipals: async () => [],
    searchPrincipals: async () => [],
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
    applyChange: async () => ({ status: "completed", correlation_id: null }),
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
  });
  const headers = { "x-ms-client-principal": principalHeader(["OCC.AccessAdmin"]) };

  const signIns = await handler(new HttpRequest({
    method: "GET",
    url: "https://example.test/api/admin/access-management/principals/user-1/sign-ins",
    headers,
  }));
  const auditResponse = await handler(new HttpRequest({
    method: "GET",
    url: "https://example.test/api/admin/access-management/audit",
    headers,
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

test("Directory Onboarding search returns eligible Entra principals without creating local users", async () => {
  const directory: AccessDirectory = {
    listAccessPrincipals: async () => [],
    searchPrincipals: async (query) => [{
      id: "user-9",
      display_name: `${query} Operator`,
      sign_in_name: "morgan@mvta.com",
      principal_type: "user",
      account_enabled: true,
      guest_state: null,
      assignments: [],
    }],
    getSignIns: async () => ({ summary: null, events: [] }),
    applyChange: async () => ({ status: "completed", correlation_id: null }),
  };
  const handler = createAccessManagementHttpHandler({ directory, store: emptyStore, environment: "test" });

  const response = await handler(new HttpRequest({
    method: "GET",
    url: "https://example.test/api/admin/access-management/directory/search?q=Morgan",
    headers: { "x-ms-client-principal": principalHeader(["OCC.AccessAdmin"]) },
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

test("an Access Administrator can idempotently remove due OnBoard access without disabling the identity", async () => {
  const principals = [{
    id: "guest-1",
    display_name: "Guest Operator",
    sign_in_name: "guest@example.com",
    principal_type: "user" as const,
    account_enabled: true,
    guest_state: "Accepted",
    assignments: [{
      role: "OCC.Viewer" as const,
      source: "group" as const,
      source_id: "group-viewers",
      source_name: "OnBoard Viewers",
    }],
  }];
  const directory: AccessDirectory = {
    listAccessPrincipals: async () => principals,
    searchPrincipals: async () => [],
    getSignIns: async () => ({ summary: null, events: [] }),
    applyChange: async (change) => {
      assert.equal(change.action, "revoke");
      principals[0].assignments = [];
      return { status: "completed", correlation_id: "expiry-graph-1" };
    },
  };
  const operations = new Map<string, unknown>();
  const due = [{
    id: "metadata-1",
    environment: "test",
    principal_id: "guest-1",
    principal_type: "user" as const,
    role: "OCC.Viewer" as const,
    source: "group" as const,
    source_id: "group-viewers",
    reason: "Sponsored project access",
    sponsor: "sponsor@mvta.com",
    organization: "Example Contractor",
    expires_at: "2026-08-14T11:00:00.000Z",
    status: "active" as const,
    last_correlation_id: null,
  }];
  const store: AccessManagementStore = {
    ...emptyStore,
    getOperation: async (key) => operations.get(key) ?? null,
    saveOperation: async (key, _environment, response) => { operations.set(key, response); },
    listDueExpirations: async () => due,
    markMetadataStatus: async (_id, status) => { due[0].status = status as "active"; },
  };
  const handler = createAccessManagementHttpHandler({
    directory,
    store,
    environment: "test",
    now: () => new Date("2026-08-14T12:00:00.000Z"),
  });
  const headers = {
    "x-ms-client-principal": principalHeader(["OCC.AccessAdmin"]),
    "idempotency-key": "expire-guest-1-viewer",
  };

  const first = await handler(new HttpRequest({
    method: "POST",
    url: "https://example.test/api/admin/access-management/expirations/apply",
    headers,
  }));
  const replay = await handler(new HttpRequest({
    method: "POST",
    url: "https://example.test/api/admin/access-management/expirations/apply",
    headers,
  }));

  assert.deepEqual(first.jsonBody, {
    environment: "test",
    results: [{ metadata_id: "metadata-1", principal_id: "guest-1", role: "OCC.Viewer", disposition: "completed", correlation_id: "expiry-graph-1" }],
  });
  assert.deepEqual(replay.jsonBody, first.jsonBody);
  assert.equal(principals[0].account_enabled, true);
  assert.deepEqual(principals[0].assignments, []);
});

test("approval cannot remove the last recoverable Access Administrator", async () => {
  const principals = [{
    id: "actor-1",
    display_name: "Alex Administrator",
    sign_in_name: "alex@mvta.com",
    principal_type: "user" as const,
    account_enabled: true,
    guest_state: null,
    assignments: [{
      role: "OCC.AccessAdmin" as const,
      source: "direct" as const,
      source_id: "assignment-1",
      source_name: "Enterprise application assignment",
    }],
  }];
  let pending: Awaited<ReturnType<AccessManagementStore["createChange"]>> | null = null;
  const store: AccessManagementStore = {
    ...emptyStore,
    createChange: async (input) => {
      pending = { ...input, id: "change-1" };
      return pending;
    },
    getChange: async () => pending,
  };
  const directory: AccessDirectory = {
    listAccessPrincipals: async () => principals,
    searchPrincipals: async () => [],
    getSignIns: async () => ({ summary: null, events: [] }),
    applyChange: async () => { throw new Error("must not remove the last administrator"); },
  };
  const handler = createAccessManagementHttpHandler({
    directory,
    store,
    environment: "test",
    privilegedAuthContext: "c1",
  });
  const fresh = [{ typ: "acrs", val: "c1" }];

  await handler(new HttpRequest({
    method: "POST",
    url: "https://example.test/api/admin/access-management/changes",
    headers: {
      "x-ms-client-principal": principalHeader(["OCC.AccessAdmin"], "actor-1", "alex@mvta.com", fresh),
      "idempotency-key": "request-remove-last-admin",
    },
    body: { string: JSON.stringify({ changes: [{
      action: "revoke",
      principal_id: "actor-1",
      principal_type: "user",
      role: "OCC.AccessAdmin",
      source: "direct",
      reason: "Role transition",
    }] }) },
  }));
  const response = await handler(new HttpRequest({
    method: "POST",
    url: "https://example.test/api/admin/access-management/changes/change-1/decision",
    headers: {
      "x-ms-client-principal": principalHeader(["OCC.AccessAdmin"], "actor-2", "jamie@mvta.com", fresh),
      "idempotency-key": "approve-remove-last-admin",
    },
    body: { string: JSON.stringify({ decision: "approved" }) },
  }));

  assert.equal(response.status, 409);
  assert.deepEqual(response.jsonBody, { error: "This change would remove the last recoverable Access Administrator." });
  assert.equal(principals[0].assignments.length, 1);
});

test("approval rechecks the recoverable administrator invariant after claiming the change", async () => {
  let directoryReads = 0;
  let claimed = false;
  let applied = false;
  const pending = {
    id: "change-2",
    environment: "test",
    change: {
      action: "revoke" as const,
      principal_id: "admin-2",
      principal_type: "user" as const,
      role: "OCC.AccessAdmin" as const,
      source: "direct" as const,
      reason: "Role transition",
    },
    status: "pending" as const,
    requested_by_id: "requester-1",
    requested_by_name: "requester@example.com",
    requested_at: "2026-08-14T11:00:00.000Z",
    approval_expires_at: "2026-08-14T13:00:00.000Z",
    decided_by_id: null,
    decided_by_name: null,
    decided_at: null,
    result: null,
  };
  const store: AccessManagementStore = {
    ...emptyStore,
    getChange: async () => pending,
    claimChange: async () => {
      claimed = true;
      return true;
    },
    decideChange: async (_id, decision, actor, decidedAt, result) => ({
      ...pending,
      status: decision,
      decided_by_id: actor.id,
      decided_by_name: actor.name,
      decided_at: decidedAt,
      result,
    }),
  };
  const administrator = (id: string) => ({
    id,
    display_name: id,
    sign_in_name: `${id}@mvta.com`,
    principal_type: "user" as const,
    account_enabled: true,
    guest_state: null,
    assignments: [{
      role: "OCC.AccessAdmin" as const,
      source: "direct" as const,
      source_id: `assignment-${id}`,
      source_name: "Enterprise application assignment",
    }],
  });
  const directory: AccessDirectory = {
    listAccessPrincipals: async () => {
      directoryReads += 1;
      return claimed ? [administrator("admin-2")] : [administrator("admin-1"), administrator("admin-2")];
    },
    searchPrincipals: async () => [],
    getSignIns: async () => ({ summary: null, events: [] }),
    applyChange: async () => {
      applied = true;
      return { status: "completed", correlation_id: "must-not-happen" };
    },
  };
  const handler = createAccessManagementHttpHandler({
    directory,
    store,
    environment: "test",
    privilegedAuthContext: "c1",
    now: () => new Date("2026-08-14T12:00:00.000Z"),
  });

  const response = await handler(new HttpRequest({
    method: "POST",
    url: "https://example.test/api/admin/access-management/changes/change-2/decision",
    headers: {
      "x-ms-client-principal": principalHeader(["OCC.AccessAdmin"], "approver-1", "approver@mvta.com", [{ typ: "acrs", val: "c1" }]),
      "idempotency-key": "approve-after-concurrent-revoke",
    },
    body: { string: JSON.stringify({ decision: "approved" }) },
  }));

  assert.equal(response.status, 409);
  assert.equal(applied, false);
  assert.ok(directoryReads >= 1);
});

test("reconciliation reports Entra drift without mutating access", async () => {
  const directory: AccessDirectory = {
    listAccessPrincipals: async () => [],
    searchPrincipals: async () => [],
    getSignIns: async () => ({ summary: null, events: [] }),
    applyChange: async () => { throw new Error("reconciliation preview must not mutate"); },
    reconcileAccess: async () => ({
      environment: "test",
      observed_at: "2026-08-14T12:00:00.000Z",
      findings: [{
        code: "missing_role_group_assignment",
        severity: "error",
        role: "OCC.Viewer",
        principal_id: "group-viewers",
        message: "Configured OnBoard Viewers group is not assigned to OCC.Viewer.",
        repair_change: {
          action: "grant",
          principal_id: "group-viewers",
          principal_type: "group",
          role: "OCC.Viewer",
          source: "direct",
          reason: "Repair configured role-group assignment",
        },
      }],
    }),
  };
  const handler = createAccessManagementHttpHandler({ directory, store: emptyStore, environment: "test" });

  const response = await handler(new HttpRequest({
    method: "GET",
    url: "https://example.test/api/admin/access-management/reconciliation",
    headers: { "x-ms-client-principal": principalHeader(["OCC.AccessAdmin"]) },
  }));

  assert.equal(response.status, 200);
  assert.deepEqual((response.jsonBody as { findings: unknown[] }).findings.length, 1);
});

test("safe inventory export is audited and excludes sign-in diagnostics", async () => {
  const directory: AccessDirectory = {
    listAccessPrincipals: async () => [{
      id: "user-1",
      display_name: "Taylor Operator",
      sign_in_name: "taylor@mvta.com",
      principal_type: "user",
      account_enabled: true,
      guest_state: null,
      assignments: [{ role: "OCC.Viewer", source: "group", source_id: "group-viewers", source_name: "OnBoard Viewers" }],
    }],
    searchPrincipals: async () => [],
    getSignIns: async () => { throw new Error("export must not query sign-ins"); },
    applyChange: async () => ({ status: "completed", correlation_id: null }),
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
  });
  const headers = { "x-ms-client-principal": principalHeader(["OCC.AccessAdmin"]) };

  const response = await handler(new HttpRequest({
    method: "POST",
    url: "https://example.test/api/admin/access-management/export",
    headers,
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

test("a concurrent privileged decision cannot apply the same change twice", async () => {
  const pending = {
    id: "change-1",
    environment: "test",
    change: {
      action: "grant" as const,
      principal_id: "user-1",
      principal_type: "user" as const,
      role: "OCC.Admin" as const,
      source: "group" as const,
      reason: "Duty manager",
    },
    status: "pending" as const,
    requested_by_id: "actor-1",
    requested_by_name: "alex@mvta.com",
    requested_at: "2026-08-14T11:00:00.000Z",
    decided_by_id: null,
    decided_by_name: null,
    decided_at: null,
    result: null,
  };
  const store: AccessManagementStore = {
    ...emptyStore,
    getChange: async () => pending,
    claimChange: async () => false,
  };
  const directory: AccessDirectory = {
    listAccessPrincipals: async () => [],
    searchPrincipals: async () => [],
    getSignIns: async () => ({ summary: null, events: [] }),
    applyChange: async () => { throw new Error("a lost approval race must not reach Graph"); },
  };
  const handler = createAccessManagementHttpHandler({ directory, store, environment: "test", privilegedAuthContext: "c1" });

  const response = await handler(new HttpRequest({
    method: "POST",
    url: "https://example.test/api/admin/access-management/changes/change-1/decision",
    headers: {
      "x-ms-client-principal": principalHeader(["OCC.AccessAdmin"], "actor-2", "jamie@mvta.com", [{ typ: "acrs", val: "c1" }]),
      "idempotency-key": "approve-change-1",
    },
    body: { string: JSON.stringify({ decision: "approved" }) },
  }));

  assert.equal(response.status, 409);
  assert.deepEqual(response.jsonBody, { error: "Privileged access change is already being decided." });
});

test("a stale applying approval resumes from observed directory state", async () => {
  const applying = {
    id: "change-stale",
    environment: "test",
    change: {
      action: "grant" as const,
      principal_id: "user-1",
      principal_type: "user" as const,
      role: "OCC.Admin" as const,
      source: "group" as const,
      reason: "Duty manager",
    },
    status: "applying" as const,
    requested_by_id: "actor-1",
    requested_by_name: "alex@mvta.com",
    requested_at: "2026-08-14T10:00:00.000Z",
    approval_expires_at: "2026-08-15T10:00:00.000Z",
    decided_by_id: "actor-2",
    decided_by_name: "jamie@mvta.com",
    decided_at: "2026-08-14T11:00:00.000Z",
    result: null,
  };
  let applied = false;
  const directory: AccessDirectory = {
    listAccessPrincipals: async () => [{
      id: "user-1",
      display_name: "Taylor Operator",
      sign_in_name: "taylor@mvta.com",
      principal_type: "user",
      account_enabled: true,
      guest_state: null,
      assignments: [{ role: "OCC.Admin", source: "group", source_id: "group-admin", source_name: "OnBoard Admins" }],
    }],
    searchPrincipals: async () => [],
    getSignIns: async () => ({ summary: null, events: [] }),
    applyChange: async () => { applied = true; throw new Error("must not replay Graph mutation"); },
  };
  const store: AccessManagementStore = {
    ...emptyStore,
    getChange: async () => applying,
    claimChange: async () => true,
    decideChange: async (_id, status, actor, decidedAt, result) => ({
      ...applying, status, decided_by_id: actor.id, decided_by_name: actor.name, decided_at: decidedAt, result,
    }),
  };
  const handler = createAccessManagementHttpHandler({
    directory,
    store,
    environment: "test",
    now: () => new Date("2026-08-14T12:00:00.000Z"),
  });

  const response = await handler(new HttpRequest({
    method: "POST",
    url: "https://example.test/api/admin/access-management/changes/change-stale/decision",
    headers: {
      "x-ms-client-principal": principalHeader(["OCC.AccessAdmin"], "actor-3", "morgan@mvta.com", [{ typ: "acrs", val: "c1" }]),
      "idempotency-key": "resume-stale-approval",
    },
    body: { string: JSON.stringify({ decision: "approved" }) },
  }));

  assert.equal(response.status, 200);
  assert.equal(applied, false);
  assert.equal((response.jsonBody as { result: { message: string } }).result.message, "Directory state already reflects this change.");
});

test("an expired stale applying approval reaches the expired terminal state", async () => {
  const applying = {
    id: "change-expired",
    environment: "test",
    change: { action: "grant" as const, principal_id: "user-1", principal_type: "user" as const, role: "OCC.Admin" as const, source: "group" as const, reason: "Duty manager" },
    status: "applying" as const,
    requested_by_id: "actor-1",
    requested_by_name: "alex@mvta.com",
    requested_at: "2026-08-13T10:00:00.000Z",
    approval_expires_at: "2026-08-14T11:30:00.000Z",
    decided_by_id: "actor-2",
    decided_by_name: "jamie@mvta.com",
    decided_at: "2026-08-14T11:00:00.000Z",
    result: null,
  };
  let terminalStatus = "";
  const store: AccessManagementStore = {
    ...emptyStore,
    getChange: async () => applying,
    decideChange: async (_id, status) => {
      terminalStatus = status;
      return { ...applying, status };
    },
  };
  const directory: AccessDirectory = {
    listAccessPrincipals: async () => [], searchPrincipals: async () => [],
    getSignIns: async () => ({ summary: null, events: [] }),
    applyChange: async () => { throw new Error("must not mutate Entra"); },
  };
  const handler = createAccessManagementHttpHandler({ directory, store, environment: "test", now: () => new Date("2026-08-14T12:00:00.000Z") });
  const response = await handler(new HttpRequest({
    method: "POST",
    url: "https://example.test/api/admin/access-management/changes/change-expired/decision",
    headers: {
      "x-ms-client-principal": principalHeader(["OCC.AccessAdmin"], "actor-3", "morgan@mvta.com", [{ typ: "acrs", val: "c1" }]),
      "idempotency-key": "expire-stale-approval",
    },
    body: { string: JSON.stringify({ decision: "approved" }) },
  }));

  assert.equal(response.status, 410);
  assert.equal(terminalStatus, "expired");
});

test("the requester can cancel a pending privileged change without touching Entra", async () => {
  const pending = {
    id: "change-1",
    environment: "test",
    change: {
      action: "grant" as const,
      principal_id: "user-1",
      principal_type: "user" as const,
      role: "OCC.Admin" as const,
      source: "group" as const,
      reason: "Duty manager",
    },
    status: "pending" as const,
    requested_by_id: "actor-1",
    requested_by_name: "alex@mvta.com",
    requested_at: "2026-08-14T11:00:00.000Z",
    decided_by_id: null,
    decided_by_name: null,
    decided_at: null,
    result: null,
  };
  const store: AccessManagementStore = {
    ...emptyStore,
    getChange: async () => pending,
    decideChange: async (_id, decision, actor, decidedAt) => ({
      ...pending,
      status: decision,
      decided_by_id: actor.id,
      decided_by_name: actor.name,
      decided_at: decidedAt,
    }),
  };
  const directory: AccessDirectory = {
    listAccessPrincipals: async () => [],
    searchPrincipals: async () => [],
    getSignIns: async () => ({ summary: null, events: [] }),
    applyChange: async () => { throw new Error("cancellation must not touch Entra"); },
  };
  const handler = createAccessManagementHttpHandler({ directory, store, environment: "test" });

  const response = await handler(new HttpRequest({
    method: "POST",
    url: "https://example.test/api/admin/access-management/changes/change-1/cancel",
    headers: { "x-ms-client-principal": principalHeader(["OCC.AccessAdmin"]) },
    body: { string: JSON.stringify({ reason: "Request is no longer needed" }) },
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(response.jsonBody, { change_id: "change-1", status: "cancelled" });
});

test("multi-role guest onboarding creates one invitation and reuses the returned guest", async () => {
  const applied: Array<Parameters<AccessDirectory["applyChange"]>[0]> = [];
  let invitations = 0;
  const directory: AccessDirectory = {
    listAccessPrincipals: async () => [],
    searchPrincipals: async () => [],
    getSignIns: async () => ({ summary: null, events: [] }),
    inviteGuest: async () => {
      invitations += 1;
      return { principal_id: "guest-1", correlation_id: "invite-1" };
    },
    applyChange: async (change) => {
      applied.push(change);
      return { status: "pending_verification", correlation_id: `${change.role}-membership` };
    },
  };
  const operations = new Map<string, unknown>();
  let guestRecord: { principal_id: string; correlation_id: string | null } | null = null;
  const store: AccessManagementStore = {
    ...emptyStore,
    getOperation: async (key) => operations.get(key) ?? null,
    saveOperation: async (key, _environment, response) => { operations.set(key, response); },
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
  });
  const common = {
    action: "invite_guest",
    principal_id: "guest@example.com",
    principal_type: "user",
    source: "group",
    reason: "Sponsored project access",
    sponsor: "sponsor@mvta.com",
    organization: "Example Contractor",
    expires_at: "2026-09-01T00:00:00.000Z",
  };

  const response = await handler(new HttpRequest({
    method: "POST",
    url: "https://example.test/api/admin/access-management/changes",
    headers: {
      "x-ms-client-principal": principalHeader(["OCC.AccessAdmin"]),
      "idempotency-key": "guest-two-roles",
    },
    body: { string: JSON.stringify({ changes: [
      { ...common, role: "OCC.Viewer" },
      { ...common, role: "OCC.Detour" },
    ] }) },
  }));

  assert.equal(response.status, 200);
  assert.equal(invitations, 1);
  assert.deepEqual(applied[0], { ...common, action: "grant", principal_id: "guest-1", role: "OCC.Viewer" });
  assert.deepEqual(applied[1], { ...common, action: "grant", principal_id: "guest-1", role: "OCC.Detour" });
});

test("concurrent guest onboarding does not issue a second invitation", async () => {
  let invitations = 0;
  let assignments = 0;
  let metadataWrites = 0;
  const directory: AccessDirectory = {
    listAccessPrincipals: async () => [],
    searchPrincipals: async () => [],
    getSignIns: async () => ({ summary: null, events: [] }),
    inviteGuest: async () => {
      invitations += 1;
      return { principal_id: "duplicate", correlation_id: "duplicate" };
    },
    applyChange: async () => {
      assignments += 1;
      return { status: "completed", correlation_id: "duplicate" };
    },
  };
  const store: AccessManagementStore = {
    ...emptyStore,
    claimGuestInvitation: async () => ({ state: "in_progress" }),
    getGuestInvitation: async () => null,
    saveGuestInvitation: async () => undefined,
    recordMetadata: async () => { metadataWrites += 1; },
  };
  const handler = createAccessManagementHttpHandler({ directory, store, environment: "test" });

  const response = await handler(new HttpRequest({
    method: "POST",
    url: "https://example.test/api/admin/access-management/changes",
    headers: {
      "x-ms-client-principal": principalHeader(["OCC.AccessAdmin"]),
      "idempotency-key": "concurrent-guest",
    },
    body: { string: JSON.stringify({ changes: [{
      action: "invite_guest",
      principal_id: "guest@example.com",
      principal_type: "user",
      role: "OCC.Viewer",
      source: "group",
      reason: "Sponsored access",
      sponsor: "sponsor@mvta.com",
      organization: "Example Contractor",
      expires_at: "2026-09-01T00:00:00.000Z",
    }] }) },
  }));

  assert.equal(response.status, 200);
  assert.equal(invitations, 0);
  assert.equal(assignments, 0);
  assert.equal((response.jsonBody as { results: Array<{ disposition: string }> }).results[0]?.disposition, "failed");
  assert.equal(metadataWrites, 0);
});

test("a privileged guest change cannot be approved while another invitation owns the email claim", async () => {
  let finalStatus = "";
  let metadataWrites = 0;
  const pending = {
    id: "guest-admin-change",
    environment: "test",
    change: {
      action: "invite_guest" as const,
      principal_id: "guest@example.com",
      principal_type: "user" as const,
      role: "OCC.Admin" as const,
      source: "group" as const,
      reason: "Sponsored administration",
      sponsor: "sponsor@mvta.com",
      organization: "Example Contractor",
      expires_at: "2026-09-01T00:00:00.000Z",
    },
    status: "pending" as const,
    requested_by_id: "requester-1",
    requested_by_name: "requester@mvta.com",
    requested_at: "2026-08-14T11:00:00.000Z",
    approval_expires_at: "2026-08-14T13:00:00.000Z",
    decided_by_id: null,
    decided_by_name: null,
    decided_at: null,
    result: null,
  };
  const store: AccessManagementStore = {
    ...emptyStore,
    getChange: async () => pending,
    claimChange: async () => true,
    decideChange: async (_id, decision, actor, decidedAt, result) => {
      finalStatus = decision;
      return {
        ...pending,
        status: decision,
        decided_by_id: actor.id,
        decided_by_name: actor.name,
        decided_at: decidedAt,
        result,
      };
    },
    claimGuestInvitation: async () => ({ state: "in_progress" }),
    getGuestInvitation: async () => null,
    saveGuestInvitation: async () => undefined,
    recordMetadata: async () => { metadataWrites += 1; },
  };
  const directory: AccessDirectory = {
    listAccessPrincipals: async () => [],
    searchPrincipals: async () => [],
    getSignIns: async () => ({ summary: null, events: [] }),
    inviteGuest: async () => ({ principal_id: "duplicate", correlation_id: "duplicate" }),
    applyChange: async () => ({ status: "completed", correlation_id: "must-not-happen" }),
  };
  const handler = createAccessManagementHttpHandler({
    directory,
    store,
    environment: "test",
    privilegedAuthContext: "c1",
    now: () => new Date("2026-08-14T12:00:00.000Z"),
  });

  const response = await handler(new HttpRequest({
    method: "POST",
    url: "https://example.test/api/admin/access-management/changes/guest-admin-change/decision",
    headers: {
      "x-ms-client-principal": principalHeader(["OCC.AccessAdmin"], "approver-1", "approver@mvta.com", [{ typ: "acrs", val: "c1" }]),
      "idempotency-key": "approve-concurrent-guest",
    },
    body: { string: JSON.stringify({ decision: "approved" }) },
  }));

  assert.equal(response.status, 502);
  assert.equal(finalStatus, "failed");
  assert.equal(metadataWrites, 0);
});

test("stale guest invitation recovery reuses the guest found in Entra", async () => {
  let invitations = 0;
  const assigned: string[] = [];
  const directory: AccessDirectory = {
    listAccessPrincipals: async () => [],
    searchPrincipals: async () => [{
      id: "existing-guest",
      display_name: "Guest User",
      sign_in_name: "guest@example.com",
      principal_type: "user",
      account_enabled: true,
      guest_state: "PendingAcceptance",
      assignments: [],
    }],
    findGuestByEmail: async () => ({ principal_id: "existing-guest" }),
    getSignIns: async () => ({ summary: null, events: [] }),
    inviteGuest: async () => {
      invitations += 1;
      return { principal_id: "duplicate", correlation_id: "duplicate" };
    },
    applyChange: async (change) => {
      assigned.push(change.principal_id);
      return { status: "pending_verification", correlation_id: "membership-1" };
    },
  };
  const store: AccessManagementStore = {
    ...emptyStore,
    claimGuestInvitation: async () => ({ state: "recover" }),
    getGuestInvitation: async () => null,
    saveGuestInvitation: async () => undefined,
  };
  const handler = createAccessManagementHttpHandler({ directory, store, environment: "test" });

  await handler(new HttpRequest({
    method: "POST",
    url: "https://example.test/api/admin/access-management/changes",
    headers: {
      "x-ms-client-principal": principalHeader(["OCC.AccessAdmin"]),
      "idempotency-key": "recover-guest",
    },
    body: { string: JSON.stringify({ changes: [{
      action: "invite_guest",
      principal_id: "guest@example.com",
      principal_type: "user",
      role: "OCC.Viewer",
      source: "group",
      reason: "Sponsored access",
      sponsor: "sponsor@mvta.com",
      organization: "Example Contractor",
      expires_at: "2026-09-01T00:00:00.000Z",
    }] }) },
  }));

  assert.equal(invitations, 0);
  assert.deepEqual(assigned, ["existing-guest"]);
});

test("stale guest recovery waits when the accepted invitation is not visible in Entra", async () => {
  let invitations = 0;
  let metadataWrites = 0;
  const directory: AccessDirectory = {
    listAccessPrincipals: async () => [],
    searchPrincipals: async () => [],
    findGuestByEmail: async () => null,
    getSignIns: async () => ({ summary: null, events: [] }),
    inviteGuest: async () => {
      invitations += 1;
      return { principal_id: "duplicate", correlation_id: "duplicate" };
    },
    applyChange: async () => ({ status: "completed", correlation_id: "must-not-happen" }),
  };
  const store: AccessManagementStore = {
    ...emptyStore,
    claimGuestInvitation: async () => ({ state: "recover" }),
    getGuestInvitation: async () => null,
    saveGuestInvitation: async () => undefined,
    recordMetadata: async () => { metadataWrites += 1; },
  };
  const handler = createAccessManagementHttpHandler({ directory, store, environment: "test" });

  const response = await handler(new HttpRequest({
    method: "POST",
    url: "https://example.test/api/admin/access-management/changes",
    headers: {
      "x-ms-client-principal": principalHeader(["OCC.AccessAdmin"]),
      "idempotency-key": "recover-unobservable-guest",
    },
    body: { string: JSON.stringify({ changes: [{
      action: "invite_guest",
      principal_id: "guest@example.com",
      principal_type: "user",
      role: "OCC.Viewer",
      source: "group",
      reason: "Sponsored access",
      sponsor: "sponsor@mvta.com",
      organization: "Example Contractor",
      expires_at: "2026-09-01T00:00:00.000Z",
    }] }) },
  }));

  assert.equal(invitations, 0);
  assert.equal(metadataWrites, 0);
  assert.equal((response.jsonBody as { results: Array<{ disposition: string }> }).results[0]?.disposition, "failed");
});

test("a concurrent idempotency reservation blocks a duplicate directory mutation", async () => {
  let directoryRead = false;
  const directory: AccessDirectory = {
    listAccessPrincipals: async () => { directoryRead = true; return []; },
    searchPrincipals: async () => [],
    getSignIns: async () => ({ summary: null, events: [] }),
    applyChange: async () => { throw new Error("must not mutate Entra"); },
  };
  const store: AccessManagementStore = {
    ...emptyStore,
    reserveOperation: async () => ({ state: "in_progress" }),
  };
  const handler = createAccessManagementHttpHandler({ directory, store, environment: "test" });

  const response = await handler(new HttpRequest({
    method: "POST",
    url: "https://example.test/api/admin/access-management/changes",
    headers: {
      "x-ms-client-principal": principalHeader(["OCC.AccessAdmin"]),
      "idempotency-key": "same-operation",
    },
    body: { string: JSON.stringify({ changes: [{
      action: "grant",
      principal_id: "user-1",
      principal_type: "user",
      role: "OCC.Viewer",
      source: "group",
      reason: "Duplicate retry",
    }] }) },
  }));

  assert.equal(response.status, 409);
  assert.equal(directoryRead, false);
});
