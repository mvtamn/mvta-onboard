// Specialist Operations › Ridership (ADR 0043, spec §10). Several roles use
// ridership, so it has its own page rather than a tab of OCC Tools. Each tab is
// gated by its own action; Flags, Month close and Totals arrive with their
// increments.
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { useAccess } from "../auth/AccessContext.js";
import { normalizeBlock, sheetKey } from "../lib/ridership.js";
import { PrintSheets } from "./modules/ridership/PrintSheets.js";
import { RidershipEntry } from "./modules/ridership/RidershipEntry.js";
import "./modules/ridership/ridership.css";

type Tab = "enter" | "print";

export function Ridership() {
  const { can } = useAccess();
  const canEnter = can("ridership.enter");
  const canPrint = can("ridership.print");
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "print" && canPrint ? "print" : "enter";
  // A printed sheet's QR link arrives as ?sheet=<YYYYMMDD>|<block> (see SheetLink).
  const sheet = tab === "enter" ? params.get("sheet") : null;
  const enterLabel = canEnter ? "Enter sheets" : "Count Sheets";

  function show(next: Tab) {
    setParams(next === "print" ? { tab: "print" } : {}, { replace: true });
  }

  return (
    <>
      <div className="panel-header">{tab === "print" ? "Print sheets" : enterLabel}</div>
      <div className="panel-body">
        {canPrint && (
          <div className="ridership-tabs" role="tablist" aria-label="Ridership">
            <button type="button" role="tab" aria-selected={tab === "enter"} onClick={() => show("enter")}>{enterLabel}</button>
            <button type="button" role="tab" aria-selected={tab === "print"} onClick={() => show("print")}>Print sheets</button>
          </div>
        )}
        {tab === "print" ? <PrintSheets /> : <>
          {!canEnter && <p className="ridership-dim">You can see the sheets and their counts. Keying them needs the Ridership Recorder role.</p>}
          <RidershipEntry canEnter={canEnter} initialSheet={sheet} />
        </>}
      </div>
    </>
  );
}

/**
 * /r/<YYYYMMDD>/<block>: where a printed Count Sheet's QR code points until
 * the operator app has its own address (spec §15). It opens that sheet on the
 * Ridership page; anything malformed lands on the worklist.
 */
export function SheetLink() {
  const { date = "", block = "" } = useParams();
  const padded = normalizeBlock(block);
  if (!/^\d{8}$/.test(date) || !padded) return <Navigate to="/ridership" replace />;
  return <Navigate to={`/ridership?sheet=${encodeURIComponent(sheetKey(date, padded))}`} replace />;
}
