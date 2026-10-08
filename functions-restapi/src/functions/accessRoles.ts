// The Roles page's API (ADR-0032, increment 4).
//
//   GET    /manage/access/catalog      - access-identity.view: the module grid
//   GET    /manage/access/roles        - access-identity.view
//   POST   /manage/access/roles        - access-identity.manage
//   PATCH  /manage/access/roles/{key}  - access-identity.manage
//   POST   /manage/access/roles/{key}/archive  - access-identity.manage
//   POST   /manage/access/roles/{key}/restore  - access-identity.manage
//   GET    /manage/access/roles/{key}/history  - access-identity.view
//
// `manage/` rather than `admin/`, which is a reserved route prefix on Azure
// Functions (PR #178).
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { MODULES, VIEW, VIEW_LABEL } from "../lib/access";
import { requireAccess } from "../lib/access/require";
import {
  archiveRole,
  createRole,
  listRoles,
  restoreRole,
  roleHistory,
  RoleRuleError,
  rolesAvailable,
  updateRole,
  type RoleEditor,
} from "../lib/access/roles";

const NOT_READY = {
  status: 503,
  jsonBody: { error: "Roles are not set up in this environment yet. Apply migrations 129 and 130." },
};

function editorFrom(auth: { principal: { userId?: string; userDetails?: string } }): RoleEditor {
  return { objectId: auth.principal.userId ?? null, name: auth.principal.userDetails ?? null };
}

function failed(error: unknown, context: InvocationContext, what: string) {
  if (error instanceof RoleRuleError) {
    return { status: error.status, jsonBody: { error: error.message } };
  }
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

app.http("accessRoleCatalog", {
  route: "manage/access/catalog",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest) => {
    const auth = await requireAccess(request, "access-identity.view");
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    // The page draws the grid from this, so the catalog stays defined once.
    return {
      status: 200,
      jsonBody: {
        modules: MODULES.map((module) => ({
          key: module.key,
          label: module.label,
          section: module.section,
          actions: [{ key: VIEW, label: VIEW_LABEL }, ...module.actions],
        })),
      },
    };
  },
});

app.http("accessRolesList", {
  route: "manage/access/roles",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = await requireAccess(request, "access-identity.view");
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    try {
      const pool = await getPool();
      if (!(await rolesAvailable(pool))) return NOT_READY;
      return { status: 200, jsonBody: { roles: await listRoles(pool) } };
    } catch (error) {
      return failed(error, context, "read the roles");
    }
  },
});

app.http("accessRoleCreate", {
  route: "manage/access/roles",
  methods: ["POST"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = await requireAccess(request, "access-identity.manage");
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    try {
      const pool = await getPool();
      if (!(await rolesAvailable(pool))) return NOT_READY;
      const role = await createRole(pool, await body(request), editorFrom(auth));
      return { status: 201, jsonBody: { role } };
    } catch (error) {
      return failed(error, context, "create the role");
    }
  },
});

app.http("accessRoleUpdate", {
  route: "manage/access/roles/{key}",
  methods: ["PATCH"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = await requireAccess(request, "access-identity.manage");
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    try {
      const pool = await getPool();
      if (!(await rolesAvailable(pool))) return NOT_READY;
      const role = await updateRole(pool, request.params.key, await body(request), editorFrom(auth));
      return { status: 200, jsonBody: { role } };
    } catch (error) {
      return failed(error, context, "save the role");
    }
  },
});

app.http("accessRoleArchive", {
  route: "manage/access/roles/{key}/{action}",
  methods: ["POST"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = await requireAccess(request, "access-identity.manage");
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const action = request.params.action;
    if (action !== "archive" && action !== "restore") {
      return { status: 404, jsonBody: { error: "No such role action." } };
    }
    try {
      const pool = await getPool();
      if (!(await rolesAvailable(pool))) return NOT_READY;
      const editor = editorFrom(auth);
      const role =
        action === "archive"
          ? await archiveRole(pool, request.params.key, editor)
          : await restoreRole(pool, request.params.key, editor);
      return { status: 200, jsonBody: { role } };
    } catch (error) {
      return failed(error, context, `${action} the role`);
    }
  },
});

app.http("accessRoleHistory", {
  route: "manage/access/roles/{key}/history",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = await requireAccess(request, "access-identity.view");
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    try {
      const pool = await getPool();
      if (!(await rolesAvailable(pool))) return NOT_READY;
      return { status: 200, jsonBody: { history: await roleHistory(pool, request.params.key) } };
    } catch (error) {
      return failed(error, context, "read the role's history");
    }
  },
});
