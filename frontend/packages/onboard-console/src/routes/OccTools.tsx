import { useState } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { DecisionMatrix } from "./modules/DecisionMatrix.js";
import { SpeedAlerts } from "./modules/SpeedAlerts.js";

const TOOLS = [
  { key: "decision-matrix", label: "Decision Matrix" },
  { key: "speed-alerts", label: "Speed Alerts" },
] as const;

type ToolKey = (typeof TOOLS)[number]["key"];

// OCC Tools is the governed Procedure workspace for OCC staff. Fixed Route
// and On-Demand monitoring live under Service Operations (see
// ServiceOperations.tsx), with links back here carrying operational context.
export function OccTools() {
  const { roles } = useAuth();
  const isAdmin = roles.includes("OCC.Admin");
  const [tool, setTool] = useState<ToolKey>("decision-matrix");

  return (
    <>
      <div className="panel-header">OCC Tools</div>
      <div className="panel-body occ-embed">
        <div className="occ-switch">
          {TOOLS.filter((toolOption) => toolOption.key !== "speed-alerts" || isAdmin).map((t) => (
            <button key={t.key} className={tool === t.key ? "active" : ""} onClick={() => setTool(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        {tool === "decision-matrix" && <DecisionMatrix />}
        {tool === "speed-alerts" && isAdmin && <SpeedAlerts />}
      </div>
    </>
  );
}
