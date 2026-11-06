// The scanned page beside OCC's sheet form (plans/count-sheet-scan-upload.md
// §4, increment S1). OCC keys the sheet from the image without waiting for
// the paper to travel. Nothing is read from it: every value is still typed.
//
// The image shows the operator's name and handwriting, so it opens only for
// ridership.scans.view, through a link the API makes for five minutes and
// logs as an open. The sheet's own page opens with the sheet; a second copy
// or an older print opens on request.
import { useEffect, useState } from "react";
import { ApiError, type RidershipScanPage, type RidershipSheet } from "@mvta/shared";
import { api } from "../../../config.js";
import { SCAN_PAGE_LABEL, SCAN_PAGE_TONE, scanPageNote } from "../../../lib/ridershipScans.js";

type Image = { state: "idle" } | { state: "loading" } | { state: "ready"; url: string } | { state: "error"; message: string };

const pageLabel = (p: RidershipScanPage) => `Page ${p.sheet_page ?? 1}${p.state === "matched" ? "" : ` · ${SCAN_PAGE_LABEL[p.state].toLowerCase()}`}`;

export function ScanPanel({ sheet }: { sheet: RidershipSheet }) {
  const pages = sheet.scan?.pages ?? [];
  const canView = sheet.scan?.can_view_images ?? false;
  const first = pages.find((p) => p.state === "matched") ?? pages[0];
  const [shown, setShown] = useState<string | null>(canView && first ? first.page_id : null);
  const [image, setImage] = useState<Image>({ state: "idle" });
  const [large, setLarge] = useState(false);

  useEffect(() => {
    if (!shown) { setImage({ state: "idle" }); return; }
    let live = true;
    setImage({ state: "loading" });
    api.getRidershipScanImage(shown)
      .then((link) => live && setImage({ state: "ready", url: link.url }))
      .catch((error) => live && setImage({ state: "error", message: error instanceof ApiError ? error.message : "The scan could not be opened." }));
    return () => { live = false; };
  }, [shown]);

  if (!sheet.scan) return null;
  if (pages.length === 0) {
    return <aside className="ridership-scan-panel is-empty" aria-label="Scan"><p className="ridership-dim">No scan of this sheet yet. Key it from the paper.</p></aside>;
  }
  const current = pages.find((p) => p.page_id === shown);
  return (
    <aside className="ridership-scan-panel" aria-label="Scan">
      <div className="ridership-scan-pages">
        {pages.map((p) => (
          <button key={p.page_id} type="button" className="ridership-secondary" aria-pressed={p.page_id === shown}
            disabled={!canView} onClick={() => setShown(p.page_id)}>
            {pageLabel(p)}
          </button>
        ))}
      </div>
      {!canView && <p className="ridership-dim">This sheet is scanned. Opening scans needs the Ridership Recorder or Ridership Manager role.</p>}
      {current && <p className="ridership-dim">
        <span className={`ridership-pill is-${SCAN_PAGE_TONE[current.state]}`}>{SCAN_PAGE_LABEL[current.state]}</span>
        {scanPageNote(current)}
        {current.printed_at && ` Printed ${new Date(current.printed_at).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" })}.`}
        {current.date_flag && " The sheet's date is far from when it was scanned: check it is not an old sheet."}
      </p>}
      {image.state === "loading" && <p className="ridership-dim">Opening the scan.</p>}
      {image.state === "error" && <p className="ridership-problems" role="alert">{image.message}</p>}
      {image.state === "ready" && (
        <button type="button" className={`ridership-scan-image${large ? " is-large" : ""}`} onClick={() => setLarge((l) => !l)}
          aria-label={large ? "Show the scan smaller" : "Show the scan larger"}>
          <img src={image.url} alt={`Scan of block ${sheet.block}, ${current ? pageLabel(current).toLowerCase() : "page"}`} />
        </button>
      )}
      {canView && <p className="ridership-dim ridership-scan-note">Each time a scan opens, OnBoard records who opened it.</p>}
    </aside>
  );
}
