import type { AccountInfo } from "@azure/msal-browser";

export type AppRole = "OCC.Viewer" | "OCC.Publisher" | "OCC.Admin" | "System.Ingestion";

// App roles are emitted as a `roles` claim array in the ID token.
export function rolesOf(account: AccountInfo | null): AppRole[] {
  const claims = account?.idTokenClaims as { roles?: string[] } | undefined;
  return (claims?.roles ?? []) as AppRole[];
}

export function hasAnyRole(account: AccountInfo | null, allowed: AppRole[]): boolean {
  const roles = rolesOf(account);
  return roles.some((r) => allowed.includes(r));
}
