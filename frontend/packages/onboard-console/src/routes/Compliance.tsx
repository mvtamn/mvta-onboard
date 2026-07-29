import { useState } from "react";
import { OtpModule } from "./modules/otp/OtpModule.js";
import { MissedTripAlerts } from "./modules/MissedTripAlerts.js";

const TOOLS = [
  { key: "otp", label: "OTP Compliance" },
  { key: "missed-trips", label: "Missed Trips" },
] as const;

type ToolKey = (typeof TOOLS)[number]["key"];

// Compliance tab (OCC.Compliance or OCC.Admin): hosts the compliance/
// investigation modules - OTP Compliance and Missed Trips - split out of OCC
// Tools so Compliance access can be granted independently of full OCC Tools
// access. Same internal-switcher shell as OccTools.tsx.
export function Compliance() {
  const [tool, setTool] = useState<ToolKey>("otp");

  return (
    <>
      <div className="panel-header">Compliance</div>
      <div className="panel-body occ-embed">
        <div className="occ-switch">
          {TOOLS.map((t) => (
            <button key={t.key} className={tool === t.key ? "active" : ""} onClick={() => setTool(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        {tool === "otp" && <OtpModule />}
        {tool === "missed-trips" && <MissedTripAlerts />}
      </div>
    </>
  );
}
