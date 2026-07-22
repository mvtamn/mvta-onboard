// Thin auth abstraction so components never import MSAL directly. Two
// implementations exist: MsalAuthProvider (real Entra sign-in, production) and
// MockAuthProvider (dev-only preview, see MockAuthProvider.tsx). Components
// consume useAuth() and stay identical under either provider.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useMsal } from "@azure/msal-react";
import { rolesOf, type AppRole } from "./roles.js";
import { loginRequest } from "./msalConfig.js";

export interface AuthAccount {
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

/** Real Entra ID auth via MSAL. Must be rendered inside <MsalProvider>. */
export function MsalAuthProvider({ children }: { children: ReactNode }) {
  const { instance, accounts } = useMsal();
  const account = accounts[0] ?? null;

  const value = useMemo<AuthState>(
    () => ({
      account: account ? { name: account.name, username: account.username } : null,
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
