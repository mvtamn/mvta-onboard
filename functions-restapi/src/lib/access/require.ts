// requireAccess: the one check in front of every handler (ADR-0032,
// increment 2).
//
// It asks whether the caller holds a Module Action - `detours.delete` - rather
// than whether they hold one of a list of role names. Role lists were copied
// into the console and into 94 files here, and the copies drifted: Compliance
// Manager could open a page whose data calls refused it. An action is decided
// once, in the role the person holds, and both sides read the same answer.
//
// Failures read the way the Roles page does, in the catalog's own words, so a
// 403 says what is missing instead of listing role names nobody can act on.
import type { HttpRequest } from "@azure/functions";
import { getCallerPrincipal, type CallerPrincipal } from "../auth";
import { actionLabel, findModule } from "./catalog";
import { resolveEffectiveAccess } from "./index";
import { INGESTION_APP_ROLE } from "./seeds";
import type { EffectiveAccess } from "./types";

export type AccessResult =
  | { authorized: true; principal: CallerPrincipal; access: EffectiveAccess }
  | { authorized: false; status: number; message: string };

/** "View on Dispatch Log", for a message a person can act on. */
export function describeAction(action: string): string {
  const [moduleKey] = action.split(".");
  const module = moduleKey ? findModule(moduleKey) : undefined;
  const label = actionLabel(action);
  if (!module || !label) return action;
  return `${label} on ${module.label}`;
}

/**
 * 401 without a principal, 403 without the action. A caller holding
 * `System.Ingestion` never passes: a workload identity has no person record
 * and inherits no human authority, the rule requireRole enforced by refusing
 * the combination outright.
 */
export async function requireAccess(request: HttpRequest, action: string): Promise<AccessResult> {
  const principal = getCallerPrincipal(request);
  if (!principal) {
    return { authorized: false, status: 401, message: "Not authenticated." };
  }
  const access = await resolveEffectiveAccess(principal);
  if (access.ingestion) {
    return {
      authorized: false,
      status: 403,
      message: "System.Ingestion holds no human OnBoard access.",
    };
  }
  if (!access.actions.includes(action)) {
    return {
      authorized: false,
      status: 403,
      message: access.roles.length
        ? `Requires ${describeAction(action)}. Your roles are: ${access.roles.map((r) => r.name).join(", ")}.`
        : `Requires ${describeAction(action)}. You hold no OnBoard role yet - ask an Access Administrator.`,
    };
  }
  return { authorized: true, principal, access };
}

/**
 * Shared reference data - the route list, a map token - which every module's
 * page needs and none of them owns. The gate is holding any OnBoard access at
 * all, which is what the old staff-read set meant here.
 */
export async function requireAnyOnBoardAccess(request: HttpRequest): Promise<AccessResult> {
  const principal = getCallerPrincipal(request);
  if (!principal) {
    return { authorized: false, status: 401, message: "Not authenticated." };
  }
  const access = await resolveEffectiveAccess(principal);
  if (access.ingestion || access.actions.length === 0) {
    return {
      authorized: false,
      status: 403,
      message: "Requires an OnBoard role - ask an Access Administrator.",
    };
  }
  return { authorized: true, principal, access };
}

/**
 * An endpoint a workload identity shares with people: creating a reviewable
 * alert draft. `System.Ingestion` passes on its app role alone and gains no
 * other authority; a human needs the action.
 */
export async function requireAccessOrIngestion(request: HttpRequest, action: string): Promise<AccessResult> {
  const principal = getCallerPrincipal(request);
  if (principal?.roles.includes(INGESTION_APP_ROLE)) {
    const access = await resolveEffectiveAccess(principal);
    if (access.ingestion) return { authorized: true, principal, access };
  }
  return requireAccess(request, action);
}

/**
 * Holding any one of several actions. Used where one route serves readers of
 * two modules - the Audit Log, which Governance and Access Administrators both
 * read - and never to soften a single module's own gate.
 */
export async function requireAnyAccess(request: HttpRequest, actions: string[]): Promise<AccessResult> {
  let last: AccessResult = { authorized: false, status: 403, message: "Requires OnBoard access." };
  for (const action of actions) {
    const result = await requireAccess(request, action);
    if (result.authorized) return result;
    last = result;
    if (result.status === 401) return result;
  }
  return {
    ...last,
    message: `Requires one of: ${actions.map(describeAction).join("; ")}.`,
  };
}
