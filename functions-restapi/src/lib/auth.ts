// Reads the caller's identity and app roles from the headers Azure App
// Service Authentication ("Easy Auth") injects. Easy Auth is configured
// on both Function Apps via Bicep (see infra-phase1/modules/functionapp.bicep)
// in "allow anonymous" mode - anonymous requests still reach the code
// (GET handlers simply don't call requireRole), while requests presenting
// a valid Entra ID token get validated by the platform and this header
// gets populated with the resulting roles.
import type { HttpRequest } from "@azure/functions";

interface ClientPrincipalClaim {
  typ?: string;
  val?: string;
}

interface ClientPrincipal {
  userId?: string;
  userDetails?: string;
  claims?: ClientPrincipalClaim[];
}

export interface CallerPrincipal {
  userId?: string;
  userDetails?: string;
  roles: string[];
}

export type AuthResult =
  | { authorized: true; principal: CallerPrincipal }
  | { authorized: false; status: number; message: string };

export function getCallerPrincipal(request: HttpRequest): CallerPrincipal | null {
  const header = request.headers.get("x-ms-client-principal");
  if (!header) {
    return null;
  }
  try {
    const decoded = Buffer.from(header, "base64").toString("utf-8");
    const principal = JSON.parse(decoded) as ClientPrincipal;
    // Guard c.typ: a claim missing its `typ` field would otherwise throw on
    // .endsWith(), and because that throw is swallowed by the catch below it
    // would silently return null - i.e. a legitimately authenticated staff
    // member gets a 401. Skip malformed claims instead.
    const roles = (principal.claims || [])
      .filter(
        (c): c is ClientPrincipalClaim & { typ: string; val: string } =>
          !!c &&
          typeof c.typ === "string" &&
          typeof c.val === "string" &&
          (c.typ === "roles" || c.typ.endsWith("/role")),
      )
      .map((c) => c.val);
    return {
      userId: principal.userId,
      userDetails: principal.userDetails,
      roles,
    };
  } catch {
    return null;
  }
}

// Standard role sets. Reads are open to any staff role; message writes to
// publishers and admins; admin configuration to admins only. System.Ingestion
// is the Power Automate service principal (writes messages, never reads admin).
export const STAFF_READ_ROLES = ["OCC.Viewer", "OCC.Publisher", "OCC.Admin"];
export const PUBLISH_ROLES = ["OCC.Publisher", "OCC.Admin", "System.Ingestion"];
export const ADMIN_ROLES = ["OCC.Admin"];

export function requireRole(request: HttpRequest, allowedRoles: string[]): AuthResult {
  const principal = getCallerPrincipal(request);
  if (!principal) {
    return { authorized: false, status: 401, message: "Not authenticated." };
  }
  const hasRole = principal.roles.some((r) => allowedRoles.includes(r));
  if (!hasRole) {
    return {
      authorized: false,
      status: 403,
      message: `Requires one of: ${allowedRoles.join(", ")}. Caller has: ${principal.roles.join(", ") || "(none)"}.`,
    };
  }
  return { authorized: true, principal };
}
