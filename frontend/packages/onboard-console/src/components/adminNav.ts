import type { AppRole } from "../auth/roles.js";

// The one list of Administration pages. The home page's cards, the area
// switcher in the breadcrumb, the tab strip and quick find all read it, so a
// page added here appears in all four and cannot be missed by one of them.
//
// Where a new page goes: into an existing area. Open a new area only when
// several pages share a subject none of these covers. When one job is split
// across routes (Access & Identity, Contractor Performance) the routes are
// that page's tabs, not pages of their own.

const ADMIN = ["OCC.Admin"] as const;
// The same roles App.tsx's routes require (ACCESS_MANAGEMENT). The old menu
// listed these pages to every Operations Administrator, who then met
// "Restricted" on each one unless the setup-mode fallback was on.
const ACCESS = import.meta.env.VITE_ACCESS_ADMIN_FALLBACK === "true"
  ? ["OCC.AccessAdmin", "OCC.Admin"] as const
  : ["OCC.AccessAdmin"] as const;

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
  roles: readonly AppRole[];
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
        roles: ACCESS,
        tabs: [
          { to: "/admin/access", label: "Overview", end: true },
          { to: "/admin/access/people", label: "People & guests" },
          { to: "/admin/access/groups", label: "Access groups" },
          { to: "/admin/access/workloads", label: "Workloads" },
          { to: "/admin/access/approvals", label: "Approvals" },
          { to: "/admin/access/health", label: "Access health" },
          { to: "/admin/access/activity", label: "Activity log" },
        ],
      },
      { to: "/admin/subscribers", label: "Subscribers", desc: "Rider alert sign-ups and the channels they chose", icon: "mail", roles: ACCESS },
    ],
  },
  {
    id: "service",
    name: "Service Setup",
    icon: "sliders",
    pages: [
      { to: "/admin/service", label: "Service Configuration", desc: "Routes, feeds, and service-day configuration", icon: "sliders", roles: ADMIN },
      { to: "/admin/events", label: "Event Administration", desc: "The event catalog and the resources behind it", icon: "calendar", roles: ADMIN },
      { to: "/admin/decision-matrix", label: "Decision Matrix", desc: "The thresholds behind suggested alerts", icon: "grid", roles: ADMIN },
    ],
  },
  {
    id: "standards",
    name: "Standards & Contracts",
    icon: "target",
    pages: [
      { to: "/admin/service-standards", label: "Service Standards", desc: "The standards on-demand service is measured against", icon: "target", roles: ADMIN },
      { to: "/admin/otp-compliance", label: "OTP Compliance", desc: "On-time performance rules and tolerances", icon: "clock", roles: ADMIN },
      {
        to: "/admin/performance/contractors",
        base: "/admin/performance",
        label: "Contractor Performance",
        desc: "Contractors, agreements, the standards catalog and its lists",
        icon: "clipboard",
        roles: ADMIN,
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
      { to: "/admin/integrations", label: "Integrations & Data Health", desc: "Connector status and feed freshness", icon: "plug", roles: ADMIN },
    ],
  },
  {
    id: "governance",
    name: "Governance",
    icon: "history",
    pages: [
      { to: "/admin/governance", label: "Governance & Audit", desc: "The audit log, retention, and governance settings", icon: "history", roles: ACCESS },
    ],
  },
];

// The areas and pages these roles can open. An area with no such page is left
// out rather than shown empty.
export function visibleAreas(roles: readonly string[]): AdminArea[] {
  return ADMIN_AREAS
    .map((area) => ({ ...area, pages: area.pages.filter((page) => page.roles.some((role) => roles.includes(role))) }))
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
