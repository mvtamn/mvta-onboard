import { useEffect, useState } from "react";
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
  IconShield,
  IconHistory,
  IconDetour,
  IconSun,
  IconMoon,
  IconAssessment,
  IconBus,
  IconMenu,
} from "./components/NavIcons.js";
import { Dashboard } from "./routes/Dashboard.js";
import { ServiceOperations } from "./routes/ServiceOperations.js";
import { ServiceOperationsOverview } from "./routes/ServiceOperationsOverview.js";
import { ServiceRiskQuality } from "./routes/ServiceRiskQuality.js";
import { Compose } from "./routes/Compose.js";
import { ActiveMessages } from "./routes/ActiveMessages.js";
import { SuggestedAlerts } from "./routes/SuggestedAlerts.js";
import { Subscribers } from "./routes/Subscribers.js";
import { AuditLog } from "./routes/AuditLog.js";
import { Admin } from "./routes/Admin.js";
import { OccTools } from "./routes/OccTools.js";
import { EventMonitoring } from "./routes/modules/EventMonitoring.js";
import { EventPlanning } from "./routes/EventPlanning.js";
import { EventWorkspaceProvider } from "./context/EventWorkspaceContext.js";
import { Compliance } from "./routes/Compliance.js";
import { PerformanceAssessment } from "./routes/PerformanceAssessment.js";
import { Detours } from "./routes/Detours.js";
import { DetourReports } from "./routes/DetourReports.js";
import { DetourIntake } from "./routes/DetourIntake.js";
import { Changelog } from "./routes/Changelog.js";
import {
  FixedRouteRefreshProvider,
  formatRefreshCountdown,
  useFixedRouteRefresh,
} from "./context/FixedRouteRefreshContext.js";

const ADMIN = ["OCC.Admin"] as const;
const EVENT_AVL = ["OCC.Viewer", "OCC.Publisher", "OCC.Admin"] as const;
const COMPLIANCE = ["OCC.Compliance", "OCC.Admin"] as const;
// Read-only for OCC.Viewer, full create/edit/delete for Publisher/Admin (the
// component itself hides write controls for Viewer-only; the server is the
// real boundary, same convention as Compose).
// Must stay in sync with DETOUR_READ_ROLES in functions-restapi/src/lib/auth.ts.
// These two drifting apart is what previously let OCC.Compliance reach this
// page and then get a 403 from GET /detours.
const DETOURS = ["OCC.Viewer", "OCC.Publisher", "OCC.Admin", "OCC.Compliance", "OCC.Detour"] as const;

