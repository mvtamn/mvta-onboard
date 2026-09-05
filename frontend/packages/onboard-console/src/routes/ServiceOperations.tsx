import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";

const SERVICE_RISK_ROLES = ["OCC.Viewer", "OCC.Publisher", "OCC.Admin"] as const;

function hasServiceRiskAccess(roles: string[]): boolean {
  return roles.some((role) => SERVICE_RISK_ROLES.includes(role as (typeof SERVICE_RISK_ROLES)[number]));
}

// Same readers as the API's trip-start log: staff roles plus Compliance.
function hasDispatchLogAccess(roles: string[]): boolean {
  return hasServiceRiskAccess(roles) || roles.includes("OCC.Compliance");
}

export function ServiceOperations() {
  const { roles } = useAuth();
  const canSeeServiceRisk = hasServiceRiskAccess(roles);
  const canSeeDispatchLog = hasDispatchLogAccess(roles);

  return (
    <div className="service-operations">
      <header className="service-operations-header">
        <div>
          <span className="risk-eyebrow">Communications workspace</span>
          <h2>Service Operations</h2>
          <p>Prepare, review, publish, and manage rider-facing Service Alerts.</p>
        </div>
      </header>

      <nav className="service-operations-tabs" aria-label="Service Operations">
        <NavLink to="." end>Overview</NavLink>
        <NavLink to="compose">Compose</NavLink>
        <NavLink to="suggested">Suggested Alerts</NavLink>
        <NavLink to="active">Active Service Alerts</NavLink>
        {canSeeServiceRisk ? <NavLink to="risk">Service Risk &amp; Quality</NavLink> : null}
        {canSeeDispatchLog ? <NavLink to="dispatch-log">Dispatch Log</NavLink> : null}
      </nav>

      <Outlet />
    </div>
  );
}

export { hasDispatchLogAccess, hasServiceRiskAccess };
