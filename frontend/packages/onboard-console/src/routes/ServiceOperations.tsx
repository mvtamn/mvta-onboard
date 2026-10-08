import { NavLink, Outlet } from "react-router-dom";
import { useAccess } from "../auth/AccessContext.js";

// The communications side - Overview, Compose, Active and Suggested - is one
// Module Action; anyone without it would be refused by every call those pages
// make, so those tabs are hidden for them (ADR 0015).
export function ServiceOperations() {
  const { can } = useAccess();
  const canSeeServiceRisk = can("service-risk.view");
  const canSeeDispatchLog = can("dispatch-log.view");
  const canSeeCommunications = can("rider-alerts.view");

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
