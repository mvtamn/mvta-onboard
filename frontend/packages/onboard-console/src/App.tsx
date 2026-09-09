import { useEffect, useState, type ReactNode } from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
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
  IconClock,
  IconWrench,
  IconShield,
  IconDetour,
  IconSun,
  IconMoon,
  IconAssessment,
  IconBus,
  IconMenu,
  IconGear,
  IconChevronDown,
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
import { TripStartLog } from "./routes/modules/tripStartLog/TripStartLog.js";
import { EventMonitoring } from "./routes/modules/EventMonitoring.js";
import { DecisionMatrixAdmin } from "./routes/DecisionMatrixAdmin.js";
import { EventPlanning } from "./routes/EventPlanning.js";
import { EventWorkspaceProvider } from "./context/EventWorkspaceContext.js";
import { AppDialogProvider } from "./components/AppDialog.js";
import { Compliance } from "./routes/Compliance.js";
import { PerformanceAssessment } from "./routes/PerformanceAssessment.js";
import { Detours } from "./routes/Detours.js";
import { DetourReports } from "./routes/DetourReports.js";
import { DetourIntake } from "./routes/DetourIntake.js";
import { Changelog } from "./routes/Changelog.js";
import { AdminLayout } from "./components/AdminLayout.js";
import { OnDemandServiceStandardsAdmin } from "./routes/OnDemandServiceStandardsAdmin.js";
import { AdminAccess, AdminEventAdministration, AdminGovernance, AdminIntegrations, AdminServiceConfiguration, AdminSubscribers } from "./routes/AdminModules.js";
import { OtpComplianceAdmin } from "./routes/OtpComplianceAdmin.js";
import { PerformanceStandardsAdmin } from "./routes/PerformanceStandardsAdmin.js";
import { PerformanceContractorsAdmin } from "./routes/PerformanceContractorsAdmin.js";
import { PerformanceAgreementsAdmin } from "./routes/PerformanceAgreementsAdmin.js";
import { PerformanceListsAdmin } from "./routes/PerformanceListsAdmin.js";
import { CHANGELOG_ENTRIES } from "./routes/changelogData.js";
import { FixedRouteRefreshProvider } from "./context/FixedRouteRefreshContext.js";
import { OperatorIdentity } from "./components/OperatorIdentity.js";

const ADMIN = ["OCC.Admin"] as const;
const ACCESS_MANAGEMENT = import.meta.env.VITE_ACCESS_ADMIN_FALLBACK === "true"
  ? ["OCC.AccessAdmin", "OCC.Admin"] as const
  : ["OCC.AccessAdmin"] as const;
