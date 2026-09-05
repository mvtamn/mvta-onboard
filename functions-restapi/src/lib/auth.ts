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
  claims: Record<string, string[]>;
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
    const claims: Record<string, string[]> = {};
    for (const claim of principal.claims || []) {
      if (!claim || typeof claim.typ !== "string" || typeof claim.val !== "string") continue;
      (claims[claim.typ] ??= []).push(claim.val);
    }
    const userId = principal.userId?.trim()
      || claims.oid?.[0]
      || claims["http://schemas.microsoft.com/identity/claims/objectidentifier"]?.[0];
    return {
      userId,
      userDetails: principal.userDetails,
      roles,
      claims,
    };
  } catch {
    return null;
  }
}

// Standard role sets. Human publishing and workload ingestion are deliberately
// separate: System.Ingestion may create reviewable drafts, but must never
// inherit approval, edit, retract, or other human publishing authority.
export const STAFF_READ_ROLES = ["OCC.Viewer", "OCC.Publisher", "OCC.Admin", "OCC.EventAVL"];
export const DECISION_MATRIX_READ_ROLES = ["OCC.Viewer", "OCC.Publisher", "OCC.Admin"];
export const PUBLISH_ROLES = ["OCC.Publisher", "OCC.Admin"];
export const EVENT_AVL_WRITE_ROLES = ["OCC.EventAVL", "OCC.Admin"];
export const EVENT_AVL_NOTIFICATION_ROLES = [...PUBLISH_ROLES, "OCC.EventAVL"];
export const INGESTION_ROLES = ["System.Ingestion"];
export const ADMIN_ROLES = ["OCC.Admin"];
export const COMPLIANCE_READ_ROLES = [...STAFF_READ_ROLES, "OCC.Compliance", "OCC.ComplianceManager"];
export const COMPLIANCE_WRITE_ROLES = [...PUBLISH_ROLES, "OCC.Compliance", "OCC.ComplianceManager"];
export const COMPLIANCE_MANAGER_ROLES = ["OCC.ComplianceManager", ...ADMIN_ROLES];

// Detour & Closure module role sets (owner decision, 2026-08-06).
//
// OCC.Detour is a dedicated role for staff who maintain detours without
// necessarily holding the broader OCC.Publisher tier. It is ADDITIVE - the
// standard roles keep the detour access they already had, so assigning the
// new role in Entra can happen gradually with no outage. Note that nobody
// holds OCC.Detour until it is registered as an appRole on the app
// registration AND assigned per user.
//
// These are named constants rather than the inline [...STAFF_READ_ROLES,
// "OCC.Compliance"] spread used elsewhere in this codebase because the
// detour surface has four distinct tiers that must not drift apart - that
// drift is exactly what produced the OCC.Compliance bug fixed here (it sat
// in the console's nav constant but in none of the API's read roles, so
// Compliance users reached the page and got a 403 from GET /detours).
export const DETOUR_READ_ROLES = [...STAFF_READ_ROLES, "OCC.Compliance", "OCC.Detour"];

// Detour Intake is an administrative workflow in the current rollout. Report
// readers may see the resulting operational record, but only administrators
// may create, review, or advance an intake.
export const DETOUR_INTAKE_ROLES = ADMIN_ROLES;

// Create/edit. OCC.Detour deliberately does NOT get delete (below).
export const DETOUR_WRITE_ROLES = [...PUBLISH_ROLES, "OCC.Detour"];

// Soft-delete stays at the publisher tier - a retention safeguard on the
// people doing daily entry. OCC.Detour and OCC.Compliance are both absent
// on purpose.
export const DETOUR_DELETE_ROLES = PUBLISH_ROLES;

// Image/document attachment writes. Same membership as DETOUR_WRITE_ROLES,
// kept separate because the two answer different questions and B3's original
// rule ("attachments sit at the same tier as detour edit") is a decision that
// could be revisited independently. OCC.Compliance is intentionally NOT here:
// it previously had attachment writes without detour edit access, which
// contradicted that rule.
export const DETOUR_ATTACHMENT_WRITE_ROLES = DETOUR_WRITE_ROLES;
// Dispatch Log role sets (owner decision, 2026-09-05: SST OCS staff record
// verifications). OCC.TripStartVerify is a dedicated, ADDITIVE role for the
// contractor desk on the OCC.Detour pattern: it reads the trip-start log and
// records observations, and nothing else. It must be registered as an
// appRole and assigned per user before anyone holds it; the existing staff
// roles keep the read access they already had. Admin may record too, for
// corrections - a verification is an observation and stays a human act.
export const TRIP_START_LOG_READ_ROLES = [...STAFF_READ_ROLES, "OCC.Compliance", "OCC.TripStartVerify"];
export const TRIP_START_VERIFY_ROLES = ["OCC.TripStartVerify", ...ADMIN_ROLES];

export function requireRole(request: HttpRequest, allowedRoles: string[]): AuthResult {
  const principal = getCallerPrincipal(request);
  if (!principal) {
    return { authorized: false, status: 401, message: "Not authenticated." };
  }
  if (principal.roles.includes("System.Ingestion") && principal.roles.some((role) => role !== "System.Ingestion")) {
    return {
      authorized: false,
      status: 403,
      message: "System.Ingestion cannot be combined with a human OnBoard role.",
    };
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
