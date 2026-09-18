import { useEffect, useState, type ReactNode } from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth/AuthContext.js";
import { useAccess } from "./auth/AccessContext.js";
import { NoAccess, RequireAccess } from "./auth/RequireAccess.js";
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
import { AdminHome } from "./components/AdminHome.js";
import { AdminLayout } from "./components/AdminLayout.js";
import { ADMIN_ACTIONS } from "./components/adminNav.js";
import { AccessLayout } from "./routes/access/AccessUi.js";
import { AccessOverview } from "./routes/access/AccessOverview.js";
import { AccessGroups, AccessPeople, AccessWorkloads } from "./routes/access/AccessInventory.js";
import { AddAccess } from "./routes/access/AddAccess.js";
import { AccessApprovals } from "./routes/access/AccessApprovals.js";
import { AccessHealth } from "./routes/access/AccessHealth.js";
import { AccessActivity } from "./routes/access/AccessActivity.js";
import { OnDemandServiceStandardsAdmin } from "./routes/OnDemandServiceStandardsAdmin.js";
import { AdminEventAdministration, AdminGovernance, AdminIntegrations, AdminServiceConfiguration, AdminSubscribers } from "./routes/AdminModules.js";
import { OtpComplianceAdmin } from "./routes/OtpComplianceAdmin.js";
import { PerformanceStandardsAdmin } from "./routes/PerformanceStandardsAdmin.js";
import { PerformanceContractorsAdmin } from "./routes/PerformanceContractorsAdmin.js";
import { PerformanceAgreementsAdmin } from "./routes/PerformanceAgreementsAdmin.js";
import { PerformanceListsAdmin } from "./routes/PerformanceListsAdmin.js";
import { CHANGELOG_ENTRIES } from "./routes/changelogData.js";
import { FixedRouteRefreshProvider } from "./context/FixedRouteRefreshContext.js";
import { LiveSignal, signalStateFor } from "./components/LiveSignal.js";
import { OperatorIdentity } from "./components/OperatorIdentity.js";

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

// The popover is a glance at the running build, not the release itself: some
// releases carry a dozen bullets, and printing all of them turns a panel into
// a page you have to scroll. Anything past the cap is what /changelog is for -
// and the count is shown rather than the list quietly ending, so nobody reads
// a truncated panel as the whole release.
const POPOVER_ITEM_CAP = 5;

function ChangelogPopover({ onClose }: { onClose: () => void }) {
  const currentRelease = CHANGELOG_ENTRIES.find((entry) => entry.version === __APP_VERSION__);
  const releaseItems = currentRelease?.sections.flatMap((section) => section.items) ?? [];
  const shownItems = releaseItems.slice(0, POPOVER_ITEM_CAP);
  const remainingItems = releaseItems.length - shownItems.length;
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
              {shownItems.map((item) => <li key={item}>{item}</li>)}
              {remainingItems > 0 ? (
                <li className="changelog-popover-more">
                  {remainingItems === 1 ? "1 more change in this release" : `${remainingItems} more changes in this release`}
                </li>
              ) : null}
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
  const { account, signIn, signOut } = useAuth();

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

  return <AuthenticatedApp account={account} signOut={signOut} />;
}

