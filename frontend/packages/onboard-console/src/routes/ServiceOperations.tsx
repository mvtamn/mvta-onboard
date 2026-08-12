import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";

const SERVICE_RISK_ROLES = ["OCC.Admin"] as const;

function hasServiceRiskAccess(roles: string[]): boolean {
  return roles.some((role) => SERVICE_RISK_ROLES.includes(role as (typeof SERVICE_RISK_ROLES)[number]));
}

export function ServiceOperations() {
  const { roles } = useAuth();
  const canSeeServiceRisk = hasServiceRiskAccess(roles);

  return (
    <div className="service-operations">
      <header className="service-operations-header">
        <div>
          <span className="risk-eyebrow">Expanded operational coverage</span>
          <h2>Service Operations</h2>
          <p>
            Service Operations combines service-alert communications and operational monitoring as MVTA’s
            coverage expands. Use the tabs to compose alerts, review active communications, or investigate
            fixed-route and on-demand service risk.
          </p>
        </div>
        <NavLink className="btn-primary service-operations-cta" to="compose">
          New service alert
        </NavLink>
      </header>

      <nav className="service-operations-tabs" aria-label="Service Operations">
        <NavLink to="." end>Overview</NavLink>
        <NavLink to="compose">Compose</NavLink>
        <NavLink to="suggested">Suggested Alerts</NavLink>
        <NavLink to="active">Active Service Alerts</NavLink>
        {canSeeServiceRisk ? <NavLink to="risk">Service Risk &amp; Quality</NavLink> : null}
      </nav>

      <Outlet />
    </div>
  );
}

export { hasServiceRiskAccess };
