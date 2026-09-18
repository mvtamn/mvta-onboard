// Granting and revoking OnBoard access (ADR-0032, increment 5).
//
//   GET  /manage/access/people                     - access-identity.view
//   POST /manage/access/people/{personId}/roles    - access-identity.manage
//   POST /manage/access/grants/{grantId}/revoke    - access-identity.manage
//   GET  /manage/access/requests                   - access-identity.view
//   POST /manage/access/requests/{requestId}/{decision} - access-identity.approve
//   POST /manage/access/import                     - access-identity.manage
//   GET  /manage/access/health                     - access-identity.view
//
// A Privileged Access Change answers `pending_approval` rather than applying,
// and only a second Access Administrator holding access-identity.approve can
// decide it.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import type { CallerPrincipal } from "../lib/auth";
import { LEGACY_APP_ROLE_TO_ROLE_KEY } from "../lib/access";
import { requireAccess } from "../lib/access/require";
import { RoleRuleError } from "../lib/access/roles";
import {
  accessFindings,
  cancelRequest,
  decideRequest,
  grantRole,
  grantsAvailable,
  importAssignments,
  listPeople,
  listRequests,
  revokeGrant,
  type Actor,
  type ImportedAssignment,
} from "../lib/access/grants";

const NOT_READY = {
  status: 503,
  jsonBody: { error: "Access management is not set up in this environment yet. Apply migrations 129, 130 and 131." },
};

/**
 * The privileged authentication context Entra stamps on a stepped-up token.
 * Same setting the Entra-era flow used, so a tenant that configured it keeps
 * working unchanged.
 */
function steppedUp(principal: CallerPrincipal): boolean {
  const wanted = process.env.ONBOARD_PRIVILEGED_AUTH_CONTEXT?.trim() || "c1";
  const values = [
    ...(principal.claims.acrs ?? []),
    ...(principal.claims["http://schemas.microsoft.com/claims/authnclassreference"] ?? []),
  ];
  return values.includes(wanted);
}

function actorFrom(auth: { principal: CallerPrincipal }): Actor {
  return {
    objectId: auth.principal.userId ?? null,
    name: auth.principal.userDetails ?? null,
    steppedUp: steppedUp(auth.principal),
  };
}

function failed(error: unknown, context: InvocationContext, what: string) {
  if (error instanceof RoleRuleError) return { status: error.status, jsonBody: { error: error.message } };
  context.error(`${what} failed`, error);
  return { status: 500, jsonBody: { error: `Could not ${what}.` } };
}

async function body(request: HttpRequest): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    throw new RoleRuleError("Request body must be valid JSON.");
  }
}

app.http("accessPeopleList", {
  route: "manage/access/people",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = await requireAccess(request, "access-identity.view");
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    try {
      const pool = await getPool();
      if (!(await grantsAvailable(pool))) return NOT_READY;
      return { status: 200, jsonBody: { people: await listPeople(pool) } };
    } catch (error) {
      return failed(error, context, "read who holds access");
    }
  },
});

app.http("accessGrantRole", {
  route: "manage/access/people/{personId}/roles",
  methods: ["POST"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = await requireAccess(request, "access-identity.manage");
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    try {
      const pool = await getPool();
      if (!(await grantsAvailable(pool))) return NOT_READY;
      const input = await body(request);
      const outcome = await grantRole(
        pool,
        {
          personId: request.params.personId,
          roleKey: String(input.role_key ?? ""),
          reason: typeof input.reason === "string" ? input.reason : "",
          expiresAt: typeof input.expires_at === "string" ? input.expires_at : null,
        },
        actorFrom(auth),
      );
      return { status: outcome.disposition === "pending_approval" ? 202 : 200, jsonBody: outcome };
    } catch (error) {
      return failed(error, context, "grant the role");
    }
  },
});

