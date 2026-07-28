import { useState } from "react";
import { EventMonitoring } from "./modules/EventMonitoring.js";
import { DecisionMatrix } from "./modules/DecisionMatrix.js";
import { OtpModule } from "./modules/otp/OtpModule.js";
import { FixedRouteServiceRisk } from "./modules/FixedRouteServiceRisk.js";
import { OnDemandServiceQuality } from "./modules/OnDemandServiceQuality.js";
import { SpeedAlerts } from "./modules/SpeedAlerts.js";
import { MissedTripAlerts } from "./modules/MissedTripAlerts.js";

const TOOLS = [
  { key: "event-monitoring", label: "Event Monitoring" },
  { key: "decision-matrix", label: "Decision Matrix" },
  { key: "otp", label: "OTP Compliance" },
  { key: "fixed-route-risk", label: "Fixed Route Risk" },
  { key: "on-demand-quality", label: "On-Demand Quality" },
  { key: "speed-alerts", label: "Speed Alerts" },
  { key: "missed-trips", label: "Missed Trips" },
] as const;

type ToolKey = (typeof TOOLS)[number]["key"];

// OCC Tools tab (OCC.Admin): hosts the three operational modules inside the
// console shell with an internal switcher, keeping the mockup's seven primary
// tabs intact.
export function OccTools() {
  const [tool, setTool] = useState<ToolKey>("event-monitoring");

  return (
    <>
      <div className="panel-header">OCC Tools</div>
      <div className="panel-body occ-embed">
        <div className="occ-switch">
          {TOOLS.map((t) => (
            <button key={t.key} className={tool === t.key ? "active" : ""} onClick={() => setTool(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        {tool === "event-monitoring" && <EventMonitoring />}
        {tool === "decision-matrix" && <DecisionMatrix />}
        {tool === "otp" && <OtpModule />}
        {tool === "fixed-route-risk" && <FixedRouteServiceRisk />}
        {tool === "on-demand-quality" && <OnDemandServiceQuality />}
        {tool === "speed-alerts" && <SpeedAlerts />}
        {tool === "missed-trips" && <MissedTripAlerts />}
      </div>
    </>
  );
}
