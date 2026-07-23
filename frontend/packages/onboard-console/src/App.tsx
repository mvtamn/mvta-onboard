import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth/AuthContext.js";
import { RequireRole } from "./auth/RequireRole.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { useTheme } from "./theme/ThemeContext.js";
import { useLiveStats } from "./hooks/useLiveStats.js";
import {
  IconDashboard,
  IconCompose,
  IconMessages,
  IconBell,
  IconUsers,
  IconClock,
  IconGear,
  IconWrench,
  IconSun,
  IconMoon,
} from "./components/NavIcons.js";
import { Dashboard } from "./routes/Dashboard.js";
import { Compose } from "./routes/Compose.js";
import { ActiveMessages } from "./routes/ActiveMessages.js";
import { SuggestedAlerts } from "./routes/SuggestedAlerts.js";
import { Subscribers } from "./routes/Subscribers.js";
import { AuditLog } from "./routes/AuditLog.js";
import { Admin } from "./routes/Admin.js";
import { OccTools } from "./routes/OccTools.js";

const ADMIN = ["OCC.Admin"] as const;

const PAGE_META: { match: (path: string) => boolean; title: string; sub: string }[] = [
  { match: (p) => p === "/", title: "Dashboard", sub: "Compose and monitor active rider alerts" },
  { match: (p) => p === "/compose", title: "Compose", sub: "Draft a new rider-facing announcement" },
  { match: (p) => p === "/active", title: "Active Messages", sub: "Edit or retract currently active alerts" },
  { match: (p) => p === "/suggested", title: "Suggested Alerts", sub: "Review predictive delay and wait-time candidates" },
  { match: (p) => p === "/subscribers", title: "Subscribers", sub: "Opt-in totals and recent signups" },
  { match: (p) => p === "/audit", title: "Audit Log", sub: "Search every message ever posted" },
  { match: (p) => p === "/admin", title: "Admin", sub: "Expiration defaults and system configuration" },
  { match: (p) => p.startsWith("/occ"), title: "OCC Tools", sub: "Event monitoring, decision matrix, and OTP compliance" },
];

function currentPageMeta(pathname: string) {
  return PAGE_META.find((p) => p.match(pathname)) ?? PAGE_META[0];
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function App() {
  const { account, roles, signIn, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  const isAdmin = roles.includes("OCC.Admin");
  const stats = useLiveStats();
  const location = useLocation();
  const meta = currentPageMeta(location.pathname);

  if (!account) {
    return (
      <div className="frame">
        <div className="content-col">
          <div className="signin">
            <h1>MVTA OnBoard Console</h1>
            <p>Staff sign-in required.</p>
            <button className="btn-primary" onClick={signIn}>
              Sign in with Microsoft
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="frame">
      <aside className="nav-sidebar">
        <div className="nav-brand">
          <span className="logo-badge">MVTA</span>
          <div>
            <div className="nav-brand-text">OnBoard</div>
            <div className="nav-brand-sub">v1.0.0</div>
          </div>
        </div>

        <nav className="nav-list">
          <NavLink to="/" end><IconDashboard />Dashboard</NavLink>
          <NavLink to="/compose"><IconCompose />Compose</NavLink>
          <NavLink to="/active"><IconMessages />Active Messages</NavLink>
          <NavLink to="/suggested"><IconBell />Suggested Alerts</NavLink>
          <NavLink to="/subscribers"><IconUsers />Subscribers</NavLink>
          <NavLink to="/audit"><IconClock />Audit Log</NavLink>
          {isAdmin && <NavLink to="/admin"><IconGear />Admin</NavLink>}

          {isAdmin && (
            <>
              <div className="nav-section-label">Tools</div>
              <NavLink to="/occ"><IconWrench />OCC Tools</NavLink>
            </>
          )}
        </nav>

        <div className="nav-spacer" />
        <div className="nav-footer">
          <div className="nav-status">
            <span className="live-dot" />
            {stats.ok ? "Console live" : "Console offline"}
          </div>
          <span className="nav-version">
            {stats.activeCount ?? "—"} active · Synced {stats.syncedAt ? stats.syncedAt.toLocaleTimeString() : "—"}
          </span>
        </div>
      </aside>

      <div className="content-col">
        <header className="content-topbar">
          <div>
            <h1>{meta.title}</h1>
            <div className="subtitle">{meta.sub}</div>
          </div>
          <div className="topbar-actions">
            <span className="tr-text">Session: {new Date().toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}</span>
            <span className="pill-user">
              <span className="avatar">{initialsOf(account.name ?? account.username)}</span>
              {account.name ?? account.username} · {roles.join(", ") || "no roles"}
            </span>
            <button className="theme-toggle-btn" title="Toggle theme" onClick={toggle}>
              {theme === "dark" ? <IconSun /> : <IconMoon />}
            </button>
            <button className="btn-signout" onClick={signOut}>Sign out</button>
          </div>
        </header>

        <main className="content-main">
          {/* Keyed by pathname so navigating to a different route always
              remounts a fresh boundary, rather than staying stuck on a
              previous route's error. */}
          <ErrorBoundary key={location.pathname}>
            <Routes>
              <Route path="/" element={<Dashboard stats={stats} onChanged={stats.refresh} />} />
              <Route path="/compose" element={<Compose onChanged={stats.refresh} />} />
              <Route path="/active" element={<ActiveMessages onChanged={stats.refresh} />} />
              <Route path="/suggested" element={<SuggestedAlerts onChanged={stats.refresh} />} />
              <Route path="/subscribers" element={<Subscribers />} />
              <Route path="/audit" element={<AuditLog />} />
              <Route
                path="/admin"
                element={
                  <RequireRole allowed={[...ADMIN]}>
                    <Admin />
                  </RequireRole>
                }
              />
              <Route
                path="/occ/*"
                element={
                  <RequireRole allowed={[...ADMIN]}>
                    <OccTools />
                  </RequireRole>
                }
              />
            </Routes>
          </ErrorBoundary>
        </main>

        <div className="footer">
          <span>MVTA OnBoard · v1.0.0 · Azure SQL + Service Bus + Entra ID · Internal Use Only</span>
          <span>
            {stats.activeCount ?? "—"} active · {stats.pending?.length ?? "—"} pending alerts · Synced{" "}
            {stats.syncedAt ? stats.syncedAt.toLocaleTimeString() : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}
