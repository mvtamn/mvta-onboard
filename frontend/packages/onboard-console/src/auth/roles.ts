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
  | "OCC.Detour"
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
