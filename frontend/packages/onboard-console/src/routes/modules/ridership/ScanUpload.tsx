// Ridership › Upload scans (plans/count-sheet-scan-upload.md §1-2, increment
// S1: the Burnsville capture pilot). The garage check-in desk scans the
// shift's handed-in sheets on the MFP and uploads the PDF here. OnBoard keeps
// the file as received, then works through it page by page: which sheet each
// page is, blank backs dropped, a second copy marked.
//
// The desk sees each page's outcome and never an image: a scan shows the
// operator's name and handwriting, which only OCC and compliance open
// (ridership.scans.view). A page OnBoard could not identify is named by its
// page number in the file, so the desk finds it in the stack and types its
// block and date from the paper.
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, type RidershipScanDesk, type RidershipScanPage, type RidershipScanUpload } from "@mvta/shared";
import { api } from "../../../config.js";
import { centralDay, formatServiceDate, garageFromValue, garageName, garageValue, normalizeBlock } from "../../../lib/ridership.js";
import { SCAN_PAGE_LABEL, SCAN_PAGE_TONE, scanPageNote, scanUploadSummary } from "../../../lib/ridershipScans.js";

type Load<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "error"; message: string };

// The desk's garage, shared with Print sheets: one desk, one garage.
const GARAGE_KEY = "ridership.print.garage";
function remembered(): string | null {
  try { return window.localStorage.getItem(GARAGE_KEY); } catch { return null; }
}
function remember(value: string) {
  try { window.localStorage.setItem(GARAGE_KEY, value); } catch { /* not kept; nothing breaks */ }
}

