// Thin auth abstraction so components never import MSAL directly. Two
// implementations exist: MsalAuthProvider (real Entra sign-in, production) and
// MockAuthProvider (dev-only preview, see MockAuthProvider.tsx). Components
// consume useAuth() and stay identical under either provider.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { InteractionStatus, type AccountInfo } from "@azure/msal-browser";
import { useMsal } from "@azure/msal-react";
import { rolesOf, type AppRole } from "./roles.js";
import { loginRequest } from "./msalConfig.js";

export interface AuthAccount {
  id?: string;
  name?: string;
  username: string;
}

export interface AuthState {
  /** null = signed out */
  account: AuthAccount | null;
  roles: AppRole[];
  signIn: () => void;
  signOut: () => void;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside an auth provider");
  return ctx;
}

// MSAL restores cached accounts before its redirect/silent interaction has
// finished. Rendering protected pages during that interval starts API calls
// without a usable access token, leaving data views in a false loading state.
export function accountAfterInteraction(accounts: AccountInfo[], inProgress: InteractionStatus): AccountInfo | null {
  return inProgress === InteractionStatus.None ? accounts[0] ?? null : null;
}

/** Real Entra ID auth via MSAL. Must be rendered inside <MsalProvider>. */
export function MsalAuthProvider({ children }: { children: ReactNode }) {
  const { instance, accounts, inProgress } = useMsal();
  const account = accountAfterInteraction(accounts, inProgress);

  const value = useMemo<AuthState>(
    () => ({
      account: account ? { id: typeof account.idTokenClaims?.oid === "string" ? account.idTokenClaims.oid : undefined, name: account.name, username: account.username } : null,
      roles: rolesOf(account),
      signIn: () => {
        void instance.loginRedirect(loginRequest);
      },
      signOut: () => {
        void instance.logoutRedirect();
      },
    }),
    [account, instance],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
