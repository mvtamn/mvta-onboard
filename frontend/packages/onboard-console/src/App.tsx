import { useEffect, useState } from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth/AuthContext.js";
import { roleLabel } from "./auth/roles.js";
import { RequireRole } from "./auth/RequireRole.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { useTheme } from "./theme/ThemeContext.js";
import { useLiveStats } from "./hooks/useLiveStats.js";
import {
  IconDashboard,
  IconCompose,
  IconMessages,
  IconBell,
  IconClock,
  IconWrench,
  IconShield,
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
import { AdminLayout } from "./components/AdminLayout.js";
import { AdminAccess, AdminEventAdministration, AdminGovernance, AdminIntegrations, AdminServiceConfiguration, AdminSubscribers } from "./routes/AdminModules.js";
import { CHANGELOG_ENTRIES } from "./routes/changelogData.js";
import { FixedRouteRefreshProvider } from "./context/FixedRouteRefreshContext.js";
import { dataStateLabel } from "./hooks/useLiveStats.js";

const ADMIN = ["OCC.Admin"] as const;
const ACCESS_MANAGEMENT = import.meta.env.VITE_ACCESS_ADMIN_FALLBACK === "true"
  ? ["OCC.AccessAdmin", "OCC.Admin"] as const
  : ["OCC.AccessAdmin"] as const;
const OCC_TOOLS = ["OCC.Viewer", "OCC.Publisher", "OCC.Admin"] as const;
const EVENT_AVL = ["OCC.Viewer", "OCC.Publisher", "OCC.Admin", "OCC.EventAVL"] as const;
const COMPLIANCE = ["OCC.Compliance", "OCC.ComplianceManager", "OCC.Admin"] as const;
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
  { match: (p) => p === "/detour-intake", title: "Detour Intake", sub: "Create and review the complete operational Detour record" },
  { match: (p) => p === "/detour-reports", title: "Detour Reports", sub: "Search and export detour history — read-only" },
  { match: (p) => p === "/admin" || p.startsWith("/admin/"), title: "Administration", sub: "Manage access, resources, configuration, integrations, and governance" },
  {
    match: (p) => p === "/event-monitoring" || p === "/events/avl",
    title: "Event AVL",
    sub: "Monitor active vehicles and event service in real time",
  },
  { match: (p) => p === "/event-planning" || p === "/events/planning", title: "Event Planning", sub: "Prepare and approve event service plans" },
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

function CompatibilityRedirect({ to }: { to: string }) {
  const location = useLocation();
  return <Navigate to={`${to}${location.search}${location.hash}`} replace />;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function ChangelogPopover({ onClose }: { onClose: () => void }) {
  const currentRelease = CHANGELOG_ENTRIES.find((entry) => entry.version === __APP_VERSION__);
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="changelog-overlay" role="presentation" onClick={onClose}>
      <section className="changelog-popover" role="dialog" aria-modal="true" aria-labelledby="changelog-popover-title" onClick={(event) => event.stopPropagation()}>
        <button className="changelog-close" onClick={onClose} aria-label="Close release notes" autoFocus>×</button>
        <span className="changelog-popover-kicker">OnBoard release notes</span>
        <h2 id="changelog-popover-title">What’s new in v{__APP_VERSION__}</h2>
        {currentRelease ? (
          <>
            <time className="changelog-popover-date" dateTime={currentRelease.date}>{currentRelease.date}</time>
            <ul>
              {currentRelease.sections.flatMap((section) => section.items).map((item) => <li key={item}>{item}</li>)}
            </ul>
          </>
        ) : (
          <p className="changelog-popover-empty">Release notes for this build are not available yet.</p>
        )}
        <NavLink className="changelog-full-link" to="/changelog" onClick={onClose}>View full changelog →</NavLink>
      </section>
    </div>
  );
}

export function App() {
  const { account, roles, signIn, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  const isAdmin = roles.includes("OCC.Admin");
  const canManageAccess = roles.some((role) => (ACCESS_MANAGEMENT as readonly string[]).includes(role));
  const canSeeOccTools = roles.some((role) => (OCC_TOOLS as readonly string[]).includes(role));
  const isCompliance = isAdmin || roles.includes("OCC.Compliance") || roles.includes("OCC.ComplianceManager");
  const canSeeDetours = roles.some((r) => (DETOURS as readonly string[]).includes(r));
  const canSeeEventAvl = roles.some((r) => (EVENT_AVL as readonly string[]).includes(r));
  const stats = useLiveStats();
  const location = useLocation();
  const meta = currentPageMeta(location.pathname);
  // Below 860px the sidebar goes off-canvas (see .nav-sidebar in styles.css)
  // - this just tracks whether it's pulled into view, and closes it on every
  // navigation so it never stays open covering the next page.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [specialistOpen, setSpecialistOpen] = useState(true);
  const [eventsOpen, setEventsOpen] = useState(true);
  const [complianceOpen, setComplianceOpen] = useState(true);
  const [adminOpen, setAdminOpen] = useState(true);
  const [changelogOpen, setChangelogOpen] = useState(false);
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
            <button className="nav-version-button" onClick={() => setChangelogOpen(true)} aria-haspopup="dialog">
              <span className="nav-version-number">v{__APP_VERSION__}</span>
              <span>What’s new</span>
            </button>
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
          {(isAdmin || isCompliance || canSeeDetours || canSeeOccTools) && (
            <section className="nav-group">
              <button className="nav-group-toggle" aria-expanded={specialistOpen} onClick={() => setSpecialistOpen((open) => !open)}>
                <span>Specialist Operations</span><span aria-hidden="true">{specialistOpen ? "⌃" : "›"}</span>
              </button>
              {specialistOpen ? <div className="nav-group-links">
                {canSeeDetours && <NavLink to="/detours"><IconDetour />Detours &amp; Closures</NavLink>}
                {isAdmin && <NavLink to="/detour-intake"><IconDetour />Detour Intake</NavLink>}
                {canSeeDetours && <NavLink to="/detour-reports"><IconClock />Detour Reports</NavLink>}
              {canSeeOccTools && <NavLink to="/occ"><IconWrench />OCC Tools</NavLink>}
              </div> : null}
            </section>
          )}
          {canSeeEventAvl && <section className="nav-group">
            <button className="nav-group-toggle" aria-expanded={eventsOpen} onClick={() => setEventsOpen((open) => !open)}>
              <span>Events</span><span aria-hidden="true">{eventsOpen ? "⌃" : "›"}</span>
            </button>
            {eventsOpen ? <div className="nav-group-links">
              {isAdmin && <NavLink to="/events/planning"><IconBus />Planning</NavLink>}
              <NavLink to="/events/avl"><IconBus />Event AVL</NavLink>
            </div> : null}
          </section>}
          {isCompliance && <section className="nav-group">
            <button className="nav-group-toggle" aria-expanded={complianceOpen} onClick={() => setComplianceOpen((open) => !open)}>
              <span>Compliance &amp; Assessment</span><span aria-hidden="true">{complianceOpen ? "⌃" : "›"}</span>
            </button>
            {complianceOpen ? <div className="nav-group-links">
              <NavLink to="/compliance"><IconShield />Compliance</NavLink>
              <NavLink to="/performance-assessment"><IconAssessment />Performance Assessment</NavLink>
            </div> : null}
          </section>}
          <section className="nav-group nav-group-administration">
            {(isAdmin || canManageAccess) && <>
              <button className="nav-group-toggle" aria-expanded={adminOpen} onClick={() => setAdminOpen((open) => !open)}>
                <span>Administration</span><span aria-hidden="true">{adminOpen ? "⌃" : "›"}</span>
              </button>
              {adminOpen ? <div className="nav-group-links">
                {canManageAccess && <NavLink to="/admin/access"><IconShield />Access &amp; Identity</NavLink>}
                {isAdmin && <NavLink to="/admin/events"><IconBus />Event Administration</NavLink>}
                {isAdmin && <NavLink to="/admin/service"><IconWrench />Service Configuration</NavLink>}
                {isAdmin && <NavLink to="/admin/integrations"><IconWrench />Integrations &amp; Data Health</NavLink>}
                {canManageAccess && <NavLink to="/admin/governance"><IconClock />Governance &amp; Audit</NavLink>}
              </div> : null}
            </>}
          </section>
        </nav>

        <div className="nav-spacer" />
        <div className="nav-footer">
          <div className="nav-status">
            <span className="live-dot" />
            {stats.ok ? "Console Live" : "Console Offline"}
          </div>
        </div>
        </aside>
        {changelogOpen ? <ChangelogPopover onClose={() => setChangelogOpen(false)} /> : null}
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
            <span className={`topbar-system-status ${stats.overallState}`} role="status">
              <span className="live-dot" />
              {dataStateLabel(stats.overallState)}
            </span>
            <span className="pill-user">
              <span className="avatar">{initialsOf(account.name ?? account.username)}</span>
              {account.name ?? account.username} · {roles.map(roleLabel).join(", ") || "No assigned access"}
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
                element={<RequireRole allowed={[...ADMIN]}><DetourIntake /></RequireRole>}
              />
              <Route path="/suggested" element={<SuggestedAlerts onChanged={stats.refresh} />} />
              <Route path="/subscribers" element={<Subscribers />} />
              <Route path="/audit" element={<AuditLog />} />
              <Route path="/changelog" element={<Changelog />} />
              <Route path="/admin/access-management" element={<CompatibilityRedirect to="/admin/access" />} />
              <Route path="/admin" element={<RequireRole allowed={[...ACCESS_MANAGEMENT]}><AdminLayout /></RequireRole>}>
                <Route index element={<Navigate to="service" replace />} />
                <Route path="access" element={<RequireRole allowed={[...ACCESS_MANAGEMENT]}><AdminAccess /></RequireRole>} />
                <Route path="events" element={<RequireRole allowed={[...ADMIN]}><AdminEventAdministration /></RequireRole>} />
                <Route path="service" element={<RequireRole allowed={[...ADMIN]}><AdminServiceConfiguration /></RequireRole>} />
                <Route path="integrations" element={<RequireRole allowed={[...ADMIN]}><AdminIntegrations /></RequireRole>} />
                <Route path="governance" element={<RequireRole allowed={[...ACCESS_MANAGEMENT]}><AdminGovernance /></RequireRole>} />
                <Route path="subscribers" element={<RequireRole allowed={[...ACCESS_MANAGEMENT]}><AdminSubscribers /></RequireRole>} />
              </Route>
              <Route path="/event-monitoring" element={<CompatibilityRedirect to="/events/avl" />} />
              <Route path="/event-planning" element={<CompatibilityRedirect to="/events/planning" />} />
              <Route path="/events" element={<Navigate to="/events/avl" replace />} />
              <Route path="/events/avl/field" element={<RequireRole allowed={[...EVENT_AVL]}><EventMonitoring fieldView /></RequireRole>} />
              <Route path="/events/avl" element={<RequireRole allowed={[...EVENT_AVL]}><EventMonitoring /></RequireRole>} />
              <Route path="/events/planning" element={<RequireRole allowed={[...ADMIN]}><EventPlanning /></RequireRole>} />
              <Route
                path="/occ/*"
                element={
                  <RequireRole allowed={[...OCC_TOOLS]}>
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
          <span>MVTA OnBoard · v{__APP_VERSION__} · Authorized Use Only</span>
          <span>Internal MVTA Operations Console</span>
        </div>
        </div>
      </div>
      </EventWorkspaceProvider>
    </FixedRouteRefreshProvider>
  );
}
