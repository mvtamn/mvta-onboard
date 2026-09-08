import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";
import type { AppRole } from "../auth/roles.js";
import { IconAssessment, IconClock, IconShield, IconUsers, IconBus, IconWrench } from "./NavIcons.js";

const ADMIN = ["OCC.Admin"] as const;
const ACCESS = ["OCC.Admin", "OCC.AccessAdmin"] as const;

// Administration is a flat list of pages except where several belong to one
// subject. Contractor performance is that case: who the contractor is, what
// they are contracted to, what they are held to, and the vocabulary behind it
// are four separate jobs on one body of work, and stacking them inside a
// single page made each of them harder to find than it needed to be.
interface AdminLink {
  to: string;
  label: string;
  icon: typeof IconShield;
  roles: readonly AppRole[];
  group?: string;
}

const links: readonly AdminLink[] = [
  { to: "/admin/access", label: "Access & Identity", icon: IconShield, roles: ACCESS },
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
              {section.items.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to}>
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