const OCC_TOOLS = ["OCC.Viewer", "OCC.Publisher", "OCC.Admin"] as const;
// Dispatch Log reads the same trip-start log the API serves to staff and
// Compliance readers (TRIP_START_LOG_READ_ROLES); a live monitoring view,
// so it sits under Service Operations per ADR 0015.
const DISPATCH_LOG = ["OCC.Viewer", "OCC.Publisher", "OCC.Admin", "OCC.Compliance", "OCC.TripStartVerify"] as const;
// The communications side of Service Operations - Overview, Compose, Active
// Service Alerts, Suggested Alerts - reads the API's STAFF_READ_ROLES. Roles
// outside it (Compliance-only, the SST desk's OCC.TripStartVerify) get a 403
// from every call those pages make, so per ADR 0015 the links are hidden for
// them and the group shows only the children they can reach.
const COMMUNICATIONS = ["OCC.Viewer", "OCC.Publisher", "OCC.Admin", "OCC.EventAVL"] as const;
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
  { match: (p) => p.startsWith("/service-operations/dispatch-log"), title: "Dispatch Log", sub: "Watch every revenue trip start against its schedule" },
  { match: (p) => p === "/service-operations", title: "Service Operations", sub: "Service-alert communications and operational monitoring" },
  { match: (p) => p === "/subscribers", title: "Subscribers", sub: "Opt-in totals and recent signups" },
  { match: (p) => p === "/audit", title: "Audit Log", sub: "Search every message ever posted" },
  { match: (p) => p === "/detours", title: "Detours & Closures", sub: "Every detour/closure in one place, Avail-built or not" },
  { match: (p) => p === "/detour-intake", title: "Detour Intake", sub: "Create and review the complete operational Detour record" },
  { match: (p) => p === "/detour-reports", title: "Detour Reports", sub: "Search and export detour history — read-only" },
  { match: (p) => p === "/admin" || p.startsWith("/admin/"), title: "Administration", sub: "Manage access, resources, configuration, integrations, and governance" },
  {
    match: (p) => p === "/event-monitoring" || p.startsWith("/events/avl"),
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
  {
    match: (p) => p.startsWith("/admin/performance"),
    title: "Performance Assessment setup",
    sub: "Contractors, Agreements, the standards catalog and the lists behind them",
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

// One description per destination, shown in the collapsed rail's hover
// flyout. PAGE_META can't supply these - it folds all of /admin/* into a
// single "Administration" entry, and the flyout needs a line per link.
type NavEntry = { to: string; end?: boolean; label: string; desc: string; icon: ReactNode };
// `cluster` marks a category that folds into ONE icon while the rail is
// collapsed (Administration: eight links, four of them the same wrench, which
// is an unreadable icon stack at 64px). Its links move into a hover menu.
type NavCategory = { id: string; name: string; entries: NavEntry[]; cluster?: ReactNode };

function navEntries(...items: (NavEntry | false | null | undefined)[]): NavEntry[] {
  return items.filter((item): item is NavEntry => Boolean(item));
}

const NAV_COLLAPSED_KEY = "mvta-onboard-nav-collapsed";
// The version whose release notes have been opened. Anything else means the
// footer chip carries an unread dot.
const CHANGELOG_SEEN_KEY = "mvta-onboard-changelog-seen";

const NARROW_QUERY = "(max-width: 860px)";

function matchesNarrow(): boolean {
  // jsdom has no matchMedia; the shell must still render in tests.
  return typeof window.matchMedia === "function" && window.matchMedia(NARROW_QUERY).matches;
}

function readChangelogSeen(): string | null {
  try {
    return window.localStorage.getItem(CHANGELOG_SEEN_KEY);
  } catch {
    return null;
  }
}

function readNavCollapsed(): boolean {
  try {
    return window.localStorage.getItem(NAV_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
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

  return <AuthenticatedApp account={account} roles={roles} signOut={signOut} />;
}

function AuthenticatedApp({ account, roles, signOut }: {
  account: NonNullable<ReturnType<typeof useAuth>["account"]>;
  roles: ReturnType<typeof useAuth>["roles"];
  signOut: ReturnType<typeof useAuth>["signOut"];
}) {
  const { theme, toggle } = useTheme();
  const isAdmin = roles.includes("OCC.Admin");
  const canSeeServiceRisk = roles.some((role) => (OCC_TOOLS as readonly string[]).includes(role));
  const canSeeDispatchLog = roles.some((role) => (DISPATCH_LOG as readonly string[]).includes(role));
  const canSeeCommunications = roles.some((role) => (COMMUNICATIONS as readonly string[]).includes(role));
  const canManageAccess = roles.some((role) => (ACCESS_MANAGEMENT as readonly string[]).includes(role));
  const canSeeOccTools = roles.some((role) => (OCC_TOOLS as readonly string[]).includes(role));
  const isCompliance = isAdmin || roles.includes("OCC.Compliance") || roles.includes("OCC.ComplianceManager");
  const canSeeDetours = roles.some((r) => (DETOURS as readonly string[]).includes(r));
  const canSeeEventAvl = roles.some((r) => (EVENT_AVL as readonly string[]).includes(r));
  // Where a user without communications access lands instead of the
  // Dashboard, which is built from the same data they cannot read.
  const landing = canSeeCommunications ? null
    : canSeeDispatchLog ? "/service-operations/dispatch-log"
    : isCompliance ? "/compliance"
    : canSeeDetours ? "/detours"
    : null;
  const stats = useLiveStats();
  const location = useLocation();
  const meta = currentPageMeta(location.pathname);
  // Below 860px the sidebar goes off-canvas (see .nav-sidebar in styles.css)
  // - this just tracks whether it's pulled into view, and closes it on every
  // navigation so it never stays open covering the next page.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Desktop-only rail collapse (icon-only, 64px). Persisted so an operator who
  // wants the extra map/table width keeps it across sessions and page reloads.
  const [navCollapsed, setNavCollapsed] = useState(readNavCollapsed);
  // Categories start open; only the ones a user has closed are recorded.
  const [closedGroups, setClosedGroups] = useState<Record<string, boolean>>({});
  // Which collapsed-rail cluster menu is pinned open by a click. Hover and
  // keyboard focus open it too (CSS), so this is only for touch and for
  // keeping it up while the pointer travels to a row.
  const [openCluster, setOpenCluster] = useState<string | null>(null);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [changelogSeen, setChangelogSeen] = useState(readChangelogSeen);
  // Below 860px the rail is an off-canvas drawer with labels (see
  // .nav-sidebar in styles.css), so the collapsed-rail affordances - the
  // Administration cluster and the hover flyouts - must not render there.
  const [isNarrow, setIsNarrow] = useState(matchesNarrow);
  useEffect(() => { setMobileNavOpen(false); }, [location.pathname]);
  useEffect(() => {
    try {
      window.localStorage.setItem(NAV_COLLAPSED_KEY, navCollapsed ? "true" : "false");
    } catch {
      // Private-browsing / storage-disabled: collapsing still works, it just
      // won't survive a reload.
    }
  }, [navCollapsed]);
  // Expanding the rail dismisses any pinned cluster menu - it belongs to the
  // collapsed rail only, and would otherwise reopen the next time it collapses.
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(NARROW_QUERY);
    const onChange = (event: MediaQueryListEvent) => setIsNarrow(event.matches);
    setIsNarrow(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  useEffect(() => { if (!navCollapsed) setOpenCluster(null); }, [navCollapsed]);
  useEffect(() => { setOpenCluster(null); }, [location.pathname]);

  function openChangelog() {
    setChangelogOpen(true);
    setChangelogSeen(__APP_VERSION__);
    try {
      window.localStorage.setItem(CHANGELOG_SEEN_KEY, __APP_VERSION__);
    } catch {
      // Storage disabled: the dot just comes back on the next load.
    }
  }

  const railCollapsed = navCollapsed && !isNarrow;

  const navCategories: NavCategory[] = [
    {
      id: "service-operations",
      name: "Service Operations",
      entries: navEntries(
        canSeeCommunications && { to: "/", end: true, label: "Dashboard", desc: "Compose and monitor active rider alerts", icon: <IconDashboard /> },
        canSeeCommunications && { to: "/service-operations", end: true, label: "Overview", desc: "Service-alert communications and operational monitoring", icon: <IconDashboard /> },
        canSeeCommunications && { to: "/service-operations/compose", label: "Compose", desc: "Draft a new Service Alert", icon: <IconCompose /> },
        canSeeCommunications && { to: "/service-operations/active", label: "Active Service Alerts", desc: "Edit or retract currently active alerts", icon: <IconMessages /> },
        canSeeCommunications && { to: "/service-operations/suggested", label: "Suggested Alerts", desc: "Review predictive delay and wait-time candidates", icon: <IconBell /> },
        canSeeServiceRisk && { to: "/service-operations/risk", label: "Service Risk & Quality", desc: "Investigate fixed-route and on-demand service risk", icon: <IconWrench /> },
        canSeeDispatchLog && { to: "/service-operations/dispatch-log", label: "Dispatch Log", desc: "Watch every revenue trip start against its schedule", icon: <IconClock /> },
      ),
    },
    {
      id: "specialist-operations",
      name: "Specialist Operations",
      entries: navEntries(
        canSeeDetours && { to: "/detours", label: "Detours & Closures", desc: "Every detour and closure in one place, Avail-built or not", icon: <IconDetour /> },
        isAdmin && { to: "/detour-intake", label: "Detour Intake", desc: "Create and review the complete operational Detour record", icon: <IconDetour /> },
        canSeeDetours && { to: "/detour-reports", label: "Detour Reports", desc: "Search and export detour history — read-only", icon: <IconClock /> },
        canSeeOccTools && { to: "/occ", label: "OCC Tools", desc: "Service-risk prediction, procedure guidance, and vehicle monitoring", icon: <IconWrench /> },
      ),
    },
    {
      id: "events",
      name: "Events",
      entries: navEntries(
        canSeeEventAvl && isAdmin && { to: "/events/planning", label: "Planning", desc: "Prepare and approve event service plans", icon: <IconBus /> },
        canSeeEventAvl && { to: "/events/avl", label: "Event AVL", desc: "Monitor active vehicles and event service in real time", icon: <IconBus /> },
      ),
    },
    {
      id: "compliance",
      name: "Compliance & Assessment",
      entries: navEntries(
        isCompliance && { to: "/compliance", label: "Compliance", desc: "OTP compliance and missed-trip investigation", icon: <IconShield /> },
        isCompliance && { to: "/performance-assessment", label: "Performance Assessment", desc: "Monthly standards scoring, evidence, review, and issuance", icon: <IconAssessment /> },
      ),
    },
    {
      id: "administration",
      name: "Administration",
      cluster: <IconGear />,
      entries: navEntries(
        canManageAccess && { to: "/admin/access", label: "Access & Identity", desc: "Roles, sign-in, and who can reach which workspace", icon: <IconShield /> },
        isAdmin && { to: "/admin/events", label: "Event Administration", desc: "The event catalog and the resources behind it", icon: <IconBus /> },
        isAdmin && { to: "/admin/service", label: "Service Configuration", desc: "Routes, feeds, and service-day configuration", icon: <IconWrench /> },
        isAdmin && { to: "/admin/integrations", label: "Integrations & Data Health", desc: "Connector status and feed freshness", icon: <IconWrench /> },
        isAdmin && { to: "/admin/decision-matrix", label: "Decision Matrix", desc: "The thresholds behind suggested alerts", icon: <IconWrench /> },
        isAdmin && { to: "/admin/otp-compliance", label: "OTP Compliance", desc: "On-time performance rules and tolerances", icon: <IconWrench /> },
        isAdmin && { to: "/admin/performance/standards", label: "Performance Setup", desc: "Contractors, agreements, the standards catalog and its lists", icon: <IconAssessment /> },
        canManageAccess && { to: "/admin/governance", label: "Governance & Audit", desc: "The audit log, retention, and governance settings", icon: <IconClock /> },
      ),
    },
  ].filter((category) => category.entries.length > 0);

  return (
    <FixedRouteRefreshProvider>
      <EventWorkspaceProvider>
      <AppDialogProvider>
      <div className="frame">
        <aside
          className={`nav-sidebar${mobileNavOpen ? " is-open" : ""}${navCollapsed ? " is-collapsed" : ""}`}
          data-collapsed={navCollapsed ? "true" : "false"}
        >
        <div className="nav-brand">
          <span className="logo-badge">MVTA</span>
          <div className="nav-brand-detail">
            <div className="nav-brand-text">OnBoard</div>
            <div className="nav-brand-sub">Staff console</div>
          </div>
          <button
            className="nav-collapse-btn"
            aria-expanded={!navCollapsed}
            aria-controls="primary-nav"
            aria-label={navCollapsed ? "Expand navigation menu" : "Collapse navigation menu"}
            title={navCollapsed ? "Expand navigation menu" : "Collapse navigation menu"}
            onClick={() => setNavCollapsed((collapsed) => !collapsed)}
          >
            <IconMenu />
          </button>
        </div>

        <nav className="nav-list" id="primary-nav">
          {navCategories.map((category) => {
            const clustered = railCollapsed && Boolean(category.cluster);
            const open = !closedGroups[category.id];
            return (
              <section className="nav-group" key={category.id}>
                {clustered ? (
                  <div className={`nav-cluster${openCluster === category.id ? " is-open" : ""}`}>
                    <button
                      className="nav-cluster-btn"
                      aria-haspopup="true"
                      aria-expanded={openCluster === category.id}
                      aria-label={`${category.name} — ${category.entries.length} pages`}
                      onClick={() => setOpenCluster((id) => (id === category.id ? null : category.id))}
                    >
                      {category.cluster}
                      <span className="nav-cluster-count">{category.entries.length}</span>
                    </button>
                    <div className="nav-flyout nav-flyout-menu">
                      <span className="nav-flyout-cat">{category.name}</span>
                      {category.entries.map((entry) => (
                        <NavLink key={entry.to} to={entry.to} end={entry.end} className="nav-menu-row" onClick={() => setOpenCluster(null)}>
                          {entry.icon}
                          <span>{entry.label}</span>
                        </NavLink>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      className="nav-group-toggle"
                      aria-expanded={open}
                      onClick={() => setClosedGroups((closed) => ({ ...closed, [category.id]: open }))}
                    >
                      <span>{category.name}</span>
                      <span className="nav-chevron" aria-hidden="true"><IconChevronDown /></span>
                    </button>
                    {/* Collapsed, every category's links stay rendered: a
                        hidden group heading must never be the only way to
                        reach a page. */}
                    {open || railCollapsed ? (
                      <div className="nav-group-links">
                        {category.entries.map((entry) => (
                          <div className="nav-item" key={entry.to}>
                            <NavLink to={entry.to} end={entry.end} title={entry.label}>
                              {entry.icon}
                              <span className="nav-label">{entry.label}</span>
                            </NavLink>
                            {/* Sibling of the link, not a child: the anchor's
                                text has to stay the label alone. */}
                            {railCollapsed ? (
                              <span className="nav-flyout" aria-hidden="true">
                                <span className="nav-flyout-cat">{category.name}</span>
                                <b>{entry.label}</b>
                                <span className="nav-flyout-desc">{entry.desc}</span>
                              </span>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </>
                )}
              </section>
            );
          })}
        </nav>

        <div className="nav-spacer" />
        <div className="nav-footer">
          <div className="nav-status" title={stats.ok ? "Console Live" : "Console Offline"}>
            <span className="live-dot" />
            <span className="nav-label">{stats.ok ? "Console Live" : "Console Offline"}</span>
          </div>
          <div className="nav-item">
            <button
              className="nav-changelog"
              onClick={openChangelog}
              aria-haspopup="dialog"
              title={`What’s new in v${__APP_VERSION__}`}
            >
              <span className="nav-version-number">
                {railCollapsed ? __APP_VERSION__.split(".").slice(-1)[0] : `v${__APP_VERSION__}`}
                {changelogSeen === __APP_VERSION__ ? null : <span className="nav-new-dot" />}
              </span>
              <span className="nav-changelog-text">
                <b>What’s new</b>
                <small>Release notes</small>
              </span>
              <span className="nav-changelog-arrow" aria-hidden="true"><IconChevronDown /></span>
            </button>
            {railCollapsed ? (
              <span className="nav-flyout" aria-hidden="true">
                <span className="nav-flyout-cat">Build</span>
                <b>{`What’s new in v${__APP_VERSION__}`}</b>
                <span className="nav-flyout-desc">Release notes for the running build, then the full changelog.</span>
              </span>
            ) : null}
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
            {/* ADR 0026: the shell makes no cross-workspace live-data claim.
                Each workspace states its own health where the data is used. */}
            <OperatorIdentity
              name={account.name ?? account.username}
              username={account.username}
              roles={roles}
              canManageAccess={canManageAccess}
              onSignOut={signOut}
            />
            <button
              className="theme-toggle-btn"
              title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              onClick={toggle}
            >
              {theme === "dark" ? <IconSun /> : <IconMoon />}
            </button>
          </div>
        </header>

        <main className="content-main">
          {/* Keyed by pathname so navigating to a different route always
              remounts a fresh boundary, rather than staying stuck on a
              previous route's error. */}
          <ErrorBoundary key={location.pathname}>
            <Routes>
              <Route path="/" element={landing ? <Navigate to={landing} replace /> : <Dashboard stats={stats} onChanged={stats.refresh} />} />
              <Route path="/service-operations" element={<ServiceOperations />}>
                <Route index element={landing ? <Navigate to={landing} replace /> : <ServiceOperationsOverview stats={stats} />} />
                <Route path="compose" element={<RequireRole allowed={[...COMMUNICATIONS]}><Compose onChanged={stats.refresh} /></RequireRole>} />
                <Route path="active" element={<RequireRole allowed={[...COMMUNICATIONS]}><ActiveMessages onChanged={stats.refresh} /></RequireRole>} />
                <Route path="suggested" element={<RequireRole allowed={[...COMMUNICATIONS]}><SuggestedAlerts onChanged={stats.refresh} /></RequireRole>} />
                <Route
                  path="dispatch-log"
                  element={<RequireRole allowed={[...DISPATCH_LOG]}><TripStartLog /></RequireRole>}
                />
                <Route
                  path="risk"
                  element={<RequireRole allowed={[...OCC_TOOLS]}><ServiceRiskQuality /></RequireRole>}
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
              <Route path="/admin" element={<RequireRole allowed={[...ACCESS_MANAGEMENT, ...ADMIN]}><AdminLayout /></RequireRole>}>
                <Route index element={<Navigate to="service" replace />} />
                <Route path="access" element={<RequireRole allowed={[...ACCESS_MANAGEMENT]}><AdminAccess /></RequireRole>} />
                <Route path="events" element={<RequireRole allowed={[...ADMIN]}><AdminEventAdministration /></RequireRole>} />
                <Route path="service" element={<RequireRole allowed={[...ADMIN]}><AdminServiceConfiguration /></RequireRole>} />
                <Route path="integrations" element={<RequireRole allowed={[...ADMIN]}><AdminIntegrations /></RequireRole>} />
                <Route path="service-standards" element={<RequireRole allowed={[...ADMIN]}><OnDemandServiceStandardsAdmin /></RequireRole>} />
                <Route path="decision-matrix" element={<RequireRole allowed={[...ADMIN]}><DecisionMatrixAdmin /></RequireRole>} />
                <Route path="otp-compliance" element={<RequireRole allowed={[...ADMIN]}><OtpComplianceAdmin /></RequireRole>} />
                {/* Performance assessment administration is four separate
                    jobs on one body of work, so each has its own section. The
                    old single-page path is kept as a redirect - it shipped and
                    people have it. */}
                <Route path="performance" element={<Navigate to="/admin/performance/standards" replace />} />
                <Route path="performance/contractors" element={<RequireRole allowed={[...ADMIN]}><PerformanceContractorsAdmin /></RequireRole>} />
                <Route path="performance/agreements" element={<RequireRole allowed={[...ADMIN]}><PerformanceAgreementsAdmin /></RequireRole>} />
                <Route path="performance/standards" element={<RequireRole allowed={[...ADMIN]}><PerformanceStandardsAdmin /></RequireRole>} />
                <Route path="performance/lists" element={<RequireRole allowed={[...ADMIN]}><PerformanceListsAdmin /></RequireRole>} />
                <Route path="performance-standards" element={<Navigate to="/admin/performance/standards" replace />} />
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
      </AppDialogProvider>
      </EventWorkspaceProvider>
    </FixedRouteRefreshProvider>
  );
}