app.http("accessRevokeGrant", {
  route: "manage/access/grants/{grantId}/revoke",
  methods: ["POST"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = await requireAccess(request, "access-identity.manage");
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    try {
      const pool = await getPool();
      if (!(await grantsAvailable(pool))) return NOT_READY;
      const input = await body(request);
      const outcome = await revokeGrant(
        pool,
        { grantId: request.params.grantId, reason: typeof input.reason === "string" ? input.reason : "" },
        actorFrom(auth),
      );
      return { status: outcome.disposition === "pending_approval" ? 202 : 200, jsonBody: outcome };
    } catch (error) {
      return failed(error, context, "remove the access");
    }
  },
});

app.http("accessRequestsList", {
  route: "manage/access/requests",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = await requireAccess(request, "access-identity.view");
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    try {
      const pool = await getPool();
      if (!(await grantsAvailable(pool))) return NOT_READY;
      return { status: 200, jsonBody: { requests: await listRequests(pool) } };
    } catch (error) {
      return failed(error, context, "read the pending changes");
    }
  },
});

app.http("accessRequestDecision", {
  route: "manage/access/requests/{requestId}/{decision}",
  methods: ["POST"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const decision = request.params.decision;
    // Cancelling your own request is ordinary management; approving is not.
    const action = decision === "cancel" ? "access-identity.manage" : "access-identity.approve";
    const auth = await requireAccess(request, action);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    try {
      const pool = await getPool();
      if (!(await grantsAvailable(pool))) return NOT_READY;
      const input = await body(request);
      const reason = typeof input.reason === "string" ? input.reason : undefined;
      const actor = actorFrom(auth);
      if (decision === "cancel") {
        return { status: 200, jsonBody: await cancelRequest(pool, { requestId: request.params.requestId, reason }, actor) };
      }
      if (decision !== "approve" && decision !== "reject") {
        return { status: 404, jsonBody: { error: "No such decision." } };
      }
      const result = await decideRequest(
        pool,
        { requestId: request.params.requestId, approve: decision === "approve", reason },
        actor,
      );
      return { status: 200, jsonBody: result };
    } catch (error) {
      return failed(error, context, "record the decision");
    }
  },
});

app.http("accessImportFromEntra", {
  route: "manage/access/import",
  methods: ["POST"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = await requireAccess(request, "access-identity.manage");
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    try {
      const pool = await getPool();
      if (!(await grantsAvailable(pool))) return NOT_READY;
      const input = await body(request);
      if (!Array.isArray(input.assignments)) throw new RoleRuleError("Send the Entra assignments to import.");
      // The console sends what the Entra inventory already showed it. The app
      // role is translated here rather than trusted: an unknown one is counted
      // and skipped, never invented as a role.
      const assignments: ImportedAssignment[] = input.assignments.map((raw) => {
        const entry = raw as Record<string, unknown>;
        const appRole = String(entry.app_role ?? "");
        return {
          objectId: String(entry.object_id ?? ""),
          tenantId: typeof entry.tenant_id === "string" ? entry.tenant_id : null,
          name: typeof entry.name === "string" ? entry.name : null,
          email: typeof entry.email === "string" ? entry.email : null,
          roleKey: LEGACY_APP_ROLE_TO_ROLE_KEY[appRole] ?? appRole,
          via: typeof entry.via === "string" ? entry.via : "app role",
        };
      });
      if (assignments.some((a) => !a.objectId)) throw new RoleRuleError("Every assignment needs an object id.");
      return { status: 200, jsonBody: await importAssignments(pool, assignments, actorFrom(auth)) };
    } catch (error) {
      return failed(error, context, "import the assignments");
    }
  },
});

app.http("accessHealthFindings", {
  route: "manage/access/health",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = await requireAccess(request, "access-identity.view");
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    try {
      const pool = await getPool();
      if (!(await grantsAvailable(pool))) return NOT_READY;
      return { status: 200, jsonBody: { findings: await accessFindings(pool) } };
    } catch (error) {
      return failed(error, context, "read access health");
    }
  },
});
