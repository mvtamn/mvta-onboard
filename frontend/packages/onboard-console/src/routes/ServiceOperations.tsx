import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";

const SERVICE_RISK_ROLES = ["OCC.Viewer", "OCC.Publisher", "OCC.Admin"] as const;

function hasServiceRiskAccess(roles: string[]): boolean {
  return roles.some((role) => SERVICE_RISK_ROLES.includes(role as (typeof SERVICE_RISK_ROLES)[number]));
}

// The communications side reads the API's STAFF_READ_ROLES; roles outside it
// would 403 on every call the Overview, Compose, Active and Suggested pages
// make, so those tabs are hidden for them (ADR 0015).
const COMMUNICATIONS_ROLES = ["OCC.Viewer", "OCC.Publisher", "OCC.Admin", "OCC.EventAVL"] as const;

function hasCommunicationsAccess(roles: string[]): boolean {
  return roles.some((role) => COMMUNICATIONS_ROLES.includes(role as (typeof COMMUNICATIONS_ROLES)[number]));
}

// Same readers as the API's trip-start log: staff roles plus Compliance.
function hasDispatchLogAccess(roles: string[]): boolean {
  return hasServiceRiskAccess(roles) || roles.includes("OCC.Compliance") || roles.includes("OCC.TripStartVerify");
}

export function ServiceOperations() {
  const { roles } = useAuth();
  const canSeeServiceRisk = hasServiceRiskAccess(roles);
  const canSeeDispatchLog = hasDispatchLogAccess(roles);
  const canSeeCommunications = hasCommunicationsAccess(roles);

  return (
    <div className="service-operations">
      <header className="service-operations-header">
        <div>
          <span className="risk-eyebrow">{canSeeCommunications ? "Communications workspace" : "Monitoring workspace"}</span>
          <h2>Service Operations</h2>
          <p>
            {canSeeCommunications
              ? "Prepare, review, publish, and manage rider-facing Service Alerts."
              : "Watch service as it runs. Rider-facing Service Alerts are prepared and published by MVTA's OCC."}
          </p>
        </div>
      </header>

      <nav className="service-operations-tabs" aria-label="Service Operations">
        {canSeeCommunications ? <>
          <NavLink to="." end>Overview</NavLink>
          <NavLink to="compose">Compose</NavLink>
          <NavLink to="suggested">Suggested Alerts</NavLink>
          <NavLink to="active">Active Service Alerts</NavLink>
        </> : null}
        {canSeeServiceRisk ? <NavLink to="risk">Service Risk &amp; Quality</NavLink> : null}
        {canSeeDispatchLog ? <NavLink to="dispatch-log">Dispatch Log</NavLink> : null}
      </nav>

      <Outlet />
    </div>
  );
}

export { hasCommunicationsAccess, hasDispatchLogAccess, hasServiceRiskAccess };