function AuthenticatedApp({ account, signOut }: {
  account: NonNullable<ReturnType<typeof useAuth>["account"]>;
  signOut: ReturnType<typeof useAuth>["signOut"];
}) {
  const { theme, toggle } = useTheme();
  const { can, canAny, noAccess } = useAccess();
  const canSeeDashboard = can("dashboard.view");
  const canSeeServiceRisk = can("service-risk.view");
  const canSeeDispatchLog = can("dispatch-log.view");
  const canSeeCommunications = can("rider-alerts.view");
  const canManageAccess = can("access-identity.view");
  const canSeeAdministration = canAny([...ADMIN_ACTIONS]);
  const canSeeOccTools = can("decision-matrix.view");
  const canSeeCompliance = can("compliance-review.view");
  const canSeePerformanceAssessment = can("performance-assessment.view");
  const canSeeDetours = can("detours.view");
  const canSeeDetourIntake = can("detours.intake");
  const canSeeEventAvl = can("event-avl.view");
  const canSeeEventPlanning = can("event-planning.view");
  // Where a user without the Dashboard lands instead: the first workspace
  // their access opens.
  const landing = canSeeDashboard ? null
    : canSeeCommunications ? "/service-operations"
    : canSeeDispatchLog ? "/service-operations/dispatch-log"
    : canSeeCompliance ? "/compliance"
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
        canSeeDashboard && { to: "/", end: true, label: "Dashboard", desc: "Compose and monitor active rider alerts", icon: <IconDashboard /> },
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
        canSeeDetourIntake && { to: "/detour-intake", label: "Detour Intake", desc: "Create and review the complete operational Detour record", icon: <IconDetour /> },
        canSeeDetours && { to: "/detour-reports", label: "Detour Reports", desc: "Search and export detour history — read-only", icon: <IconClock /> },
        canSeeOccTools && { to: "/occ", label: "OCC Tools", desc: "Service-risk prediction, procedure guidance, and vehicle monitoring", icon: <IconWrench /> },
      ),
    },
    {
      id: "events",
      name: "Events",
      entries: navEntries(
        canSeeEventPlanning && { to: "/events/planning", label: "Planning", desc: "Prepare and approve event service plans", icon: <IconBus /> },
        canSeeEventAvl && { to: "/events/avl", label: "Event AVL", desc: "Monitor active vehicles and event service in real time", icon: <IconBus /> },
      ),
    },
    {
      id: "compliance",
      name: "Compliance & Assessment",
      entries: navEntries(
        canSeeCompliance && { to: "/compliance", label: "Compliance", desc: "OTP compliance and missed-trip investigation", icon: <IconShield /> },
        canSeePerformanceAssessment && { to: "/performance-assessment", label: "Performance Assessment", desc: "Monthly standards scoring, evidence, review, and issuance", icon: <IconAssessment /> },
      ),
    },
    {
      id: "administration",
      name: "Administration",
      // One link: /admin lists every area, and the pages inside it carry
      // their own breadcrumb, tabs and quick find (components/adminNav.ts).
      entries: navEntries(
        canSeeAdministration && { to: "/admin", label: "Administration", desc: "Access, service setup, standards, integrations and governance", icon: <IconGear /> },
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
            <LiveSignal state={signalStateFor(stats.overallState)} size="sm" />
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
              <Route
                path="/"
                element={
                  noAccess ? <NoAccess />
                    : landing ? <Navigate to={landing} replace />
                    : <RequireAccess action="dashboard.view"><Dashboard stats={stats} onChanged={stats.refresh} /></RequireAccess>
                }
              />
              <Route path="/service-operations" element={<ServiceOperations />}>
                <Route index element={<RequireAccess action="rider-alerts.view"><ServiceOperationsOverview stats={stats} /></RequireAccess>} />
                <Route path="compose" element={<RequireAccess action="rider-alerts.view"><Compose onChanged={stats.refresh} /></RequireAccess>} />
                <Route path="active" element={<RequireAccess action="rider-alerts.view"><ActiveMessages onChanged={stats.refresh} /></RequireAccess>} />
                <Route path="suggested" element={<RequireAccess action="rider-alerts.view"><SuggestedAlerts onChanged={stats.refresh} /></RequireAccess>} />
                <Route
                  path="dispatch-log"
                  element={<RequireAccess action="dispatch-log.view"><TripStartLog /></RequireAccess>}
                />
                <Route
                  path="risk"
                  element={<RequireAccess action="service-risk.view"><ServiceRiskQuality /></RequireAccess>}
                />
              </Route>
              <Route path="/compose" element={<RequireAccess action="rider-alerts.view"><Compose onChanged={stats.refresh} /></RequireAccess>} />
              <Route path="/active" element={<RequireAccess action="rider-alerts.view"><ActiveMessages onChanged={stats.refresh} /></RequireAccess>} />
              <Route
                path="/detours"
                element={
                  <RequireAccess action="detours.view">
                    <Detours />
                  </RequireAccess>
                }
              />
              {/* Same action as /detours - the reports page reads the very
                  same GET /detours endpoint, so anything narrower would be a
                  nav link that 403s. */}
              <Route
                path="/detour-reports"
                element={
                  <RequireAccess action="detours.view">
                    <DetourReports />
                  </RequireAccess>
                }
              />
              <Route
                path="/detour-intake"
                element={<RequireAccess action="detours.intake"><DetourIntake /></RequireAccess>}
              />
              <Route path="/suggested" element={<RequireAccess action="rider-alerts.view"><SuggestedAlerts onChanged={stats.refresh} /></RequireAccess>} />
              <Route path="/subscribers" element={<RequireAccess action="subscribers.view"><Subscribers /></RequireAccess>} />
              <Route path="/audit" element={<RequireAccess action="governance-audit.view"><AuditLog /></RequireAccess>} />
              <Route path="/changelog" element={<Changelog />} />
              <Route path="/admin/access-management" element={<CompatibilityRedirect to="/admin/access" />} />
              <Route path="/admin" element={<RequireAccess anyOf={[...ADMIN_ACTIONS]}><AdminLayout /></RequireAccess>}>
                <Route index element={<AdminHome />} />
                {/* Access & Identity is seven pages under one heading; they share
                    one load through AccessLayout. */}
                <Route path="access" element={<RequireAccess action="access-identity.view"><AccessLayout /></RequireAccess>}>
                  <Route index element={<AccessOverview />} />
                  <Route path="people" element={<AccessPeople />} />
                  <Route path="groups" element={<AccessGroups />} />
                  <Route path="workloads" element={<AccessWorkloads />} />
                  <Route path="add" element={<AddAccess />} />
                  <Route path="approvals" element={<AccessApprovals />} />
                  <Route path="health" element={<AccessHealth />} />
                  <Route path="activity" element={<AccessActivity />} />
                  <Route path="*" element={<Navigate to="/admin/access" replace />} />
                </Route>
                <Route path="events" element={<RequireAccess action="service-configuration.edit"><AdminEventAdministration /></RequireAccess>} />
                <Route path="service" element={<RequireAccess action="service-configuration.edit"><AdminServiceConfiguration /></RequireAccess>} />
                <Route path="integrations" element={<RequireAccess action="integrations-health.view"><AdminIntegrations /></RequireAccess>} />
                <Route path="service-standards" element={<RequireAccess action="service-configuration.edit"><OnDemandServiceStandardsAdmin /></RequireAccess>} />
                <Route path="decision-matrix" element={<RequireAccess action="decision-matrix.manage"><DecisionMatrixAdmin /></RequireAccess>} />
                <Route path="otp-compliance" element={<RequireAccess action="service-configuration.edit"><OtpComplianceAdmin /></RequireAccess>} />
                {/* Performance assessment administration is four separate
                    jobs on one body of work, so each has its own section. The
                    old single-page path is kept as a redirect - it shipped and
                    people have it. */}
                <Route path="performance" element={<Navigate to="/admin/performance/standards" replace />} />
                <Route path="performance/contractors" element={<RequireAccess action="contractor-performance.view"><PerformanceContractorsAdmin /></RequireAccess>} />
                <Route path="performance/agreements" element={<RequireAccess action="contractor-performance.view"><PerformanceAgreementsAdmin /></RequireAccess>} />
                <Route path="performance/standards" element={<RequireAccess action="contractor-performance.view"><PerformanceStandardsAdmin /></RequireAccess>} />
                <Route path="performance/lists" element={<RequireAccess action="contractor-performance.view"><PerformanceListsAdmin /></RequireAccess>} />
                <Route path="performance-standards" element={<Navigate to="/admin/performance/standards" replace />} />
                <Route path="governance" element={<RequireAccess action="governance-audit.view"><AdminGovernance /></RequireAccess>} />
                <Route path="subscribers" element={<RequireAccess action="subscribers.view"><AdminSubscribers /></RequireAccess>} />
              </Route>
              <Route path="/event-monitoring" element={<CompatibilityRedirect to="/events/avl" />} />
              <Route path="/event-planning" element={<CompatibilityRedirect to="/events/planning" />} />
              <Route path="/events" element={<Navigate to="/events/avl" replace />} />
              <Route path="/events/avl/field" element={<RequireAccess action="event-avl.view"><EventMonitoring fieldView /></RequireAccess>} />
              <Route path="/events/avl" element={<RequireAccess action="event-avl.view"><EventMonitoring /></RequireAccess>} />
              <Route path="/events/planning" element={<RequireAccess action="event-planning.view"><EventPlanning /></RequireAccess>} />
              <Route
                path="/occ/*"
                element={
                  <RequireAccess action="decision-matrix.view">
                    <OccTools />
                  </RequireAccess>
                }
              />
              <Route
                path="/compliance/*"
                element={
                  <RequireAccess action="compliance-review.view">
                    <Compliance />
                  </RequireAccess>
                }
              />
              <Route
                path="/performance-assessment/*"
                element={
                  <RequireAccess action="performance-assessment.view">
                    <PerformanceAssessment />
                  </RequireAccess>
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
