// DEV-ONLY mock auth for local preview. Never part of a production bundle:
// main.tsx only reaches this module behind an `import.meta.env.DEV` static
// check, which Vite replaces with `false` in production builds — the entire
// path (and this file's chunk) is eliminated by tree-shaking.
//
// Provides a fake signed-in account plus a floating role-switcher widget so
// the RBAC gating (OCC Tools visibility, Compose access, RequireRole notices)
// can be exercised without any Entra setup. This only changes what the UI
// SHOWS — the REST API still enforces roles server-side (auth.js requireRole),
// so mock mode cannot authorize real writes.
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { AuthContext, type AuthState } from "./AuthContext.js";
import type { AppRole } from "./roles.js";

const MOCK_USERNAME = "dev.user.mock@mvta.com"; // grep marker: must NOT appear in prod bundles

const ROLE_PRESETS: { label: string; roles: AppRole[] }[] = [
  { label: "Admin", roles: ["OCC.Admin"] },
  { label: "Publisher", roles: ["OCC.Publisher"] },
  { label: "Viewer", roles: ["OCC.Viewer"] },
  { label: "No roles", roles: [] },
];

const widgetStyle: CSSProperties = {
  position: "fixed",
  bottom: 14,
  right: 14,
  zIndex: 9999,
  background: "#1a1a1a",
  color: "#fff",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 12,
  boxShadow: "0 4px 14px rgba(0,0,0,0.35)",
  display: "flex",
  flexDirection: "column",
  gap: 8,
  maxWidth: 220,
};

const btnStyle = (active: boolean): CSSProperties => ({
  fontSize: 12,
  padding: "5px 10px",
  borderRadius: 6,
  border: "1px solid #555",
  background: active ? "#F78E1E" : "#333",
  color: active ? "#1a1a1a" : "#fff",
  fontWeight: active ? 700 : 400,
  cursor: "pointer",
});

export function MockAuthProvider({ children }: { children: ReactNode }) {
  const [signedIn, setSignedIn] = useState(true);
  const [preset, setPreset] = useState(0);

  const value = useMemo<AuthState>(
    () => ({
      account: signedIn ? { name: "Dev User (mock)", username: MOCK_USERNAME } : null,
      roles: signedIn ? ROLE_PRESETS[preset].roles : [],
      signIn: () => setSignedIn(true),
      signOut: () => setSignedIn(false),
    }),
    [signedIn, preset],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      <div style={widgetStyle}>
        <div style={{ fontWeight: 700 }}>
          MOCK AUTH <span style={{ color: "#F78E1E" }}>· dev preview only</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {ROLE_PRESETS.map((p, i) => (
            <button key={p.label} style={btnStyle(signedIn && i === preset)} onClick={() => { setPreset(i); setSignedIn(true); }}>
              {p.label}
            </button>
          ))}
          <button style={btnStyle(!signedIn)} onClick={() => setSignedIn(false)}>
            Signed out
          </button>
        </div>
        <div style={{ color: "#aaa" }}>
          Simulates Entra app roles. The API still enforces roles server-side.
        </div>
      </div>
    </AuthContext.Provider>
  );
}
