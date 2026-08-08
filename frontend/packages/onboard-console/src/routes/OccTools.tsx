import { useState } from "react";
import { DecisionMatrix } from "./modules/DecisionMatrix.js";
import { FixedRouteServiceRisk } from "./modules/FixedRouteServiceRisk.js";
import { OnDemandServiceQuality } from "./modules/OnDemandServiceQuality.js";
import { SpeedAlerts } from "./modules/SpeedAlerts.js";

const TOOLS = [
  { key: "decision-matrix", label: "Decision Matrix" },
  { key: "fixed-route-risk", label: "Fixed Route Risk" },
  { key: "on-demand-quality", label: "On-Demand Quality" },
  { key: "speed-alerts", label: "Speed Alerts" },
] as const;

type ToolKey = (typeof TOOLS)[number]["key"];

// OCC Tools tab (OCC.Admin): hosts the five service-risk/monitoring modules
// inside the console shell with an internal switcher. OTP Compliance and
// Missed Trips moved out to their own Compliance tab (see Compliance.tsx),
// gated by the OCC.Compliance role instead of OCC.Admin.
export function OccTools() {
  const [tool, setTool] = useState<ToolKey>("decision-matrix");

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
        {tool === "decision-matrix" && <DecisionMatrix />}
        {tool === "fixed-route-risk" && <FixedRouteServiceRisk />}
        {tool === "on-demand-quality" && <OnDemandServiceQuality />}
        {tool === "speed-alerts" && <SpeedAlerts />}
      </div>
    </>
  );
}
