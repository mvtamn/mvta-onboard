// The one list of Administration pages. The home page's cards, the area
// switcher in the breadcrumb, the tab strip and quick find all read it, so a
// page added here appears in all four and cannot be missed by one of them.
//
// Where a new page goes: into an existing area. Open a new area only when
// several pages share a subject none of these covers. When one job is split
// across routes (Access & Identity, Contractor Performance) the routes are
// that page's tabs, not pages of their own.

export type AdminIconName = "shield" | "mail" | "sliders" | "calendar" | "grid" | "target" | "clock" | "clipboard" | "plug" | "history";

export interface AdminTab {
  to: string;
  label: string;
  // Match this path exactly, so an overview tab is not also marked current on
  // every route beneath it.
  end?: boolean;
}

export interface AdminPage {
  to: string;
  // Every route under this path belongs to the page. Defaults to `to`.
  base?: string;
  label: string;
  desc: string;
  icon: AdminIconName;
  action: string;
  tabs?: readonly AdminTab[];
}

export interface AdminArea {
  id: string;
  name: string;
  icon: AdminIconName;
  pages: readonly AdminPage[];
}

export const ADMIN_AREAS: readonly AdminArea[] = [
  {
    id: "people",
    name: "People & Access",
    icon: "shield",
    pages: [
      {
        to: "/admin/access",
        label: "Access & Identity",
        desc: "Roles, sign-in, and who can reach which workspace",
        icon: "shield",
        action: "access-identity.view",
        tabs: [
          { to: "/admin/access", label: "Overview", end: true },
          { to: "/admin/access/people", label: "People & guests" },
          { to: "/admin/access/groups", label: "Access groups" },
          { to: "/admin/access/workloads", label: "Workloads" },
          { to: "/admin/access/roles", label: "Roles" },
          { to: "/admin/access/approvals", label: "Approvals" },
          { to: "/admin/access/health", label: "Access health" },
          { to: "/admin/access/activity", label: "Activity log" },
        ],
      },
      { to: "/admin/subscribers", label: "Subscribers", desc: "Rider alert sign-ups and the channels they chose", icon: "mail", action: "subscribers.view" },
    ],
  },
  {
    id: "service",
    name: "Service Setup",
    icon: "sliders",
    pages: [
      { to: "/admin/service", label: "Service Configuration", desc: "Routes, feeds, and service-day configuration", icon: "sliders", action: "service-configuration.edit" },
      { to: "/admin/events", label: "Event Administration", desc: "The event catalog and the resources behind it", icon: "calendar", action: "service-configuration.edit" },
      { to: "/admin/decision-matrix", label: "Decision Matrix", desc: "The thresholds behind suggested alerts", icon: "grid", action: "decision-matrix.manage" },
    ],
  },
  {
    id: "standards",
    name: "Standards & Contracts",
    icon: "target",
    pages: [
      { to: "/admin/service-standards", label: "Service Standards", desc: "The standards on-demand service is measured against", icon: "target", action: "service-configuration.edit" },
      { to: "/admin/otp-compliance", label: "OTP Compliance", desc: "On-time performance rules and tolerances", icon: "clock", action: "service-configuration.edit" },
      {
        to: "/admin/performance/contractors",
        base: "/admin/performance",
        label: "Contractor Performance",
        desc: "Contractors, agreements, the standards catalog and its lists",
        icon: "clipboard",
        action: "contractor-performance.view",
        tabs: [
          { to: "/admin/performance/contractors", label: "Contractors" },
          { to: "/admin/performance/agreements", label: "Agreements" },
          { to: "/admin/performance/standards", label: "Standards" },
          { to: "/admin/performance/lists", label: "Lists" },
        ],
      },
    ],
  },
  {
    id: "data",
    name: "Data & Integrations",
    icon: "plug",
    pages: [
      { to: "/admin/integrations", label: "Integrations & Data Health", desc: "Connector status and feed freshness", icon: "plug", action: "integrations-health.view" },
    ],
  },
  {
    id: "governance",
    name: "Governance",
    icon: "history",
    pages: [
      { to: "/admin/governance", label: "Governance & Audit", desc: "The audit log, retention, and governance settings", icon: "history", action: "governance-audit.view" },
    ],
  },
];

// Every action that opens some Administration page. The shell's one
// Administration link, and the /admin route itself, are for whoever holds any
// of them.
export const ADMIN_ACTIONS: readonly string[] = [
  ...new Set(ADMIN_AREAS.flatMap((area) => area.pages.map((page) => page.action))),
];

// The areas and pages this access can open. An area with no such page is left
// out rather than shown empty.
export function visibleAreas(can: (action: string) => boolean): AdminArea[] {
  return ADMIN_AREAS
    .map((area) => ({ ...area, pages: area.pages.filter((page) => can(page.action)) }))
    .filter((area) => area.pages.length > 0);
}

function within(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

export function findCurrent(areas: readonly AdminArea[], pathname: string): { area: AdminArea; page: AdminPage } | null {
  for (const area of areas) {
    for (const page of area.pages) {
      if (within(pathname, page.base ?? page.to)) return { area, page };
    }
  }
  return null;
}

export interface QuickFindEntry {
  to: string;
  label: string;
  // Where the entry lives: the area for a page, "Area › Page" for a tab.
  context: string;
  kind: "page" | "tab";
  icon: AdminIconName;
}

export function quickFindEntries(areas: readonly AdminArea[]): QuickFindEntry[] {
  return areas.flatMap((area) => area.pages.flatMap((page) => [
    { to: page.to, label: page.label, context: area.name, kind: "page" as const, icon: page.icon },
    ...(page.tabs ?? []).map((tab) => ({ to: tab.to, label: tab.label, context: `${area.name} › ${page.label}`, kind: "tab" as const, icon: page.icon })),
  ]));
}

// Name matches first (a name that starts with the text before one that merely
// contains it), then entries found only through their area or page. An empty
// query lists the pages alone; the tabs are one step away from each of them.
export function searchQuickFind(entries: readonly QuickFindEntry[], query: string): QuickFindEntry[] {
  const text = query.trim().toLowerCase();
  if (!text) return entries.filter((entry) => entry.kind === "page");
  const score = (entry: QuickFindEntry) => {
    const label = entry.label.toLowerCase();
    if (label.startsWith(text)) return 0;
    if (label.split(/[\s&›]+/).some((word) => word.startsWith(text))) return 1;
    if (label.includes(text)) return 2;
    if (entry.context.toLowerCase().includes(text)) return 3;
    return -1;
  };
  return entries
    .map((entry, index) => ({ entry, index, rank: score(entry) }))
    .filter((item) => item.rank >= 0)
    .sort((a, b) => a.rank - b.rank || (a.entry.kind === b.entry.kind ? 0 : a.entry.kind === "page" ? -1 : 1) || a.index - b.index)
    .map((item) => item.entry);
}
