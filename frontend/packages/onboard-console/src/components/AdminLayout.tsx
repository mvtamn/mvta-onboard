import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";
import type { AppRole } from "../auth/roles.js";
import { IconAssessment, IconClock, IconHistory, IconShield, IconUsers, IconBus, IconWrench } from "./NavIcons.js";

const ADMIN = ["OCC.Admin"] as const;
const ACCESS = ["OCC.Admin", "OCC.AccessAdmin"] as const;

// Administration is a flat list of pages except where several belong to one
// subject. Contractor performance is that case: who the contractor is, what
// they are contracted to, what they are held to, and the vocabulary behind it
// are four separate jobs on one body of work, and stacking them inside a
// single page made each of them harder to find than it needed to be. Access &
// Identity is the other: who has access, the groups and workloads that hold
// it, the requests waiting on a second approver, drift against Entra, and the
// record of it all were seven tabs on one page.
interface AdminLink {
  to: string;
  label: string;
  icon: typeof IconShield;
  roles: readonly AppRole[];
  group?: string;
  // Match this path exactly, so a section's overview is not also marked
  // active on every page beneath it.
  end?: boolean;
}

const links: readonly AdminLink[] = [
  { to: "/admin/access", label: "Overview", icon: IconShield, roles: ACCESS, group: "Access & Identity", end: true },
  { to: "/admin/access/people", label: "People & guests", icon: IconUsers, roles: ACCESS, group: "Access & Identity" },
  { to: "/admin/access/groups", label: "Access groups", icon: IconUsers, roles: ACCESS, group: "Access & Identity" },
  { to: "/admin/access/workloads", label: "Workloads", icon: IconWrench, roles: ACCESS, group: "Access & Identity" },
  { to: "/admin/access/approvals", label: "Approvals", icon: IconClock, roles: ACCESS, group: "Access & Identity" },
  { to: "/admin/access/health", label: "Access health", icon: IconAssessment, roles: ACCESS, group: "Access & Identity" },
  { to: "/admin/access/activity", label: "Activity log", icon: IconHistory, roles: ACCESS, group: "Access & Identity" },
  { to: "/admin/events", label: "Event Administration", icon: IconBus, roles: ADMIN },
  { to: "/admin/service", label: "Service Configuration", icon: IconWrench, roles: ADMIN },
  { to: "/admin/service-standards", label: "Service Standards", icon: IconWrench, roles: ADMIN },
  { to: "/admin/integrations", label: "Integrations & Data Health", icon: IconWrench, roles: ADMIN },
  { to: "/admin/decision-matrix", label: "Decision Matrix", icon: IconWrench, roles: ADMIN },
  { to: "/admin/otp-compliance", label: "OTP Compliance", icon: IconWrench, roles: ADMIN },
  { to: "/admin/performance/contractors", label: "Contractors", icon: IconUsers, roles: ADMIN, group: "Performance Assessment" },
  { to: "/admin/performance/agreements", label: "Agreements", icon: IconClock, roles: ADMIN, group: "Performance Assessment" },
  { to: "/admin/performance/standards", label: "Standards", icon: IconAssessment, roles: ADMIN, group: "Performance Assessment" },
  { to: "/admin/performance/lists", label: "Lists", icon: IconWrench, roles: ADMIN, group: "Performance Assessment" },
  { to: "/admin/governance", label: "Governance & Audit", icon: IconClock, roles: ACCESS },
  { to: "/admin/subscribers", label: "Subscribers", icon: IconUsers, roles: ACCESS },
];

// Consecutive links sharing a group render under one heading; everything else
// renders as it did. Keeping the order in one array means a page cannot end up
// in a group by accident, or fall out of the list when its group is empty.
function sections(visible: readonly AdminLink[]): { group?: string; items: AdminLink[] }[] {
  return visible.reduce<{ group?: string; items: AdminLink[] }[]>((acc, link) => {
    const last = acc[acc.length - 1];
    if (last && last.group === link.group) last.items.push(link);
    else acc.push({ group: link.group, items: [link] });
    return acc;
  }, []);
}

export function AdminLayout() {
  const { roles } = useAuth();
  const visibleLinks = links.filter((link) => link.roles.some((role) => roles.includes(role)));

  return (
    <div className="admin-layout">
      <aside className="admin-secondary-nav" aria-label="Administration">
        <div className="admin-secondary-heading">
          <span className="admin-eyebrow">Management workspace</span>
          <strong>Administration</strong>
        </div>
        <nav className="admin-secondary-links">
          {sections(visibleLinks).map((section, index) => (
            <div key={section.group ?? `ungrouped-${index}`} className={section.group ? "admin-secondary-group" : undefined}>
              {section.group && <span className="admin-secondary-group-label">{section.group}</span>}
              {section.items.map(({ to, label, icon: Icon, end }) => (
                <NavLink key={to} to={to} end={end}>
                  <Icon />
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <section className="admin-layout-content"><Outlet /></section>
    </div>
  );
}
