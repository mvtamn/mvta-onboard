import { useState } from "react";
import { DecisionMatrix } from "./modules/DecisionMatrix.js";
import { SpeedAlerts } from "./modules/SpeedAlerts.js";

const TOOLS = [
  { key: "decision-matrix", label: "Decision Matrix" },
  { key: "speed-alerts", label: "Speed Alerts" },
] as const;

type ToolKey = (typeof TOOLS)[number]["key"];

// OCC Tools remains the admin-only home for specialist procedure and speed
// monitoring tools. Fixed Route and On-Demand monitoring now live under the
// role-aware Service Operations workspace (see ServiceOperations.tsx).
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
        {tool === "speed-alerts" && <SpeedAlerts />}
      </div>
    </>
  );
}
