// Reads the caller's identity from the headers Azure App Service
// Authentication ("Easy Auth") injects. Easy Auth is configured on both
// Function Apps via Bicep (see infra-phase1/modules/functionapp.bicep) in
// "allow anonymous" mode - anonymous requests still reach the code and are
// refused there - while a request presenting a valid Entra ID token gets
// validated by the platform and this header gets populated.
//
// This file answers who the caller is. What they may do is Effective Access
// (src/lib/access), resolved from their Role Grants: since the cutover the
// `roles` claim decides nothing for a person, and is read only for the one
// workload identity, System.Ingestion.
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

// Nothing below this point any more: the role sets and requireRole that used to
// live here were deleted at the cutover (ADR-0032, increment 6). A handler asks
// requireAccess in src/lib/access/require.ts whether the caller holds a Module
// Action, and the answer comes from their Role Grants rather than from a claim.
//
// `System.Ingestion` is still read from a token - a workload identity has no
// person record - and that check lives with the rest of the access rules.