const PAGE_META: { match: (path: string) => boolean; title: string; sub: string }[] = [
  { match: (p) => p === "/", title: "Dashboard", sub: "Compose and monitor active rider alerts" },
  { match: (p) => p.startsWith("/service-operations/compose") || p === "/compose", title: "Compose", sub: "Draft a new Service Alert" },
  { match: (p) => p.startsWith("/service-operations/active") || p === "/active", title: "Active Service Alerts", sub: "Edit or retract currently active alerts" },
  { match: (p) => p.startsWith("/service-operations/suggested") || p === "/suggested", title: "Suggested Alerts", sub: "Review predictive delay and wait-time candidates" },
  { match: (p) => p.startsWith("/service-operations/risk"), title: "Service Risk & Quality", sub: "Investigate fixed-route and on-demand service risk" },
  { match: (p) => p === "/service-operations", title: "Service Operations", sub: "Service-alert communications and operational monitoring" },
  { match: (p) => p === "/subscribers", title: "Subscribers", sub: "Opt-in totals and recent signups" },
  { match: (p) => p === "/audit", title: "Audit Log", sub: "Search every message ever posted" },
  { match: (p) => p === "/detours", title: "Detours & Closures", sub: "Every detour/closure in one place, Avail-built or not" },
  { match: (p) => p === "/detour-intake", title: "Detour Intake", sub: "Capture and review preliminary closure reports" },
  { match: (p) => p === "/detour-reports", title: "Detour Reports", sub: "Search and export detour history — read-only" },
  { match: (p) => p === "/admin", title: "Admin", sub: "Expiration defaults and system configuration" },
  {
    match: (p) => p === "/event-monitoring",
    title: "Event AVL",
    sub: "Monitor active vehicles and event service in real time",
  },
  { match: (p) => p === "/event-planning", title: "Event Planning", sub: "Prepare and approve event service plans" },
  {
    match: (p) => p.startsWith("/occ"),
    title: "OCC Tools",
    sub: "Service-risk prediction, procedure guidance, and vehicle monitoring",
  },
  {
    match: (p) => p.startsWith("/compliance"),
    title: "Compliance",
    sub: "OTP compliance and missed-trip investigation",
  },
  {
    match: (p) => p.startsWith("/performance-assessment"),
    title: "Performance Assessment",
    sub: "Monthly performance standards scoring, evidence, review, and issuance",
  },
  { match: (p) => p === "/changelog", title: "Changelog", sub: "Version history" },
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

function FixedRouteRefreshIndicator() {
  const { secondsLeft, refreshing } = useFixedRouteRefresh();
  return (
    <span
      className="fixed-route-refresh-indicator"
      title="Service Risk & Quality continues refreshing while you navigate the console"
    >
      <span className={refreshing ? "refresh-pulse" : ""} />
      Service risk {refreshing ? "refreshing…" : `refresh ${formatRefreshCountdown(secondsLeft)}`}
    </span>
  );
}

export function App() {
  const { account, roles, signIn, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  const isAdmin = roles.includes("OCC.Admin");
  const isCompliance = isAdmin || roles.includes("OCC.Compliance");
  const canSeeDetours = roles.some((r) => (DETOURS as readonly string[]).includes(r));
  const canSeeEventAvl = roles.some((r) => (EVENT_AVL as readonly string[]).includes(r));
  const stats = useLiveStats();
  const location = useLocation();
  const meta = currentPageMeta(location.pathname);
  // Below 860px the sidebar goes off-canvas (see .nav-sidebar in styles.css)
  // - this just tracks whether it's pulled into view, and closes it on every
  // navigation so it never stays open covering the next page.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  useEffect(() => { setMobileNavOpen(false); }, [location.pathname]);

  if (!account) {
    return (
      <div className="signin-backdrop">
        <div className="signin-card">
          <span className="signin-logo">MVTA</span>
          <div className="signin-eyebrow">Staff Console</div>
          <h1>Welcome to the MVTA OnBoard console</h1>
          <p className="signin-desc">
            Sign in with your MVTA Microsoft 365 account to manage service alerts and rider
            notifications.
          </p>
          <button className="btn-primary signin-btn" onClick={signIn}>
            Sign in with Microsoft
          </button>
          <p className="signin-footer">Internal MVTA use only</p>
        </div>
      </div>
    );
  }

  return (
    <FixedRouteRefreshProvider>
      <EventWorkspaceProvider>
      <div className="frame">
        <aside className={`nav-sidebar${mobileNavOpen ? " is-open" : ""}`}>
        <div className="nav-brand">
          <span className="logo-badge">MVTA</span>
          <div>
            <div className="nav-brand-text">OnBoard</div>
            <div className="nav-brand-sub">v{__APP_VERSION__}</div>
          </div>
        </div>

        <nav className="nav-list">
          <NavLink to="/" end><IconDashboard />Dashboard</NavLink>
          <div className="nav-section-label">Service Operations</div>
          <NavLink to="/service-operations" end><IconDashboard />Overview</NavLink>
          <NavLink to="/service-operations/compose"><IconCompose />Compose</NavLink>
          <NavLink to="/service-operations/active"><IconMessages />Active Service Alerts</NavLink>
          <NavLink to="/service-operations/suggested"><IconBell />Suggested Alerts</NavLink>
          {isAdmin && <NavLink to="/service-operations/risk"><IconWrench />Service Risk &amp; Quality</NavLink>}
          <NavLink to="/subscribers"><IconUsers />Subscribers</NavLink>
          <NavLink to="/audit"><IconClock />Audit Log</NavLink>
          <NavLink to="/changelog"><IconHistory />Changelog</NavLink>
          {isAdmin && <NavLink to="/admin"><IconGear />Admin</NavLink>}

          {/* The detour pages live in this grouped section rather than the
              flat primary nav above - they are an ops workspace, not one of
              the rider-message primaries. The group header renders if ANY
              child does, so a Detour-only user still sees a labelled group
              rather than two orphaned links. */}
          {(isAdmin || isCompliance || canSeeDetours || canSeeEventAvl) && (
            <>
              <div className="nav-section-label">Tools</div>
              {canSeeDetours && <NavLink to="/detours"><IconDetour />Detours &amp; Closures</NavLink>}
              {canSeeDetours && <NavLink to="/detour-intake"><IconDetour />Detour Intake</NavLink>}
              {canSeeDetours && <NavLink to="/detour-reports"><IconClock />Detour Reports</NavLink>}
              {canSeeEventAvl && <div className="nav-section-label">Event Workspace</div>}
              {isAdmin && <NavLink to="/event-planning"><IconBus />Event Planning</NavLink>}
              {canSeeEventAvl && <NavLink to="/event-monitoring"><IconBus />Event AVL</NavLink>}
              {isAdmin && <NavLink to="/occ"><IconWrench />OCC Tools</NavLink>}
              {isCompliance && <NavLink to="/compliance"><IconShield />Compliance</NavLink>}
              {isCompliance && <NavLink to="/performance-assessment"><IconAssessment />Performance Assessment</NavLink>}
            </>
          )}
        </nav>

        <div className="nav-spacer" />
        <div className="nav-footer">
          <div className="nav-status">
            <span className="live-dot" />
            {stats.ok ? "Console live" : "Console offline"}
          </div>
        </div>
        </aside>
        {mobileNavOpen && (
          <button
            className="nav-backdrop"
            aria-label="Close navigation"
            onClick={() => setMobileNavOpen(false)}
          />
        )}

        <div className="content-col">
        <header className="content-topbar">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              className="nav-toggle-btn"
              aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen((open) => !open)}
            >
              <IconMenu />
            </button>
            <div>
              <h1>{meta.title}</h1>
              <div className="subtitle">{meta.sub}</div>
            </div>
          </div>
          <div className="topbar-actions">
            <FixedRouteRefreshIndicator />
            <span className="tr-text">Session: {new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" })}</span>
            <span className="pill-user">
              <span className="avatar">{initialsOf(account.name ?? account.username)}</span>
              {account.name ?? account.username} · {roles.join(", ") || "no roles"}
            </span>
            <button
              className="theme-toggle-btn"
              title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              onClick={toggle}
            >
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
              <Route path="/service-operations" element={<ServiceOperations />}>
                <Route index element={<ServiceOperationsOverview stats={stats} />} />
                <Route path="compose" element={<Compose onChanged={stats.refresh} />} />
                <Route path="active" element={<ActiveMessages onChanged={stats.refresh} />} />
                <Route path="suggested" element={<SuggestedAlerts onChanged={stats.refresh} />} />
                <Route
                  path="risk"
                  element={<RequireRole allowed={[...ADMIN]}><ServiceRiskQuality /></RequireRole>}
                />
              </Route>
              <Route path="/compose" element={<Compose onChanged={stats.refresh} />} />
              <Route path="/active" element={<ActiveMessages onChanged={stats.refresh} />} />
              <Route
                path="/detours"
                element={
                  <RequireRole allowed={[...DETOURS]}>
                    <Detours />
                  </RequireRole>
                }
              />
              {/* Same role set as /detours - the reports page reads the very
                  same GET /detours endpoint, so anything narrower would be a
                  nav link that 403s. */}
              <Route
                path="/detour-reports"
                element={
                  <RequireRole allowed={[...DETOURS]}>
                    <DetourReports />
                  </RequireRole>
                }
              />
              <Route
                path="/detour-intake"
                element={<RequireRole allowed={[...DETOURS]}><DetourIntake /></RequireRole>}
              />
              <Route path="/suggested" element={<SuggestedAlerts onChanged={stats.refresh} />} />
              <Route path="/subscribers" element={<Subscribers />} />
              <Route path="/audit" element={<AuditLog />} />
              <Route path="/changelog" element={<Changelog />} />
              <Route
                path="/admin"
                element={
                  <RequireRole allowed={[...ADMIN]}>
                    <Admin />
                  </RequireRole>
                }
              />
              <Route
                path="/event-monitoring"
                element={
                  <RequireRole allowed={[...EVENT_AVL]}>
                    <EventMonitoring />
                  </RequireRole>
                }
              />
              <Route
                path="/event-planning"
                element={<RequireRole allowed={[...ADMIN]}><EventPlanning /></RequireRole>}
              />
              <Route
                path="/occ/*"
                element={
                  <RequireRole allowed={[...ADMIN]}>
                    <OccTools />
                  </RequireRole>
                }
              />
              <Route
                path="/compliance/*"
                element={
                  <RequireRole allowed={[...COMPLIANCE]}>
                    <Compliance />
                  </RequireRole>
                }
              />
              <Route
                path="/performance-assessment/*"
                element={
                  <RequireRole allowed={[...COMPLIANCE]}>
                    <PerformanceAssessment />
                  </RequireRole>
                }
              />
            </Routes>
          </ErrorBoundary>
        </main>

        <div className="footer">
          <span>MVTA OnBoard · v{__APP_VERSION__} · Internal Use Only</span>
          <span>Internal MVTA operations console</span>
        </div>
        </div>
      </div>
      </EventWorkspaceProvider>
    </FixedRouteRefreshProvider>
  );
}
