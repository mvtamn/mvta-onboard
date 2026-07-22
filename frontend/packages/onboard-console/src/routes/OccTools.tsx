import { useState } from "react";
import { EventMonitoring } from "./modules/EventMonitoring.js";
import { DecisionMatrix } from "./modules/DecisionMatrix.js";
import { OtpModule } from "./modules/otp/OtpModule.js";

const TOOLS = [
  { key: "event-monitoring", label: "Event Monitoring" },
  { key: "decision-matrix", label: "Decision Matrix" },
  { key: "otp", label: "OTP Compliance" },
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
      </div>
    </>
  );
}
