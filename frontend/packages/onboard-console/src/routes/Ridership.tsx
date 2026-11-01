// Specialist Operations › Ridership (ADR 0043, spec §10). Several roles use
// ridership, so it has its own page rather than a tab of OCC Tools. Each tab is
// gated by its own action; Print sheets, Flags, Month close and Totals arrive
// with their increments.
import { useAccess } from "../auth/AccessContext.js";
import { RidershipEntry } from "./modules/ridership/RidershipEntry.js";
import "./modules/ridership/ridership.css";

export function Ridership() {
  const { can } = useAccess();
  const canEnter = can("ridership.enter");
  return (
    <>
      <div className="panel-header">{canEnter ? "Enter sheets" : "Count Sheets"}</div>
      <div className="panel-body">
        {!canEnter && <p className="ridership-dim">You can see the sheets and their counts. Keying them needs the Ridership Recorder role.</p>}
        <RidershipEntry canEnter={canEnter} />
      </div>
    </>
  );
}