function loadError(error: unknown): string {
  if (error instanceof ApiError && error.status === 503) return error.message;
  if (error instanceof ApiError && error.status === 403) return "Uploading scans needs the Ridership Printer, Ridership Recorder or Ridership Manager role.";
  return "The scans could not be loaded.";
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const POLL_MS = 3000;

export function ScanUpload() {
  const [day, setDay] = useState(() => centralDay(0));
  const [garages, setGarages] = useState<(string | null)[]>([]);
  const [garage, setGarage] = useState<string | null | undefined>(undefined);
  const [desk, setDesk] = useState<Load<RidershipScanDesk>>({ state: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const date = day.replace(/-/g, "");

  // The garages are the print list's: the desk's own is remembered from printing.
  useEffect(() => {
    api.getRidershipPrintStatus({ date })
      .then((status) => {
        const named = status.garages.filter((g): g is string => g !== null);
        setGarages(named);
        setGarage((current) => {
          if (current !== undefined && (current === null || named.includes(current))) return current;
          const saved = remembered();
          return named.find((g) => garageValue(g) === saved) ?? named[0] ?? null;
        });
      })
      .catch(() => { setGarages([]); setGarage((current) => current ?? null); });
  }, [date]);

  const load = useCallback(() => {
    if (garage === undefined) return;
    api.getRidershipScanDesk({ date, garage })
      .then((data) => setDesk({ state: "ready", data }))
      .catch((error) => setDesk({ state: "error", message: loadError(error) }));
  }, [date, garage]);

  useEffect(() => { setDesk({ state: "loading" }); load(); }, [load]);

  // While anything is still being worked through, look again every few seconds.
  const working = desk.state === "ready" && desk.data.uploads.some((u) => ["queued", "splitting", "processing"].includes(u.status));
  useEffect(() => {
    if (!working) return;
    const timer = window.setTimeout(load, POLL_MS);
    return () => window.clearTimeout(timer);
  }, [working, load, desk]);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0 || busy) return;
    setProblem(null);
    setMessage(null);
    try {
      for (const file of Array.from(files)) {
        if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
          setProblem(`${file.name} is not a PDF. Scan to PDF on the MFP and upload that.`);
          continue;
        }
        setBusy(`Checking ${file.name}…`);
        const hash = await sha256(file);
        setBusy(`Uploading ${file.name}…`);
        const target = await api.createRidershipScanUpload({ file_name: file.name, size_bytes: file.size, garage: garage ?? null, content_type: "application/pdf" });
        const put = await fetch(target.upload_url, { method: "PUT", headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": "application/pdf" }, body: file });
        if (!put.ok) throw new Error(`The file could not be stored (${put.status}). Try again.`);
        await api.submitRidershipScanUpload(target.upload_id, hash);
      }
      setMessage("Uploaded. OnBoard is reading the pages; this list updates as each one is done. Keep the paper until every page shows its block.");
    } catch (error) {
      setProblem(error instanceof ApiError || error instanceof Error ? error.message : "The upload failed. Try again.");
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
      load();
    }
  }

  function chooseGarage(value: string) {
    const next = garageFromValue(value);
    setGarage(next);
    remember(value);
  }

  const expected = desk.state === "ready" ? desk.data.expected : [];
  const missing = expected.filter((s) => s.scanned_pages < s.pages);

  return (
    <div className="ridership-print ridership-scan-upload">
      <p className="ridership-dim">
        Scan the shift's handed-in Count Sheets on the MFP as one PDF (300 dpi, staples out, face down), then upload it here.
        You see which sheet each page is; you do not see the pages themselves.
      </p>
      <div className="ridership-toolbar">
        <label>
          <span className="ridership-eyebrow">Garage</span>
          <select value={garage === undefined ? "" : garageValue(garage)} onChange={(e) => chooseGarage(e.target.value)}>
            {garages.map((g) => <option key={garageValue(g)} value={garageValue(g)}>{garageName(g)}</option>)}
            {garages.length === 0 && <option value="">No garage</option>}
          </select>
        </label>
        <label>
          <span className="ridership-eyebrow">Sheets for service date</span>
          <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
        </label>
        <label className="ridership-file">
          <span className="ridership-eyebrow">Scanned PDF</span>
          <input ref={fileInput} type="file" accept="application/pdf,.pdf" multiple disabled={busy !== null || garage === undefined}
            aria-label="Choose the scanned PDF to upload" onChange={(e) => void upload(e.target.files)} />
        </label>
      </div>
      {busy && <p className="ridership-dim" role="status">{busy}</p>}
      {message && <div className="ridership-toast" role="status">{message}</div>}
      {problem && <div className="ridership-problems" role="alert"><p>{problem}</p></div>}

      {desk.state === "loading" && <p className="ridership-dim">Loading scans.</p>}
      {desk.state === "error" && <div className="ridership-problems" role="alert"><p>{desk.message}</p></div>}
      {desk.state === "ready" && <>
        <section className={`ridership-print-status ${missing.length === 0 && expected.length > 0 ? "is-ok" : "is-todo"}`} aria-label="Sheets still to scan">
          <strong>{formatServiceDate(date)} · {garageName(desk.data.garage)}:</strong>{" "}
          {expected.length === 0 ? "no sheets on this date."
            : missing.length === 0 ? `all ${expected.length} sheets scanned.`
              : `${expected.length - missing.length} of ${expected.length} sheets scanned. Not scanned yet: ${missing.map((s) => s.scanned_pages > 0 ? `${s.block} (page missing)` : s.block).join(", ")}.`}
        </section>

        {desk.data.uploads.length === 0 && <p className="ridership-dim">No uploads for this garage around {formatServiceDate(date)} yet.</p>}
        {desk.data.uploads.map((u) => <UploadCard key={u.upload_id} upload={u} defaultDate={date} onChanged={load} />)}
      </>}
    </div>
  );
}

function UploadCard({ upload, defaultDate, onChanged }: { upload: RidershipScanUpload; defaultDate: string; onChanged: () => void }) {
  const needsPerson = upload.pages.filter((p) => p.state === "unreadable");
  return (
    <section className="ridership-scan-card" aria-label={`Upload ${upload.file_name}`}>
      <div className="ridership-list-head">
        <h3>{upload.file_name}</h3>
        <span className="ridership-dim">{scanUploadSummary(upload)}</span>
      </div>
      {upload.status_detail && <p className="ridership-problems" role="alert">{upload.status_detail}</p>}
      {needsPerson.length > 0 && <p className="ridership-dim">
        {needsPerson.length === 1 ? "One page needs" : `${needsPerson.length} pages need`} you: find {needsPerson.length === 1 ? "it" : "them"} in the stack by page number and type the block and date from the paper.
      </p>}
      {upload.pages.length > 0 && <div className="ridership-scroll"><table className="ridership-list">
        <thead><tr><th>Page</th><th>Outcome</th><th>Sheet</th><th>How</th></tr></thead>
        <tbody>
          {upload.pages.map((p) => (
            <tr key={p.page_id} className={p.state === "unreadable" ? "is-changed" : undefined}>
              <td className="mono">{p.page_number}</td>
              <td>
                <span className={`ridership-pill is-${SCAN_PAGE_TONE[p.state]}`}>{SCAN_PAGE_LABEL[p.state]}</span>
                {p.date_flag && <span className="ridership-pill is-warn">Check date</span>}
              </td>
              <td>{p.block ? <>Block <span className="mono">{p.block}</span>{p.sheet_page && p.sheet_page > 1 ? ` page ${p.sheet_page}` : ""} · {formatServiceDate(p.service_date!)}</> : "—"}</td>
              <td>{p.state === "unreadable" || (p.assigned_by && p.state !== "matched")
                ? <AssignPage page={p} defaultDate={defaultDate} onChanged={onChanged} />
                : <span className="ridership-dim">{scanPageNote(p)}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table></div>}
    </section>
  );
}

function AssignPage({ page, defaultDate, onChanged }: { page: RidershipScanPage; defaultDate: string; onChanged: () => void }) {
  const [block, setBlock] = useState("");
  const [day, setDay] = useState(`${defaultDate.slice(0, 4)}-${defaultDate.slice(4, 6)}-${defaultDate.slice(6, 8)}`);
  const [sheetPage, setSheetPage] = useState(1);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function send(action: Parameters<typeof api.updateRidershipScanPage>[1]) {
    setSaving(true);
    setProblem(null);
    try {
      await api.updateRidershipScanPage(page.page_id, action);
      onChanged();
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : "Not saved. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const padded = normalizeBlock(block);
  return (
    <form className="ridership-assign" onSubmit={(e) => {
      e.preventDefault();
      if (padded) void send({ action: "assign", service_date: day.replace(/-/g, ""), block: padded, sheet_page: sheetPage });
    }}>
      <span className="ridership-dim">{scanPageNote(page)}</span>
      <label><span className="ridership-eyebrow">Block</span>
        <input className="ridership-short" inputMode="numeric" value={block} onChange={(e) => setBlock(e.target.value)} aria-label={`Block for page ${page.page_number}`} />
      </label>
      <label><span className="ridership-eyebrow">Date</span>
        <input type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-label={`Date for page ${page.page_number}`} />
      </label>
      <label><span className="ridership-eyebrow">Page</span>
        <select value={sheetPage} onChange={(e) => setSheetPage(Number(e.target.value))} aria-label={`Sheet page for page ${page.page_number}`}>
          <option value={1}>1</option><option value={2}>2</option>
        </select>
      </label>
      <button type="submit" className="ridership-secondary" disabled={saving || !padded}>Save</button>
      <button type="button" className="ridership-link" disabled={saving} onClick={() => void send({ action: "blank" })}>Blank page</button>
      <button type="button" className="ridership-link" disabled={saving} onClick={() => void send({ action: "ignore" })}>Not a Count Sheet</button>
      {problem && <span className="ridership-pill is-bad" role="alert">{problem}</span>}
    </form>
  );
}
