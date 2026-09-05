import type { AccountInfo } from "@azure/msal-browser";

// OCC.Detour is a dedicated Detour & Closure role (read + create/edit, no
// delete). It must also be registered as an appRole on the Entra app
// registration and assigned per user before anyone actually holds it - adding
// it here only teaches the console to recognize the claim.
export type AppRole =
  | "OCC.Viewer"
  | "OCC.Publisher"
  | "OCC.Admin"
  | "OCC.Compliance"
  | "OCC.ComplianceManager"
  | "OCC.Detour"
  | "OCC.TripStartVerify"
  | "OCC.EventAVL"
  | "OCC.AccessAdmin"
  | "System.Ingestion";

// App roles are emitted as a `roles` claim array in the ID token.
export function rolesOf(account: AccountInfo | null): AppRole[] {
  const claims = account?.idTokenClaims as { roles?: string[] } | undefined;
  return (claims?.roles ?? []) as AppRole[];
}

export function hasAnyRole(account: AccountInfo | null, allowed: AppRole[]): boolean {
  const roles = rolesOf(account);
  return roles.some((r) => allowed.includes(r));
}

/** Human-readable names for Entra app-role values. Keep the values themselves
 * in APIs and authorization checks; these labels are only for the console. */
export function roleLabel(role: string): string {
  return ({
    "OCC.Viewer": "Viewer",
    "OCC.Publisher": "Alert Publisher",
    "OCC.Admin": "Operations Administrator",
    "OCC.Compliance": "Compliance Reviewer",
    "OCC.ComplianceManager": "Compliance Manager",
    "OCC.Detour": "Detour Manager",
    "OCC.TripStartVerify": "Trip Start Verifier",
    "OCC.AccessAdmin": "Access Administrator",
    "OCC.EventAVL": "Event AVL Manager",
    "OCC.DecisionMatrix": "Decision Matrix Viewer",
    "System.Ingestion": "Automated System Ingestion",
  } as Record<string, string>)[role] ?? role;
}
