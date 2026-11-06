// Specialist Operations › Ridership (ADR 0043, spec §10). Several roles use
// ridership, so it has its own page rather than a tab of OCC Tools. Each tab is
// gated by its own action; Flags, Month close and Totals arrive with their
// increments. The garage check-in desk (Ridership Printer) holds print and
// scan without view, so it sees Print sheets and Upload scans and never the
// Count Sheets, the counts or a scan image.
import { useEffect, useState } from "react";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { useAccess } from "../auth/AccessContext.js";
import { api } from "../config.js";
import { centralDay, normalizeBlock, reprintsAfterPrinting, sheetKey } from "../lib/ridership.js";
import { PrintSheets } from "./modules/ridership/PrintSheets.js";
import { RidershipEntry } from "./modules/ridership/RidershipEntry.js";
import { ScanUpload } from "./modules/ridership/ScanUpload.js";
import "./modules/ridership/ridership.css";

type Tab = "enter" | "print" | "scan";

const TAB_TITLE: Record<Tab, string> = { enter: "", print: "Print sheets", scan: "Upload scans" };

export function Ridership() {
  const { can } = useAccess();
  const canEnter = can("ridership.enter");
  const canPrint = can("ridership.print");
  const canScan = can("ridership.scan");
  const canView = can("ridership.view");
  const [params, setParams] = useSearchParams();
  const available: Tab[] = [...(canView ? ["enter" as const] : []), ...(canPrint ? ["print" as const] : []), ...(canScan ? ["scan" as const] : [])];
  const asked = params.get("tab");
  const tab: Tab = available.find((t) => t === asked) ?? available[0] ?? "enter";
  // A printed sheet's QR link arrives as ?sheet=<YYYYMMDD>|<block> (see SheetLink).
  const sheet = tab === "enter" ? params.get("sheet") : null;
  const enterLabel = canEnter ? "Enter sheets" : "Count Sheets";
  // Every garage's sheets for today that changed after the evening print, so
  // the morning desk sees them without opening the print list.
  const [toReprint, setToReprint] = useState(0);
  useEffect(() => {
    if (!canPrint) return;
    api.getRidershipPrintStatus({ date: centralDay(0).replace(/-/g, "") })
      .then((status) => setToReprint(reprintsAfterPrinting(status).total))
      .catch(() => setToReprint(0));
  }, [canPrint, tab]);

  function show(next: Tab) {
    setParams(next === available[0] ? {} : { tab: next }, { replace: true });
  }

  return (
    <>
      <div className="panel-header">{TAB_TITLE[tab] || enterLabel}</div>
      <div className="panel-body">
        {available.length > 1 && (
          <div className="ridership-tabs" role="tablist" aria-label="Ridership">
            {canView && <button type="button" role="tab" aria-selected={tab === "enter"} onClick={() => show("enter")}>{enterLabel}</button>}
            {canPrint && <button type="button" role="tab" aria-selected={tab === "print"} onClick={() => show("print")}>
              Print sheets{toReprint > 0 && <span className="ridership-pill is-warn">{toReprint} to reprint today</span>}
            </button>}
            {canScan && <button type="button" role="tab" aria-selected={tab === "scan"} onClick={() => show("scan")}>Upload scans</button>}
          </div>
        )}
        {tab === "print" ? <PrintSheets /> : tab === "scan" ? <ScanUpload /> : <>
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
