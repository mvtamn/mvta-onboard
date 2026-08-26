import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";
import { IconClock, IconShield, IconUsers, IconBus, IconWrench } from "./NavIcons.js";

const ADMIN = ["OCC.Admin"] as const;
const ACCESS = ["OCC.Admin", "OCC.AccessAdmin"] as const;

const links = [
  { to: "/admin/access", label: "Access & Identity", icon: IconShield, roles: ACCESS },
  { to: "/admin/events", label: "Event Administration", icon: IconBus, roles: ADMIN },
  { to: "/admin/service", label: "Service Configuration", icon: IconWrench, roles: ADMIN },
  { to: "/admin/service-standards", label: "Service Standards", icon: IconWrench, roles: ADMIN },
  { to: "/admin/integrations", label: "Integrations & Data Health", icon: IconWrench, roles: ADMIN },
  { to: "/admin/decision-matrix", label: "Decision Matrix", icon: IconWrench, roles: ADMIN },
  { to: "/admin/governance", label: "Governance & Audit", icon: IconClock, roles: ACCESS },
  { to: "/admin/subscribers", label: "Subscribers", icon: IconUsers, roles: ACCESS },
] as const;

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
          {visibleLinks.map((link) => {
            const { to, label, icon: Icon } = link;
            return <NavLink key={to} to={to}>
              <Icon />
              <span>{label}</span>
            </NavLink>;
          })}
        </nav>
      </aside>
      <section className="admin-layout-content"><Outlet /></section>
    </div>
  );
}
