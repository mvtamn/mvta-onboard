// What the signed-in person may do, asked of the API once per sign-in
// (ADR-0032).
//
// The console used to read the `roles` claim out of the ID token and keep its
// own lists of which roles each page needed. Those lists and the API's drifted:
// a Compliance Manager could open the Compliance workspace and then be refused
// by every call it made. Now the server answers with Module Actions, the same
// answer it enforces with, and the console asks `can("detours.edit")`.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { MyAccess } from "@mvta/shared";
import { api } from "../config.js";
import { useAuth } from "./AuthContext.js";

export interface AccessState {
  /** Resolving the first answer. Gates render nothing rather than "Restricted". */
  loading: boolean;
  /** The call failed. Treated as unknown access, never as no access. */
  error: string | null;
  access: MyAccess | null;
  /** `can("detours.delete")` - the one question the console asks. */
  can: (action: string) => boolean;
  canAny: (actions: string[]) => boolean;
  /** True once the person is known to hold nothing at all. */
  noAccess: boolean;
  reload: () => void;
}

export const AccessContext = createContext<AccessState | null>(null);

export function useAccess(): AccessState {
  const ctx = useContext(AccessContext);
  if (!ctx) throw new Error("useAccess must be used inside an AccessProvider");
  return ctx;
}

export function accessStateFrom(
  access: MyAccess | null,
  loading: boolean,
  error: string | null,
  reload: () => void,
): AccessState {
  const held = new Set(access?.actions ?? []);
  return {
    loading,
    error,
    access,
    // An unresolved or failed answer grants nothing. The gate distinguishes
    // the two: loading and error say so, rather than claiming a refusal.
    can: (action: string) => held.has(action),
    canAny: (actions: string[]) => actions.some((action) => held.has(action)),
    noAccess: !loading && !error && held.size === 0,
    reload,
  };
}

export function AccessProvider({ children }: { children: ReactNode }) {
  const { account } = useAuth();
  const [access, setAccess] = useState<MyAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!account) {
      // Signed out: nothing to ask for, and no spinner to sit behind.
      setAccess(null);
      setLoading(false);
      setError(null);
      return;
    }
    let current = true;
    setLoading(true);
    setError(null);
    api
      .getMyAccess()
      .then((result) => {
        if (!current) return;
        setAccess(result);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!current) return;
        setAccess(null);
        setError(err instanceof Error ? err.message : "Your access could not be read.");
        setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [account, attempt]);

  const value = useMemo(() => accessStateFrom(access, loading, error, reload), [access, loading, error, reload]);
  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

/**
 * A resolved answer holding exactly these actions. Tests gate on it the way
 * the app does, instead of restating what a role name means.
 */
export function accessStateWith(actions: string[]): AccessState {
  return accessStateFrom(
    {
      person: { objectId: "test", tenantId: "test", name: "Test User", email: "test@example.com" },
      roles: [],
      actions,
      summary: [],
      ingestion: false,
      rolesInOnBoard: true,
    },
    false,
    null,
    () => undefined,
  );
}

/** Supplies a fixed answer. Dev mock auth and tests use it; nothing else should. */
export function StaticAccessProvider({ access, children }: { access: MyAccess; children: ReactNode }) {
  const value = useMemo(() => accessStateFrom(access, false, null, () => undefined), [access]);
  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}
