// Enter sheets (spec §4, decided 2026-10-30): OCC lands on a worklist of
// sheets still to key, completeness by garage on top, late sheets first. A row
// opens the sheet form full-width; Save goes straight to the next sheet in the
// queue and Esc returns to the worklist.
//
// The queue is the worklist as it stood when the first sheet opened, so a
// save that changes the list does not change what "next" means.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, type RidershipSheet, type RidershipWorklist } from "@mvta/shared";
import { api } from "../../../config.js";
import {
  dueLabel,
  formatServiceDate,
  garageName,
  garagePercent,
  isOpenState,
  parseSheetScan,
  sheetKey,
  splitSheetKey,
  STATE_LABEL,
  STATE_TONE,
} from "../../../lib/ridership.js";
import { SheetForm } from "./SheetForm.js";

type Load<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "error"; message: string };

function loadError(error: unknown, what: string): string {
  if (error instanceof ApiError && error.status === 503) return "Ridership counting is not set up in this environment yet: migration 153 has not been applied.";
  if (error instanceof ApiError && error.status === 404) return error.message;
  return `${what} could not be loaded.`;
}

/** How far back the worklist reaches. A sheet stays late until it is keyed, so the longer reach finds old ones. */
const RANGES = [
  { days: 7, label: "Last 8 days" },
  { days: 31, label: "Last 32 days" },
] as const;

function serviceDateDaysAgo(days: number, now = new Date()): string {
  // The API's "today" is the Central service day; a day either side of it at
  // midnight makes no difference to a range this long.
  const d = new Date(now.getTime() - days * 86_400_000);
  return d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" }).replace(/-/g, "");
}

/** `initialSheet` (a sheet key) opens that sheet straight away: a printed sheet's QR link. */
export function RidershipEntry({ canEnter, initialSheet = null }: { canEnter: boolean; initialSheet?: string | null }) {
  const [range, setRange] = useState<number>(RANGES[0].days);
  const [worklist, setWorklist] = useState<Load<RidershipWorklist>>({ state: "loading" });
  const [garage, setGarage] = useState<string | null | "all">("all");
  const [cursor, setCursor] = useState(0);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const [sheet, setSheet] = useState<Load<RidershipSheet>>({ state: "loading" });
  const [dirty, setDirty] = useState(false);
  const [leaveWarned, setLeaveWarned] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [scan, setScan] = useState("");

  const refreshWorklist = useCallback(() => {
    const to = serviceDateDaysAgo(0);
    api.getRidershipWorklist({ from: serviceDateDaysAgo(range), to })
      .then((data) => setWorklist({ state: "ready", data }))
      .catch((error) => setWorklist({ state: "error", message: loadError(error, "The worklist") }));
  }, [range]);

  useEffect(() => { refreshWorklist(); }, [refreshWorklist]);

  useEffect(() => {
    if (!initialSheet) return;
    setQueue([initialSheet]);
    setOpenKey(initialSheet);
  }, [initialSheet]);

  // The next sheet in the queue is fetched while this one is keyed, so Save
  // opens it at once and the first keystrokes land in it rather than nowhere.
  // A copy is used once; one gone stale is caught by the save's version check.
  const prefetched = useRef(new Map<string, Promise<RidershipSheet>>());
  const fetchSheet = (key: string) => {
    const { serviceDate, block } = splitSheetKey(key);
    return api.getRidershipSheet(serviceDate, block);
  };

  const loadOpenSheet = useCallback((key: string, fresh = false) => {
    const ahead = fresh ? undefined : prefetched.current.get(key);
    prefetched.current.delete(key);
    setSheet({ state: "loading" });
    setDirty(false);
    setLeaveWarned(false);
    (ahead ?? fetchSheet(key))
      .then((data) => setSheet({ state: "ready", data }))
      .catch((error) => setSheet({ state: "error", message: loadError(error, "The sheet") }));
  }, []);

  useEffect(() => { if (openKey) loadOpenSheet(openKey); }, [openKey, loadOpenSheet]);

  useEffect(() => {
    if (!openKey || sheet.state !== "ready") return;
    const next = queue[queue.indexOf(openKey) + 1];
    if (next && !prefetched.current.has(next)) {
      const pending = fetchSheet(next);
      pending.catch(() => prefetched.current.delete(next));
      prefetched.current.set(next, pending);
    }
  }, [openKey, sheet.state, queue]);

  const sheets = worklist.state === "ready" ? worklist.data.sheets : [];
  const outstanding = useMemo(
    () => sheets.filter((s) => isOpenState(s.state) && (garage === "all" || s.garage === garage)),
    [sheets, garage],
  );
  const entered = sheets.filter((s) => !isOpenState(s.state));

  function open(key: string) {
    const keys = outstanding.map((s) => sheetKey(s.service_date, s.block));
    setQueue(keys.includes(key) ? keys : [key, ...keys]);
    prefetched.current.clear();
    setOpenKey(key);
    setToast(null);
  }

  /** Leaving a sheet with unsaved changes takes a second press, so a stray Esc loses nothing. */
  function leave(go: () => void) {
    if (dirty && !leaveWarned) {
      setLeaveWarned(true);
      return;
    }
    go();
  }

  function close() {
    leave(() => {
      setOpenKey(null);
      refreshWorklist();
    });
  }

  function onSaved(saved: RidershipSheet) {
    const key = sheetKey(saved.service_date, saved.block);
    const rest = queue.slice(queue.indexOf(key) + 1);
    const label = `Block ${saved.block} (${formatServiceDate(saved.service_date)}) saved`;
    refreshWorklist();
    if (rest.length > 0) {
      const next = splitSheetKey(rest[0]);
      setToast(`${label}. Now on block ${next.block} (${formatServiceDate(next.serviceDate)}).`);
      setOpenKey(rest[0]);
    } else {
      setToast(`${label}. That was the last sheet in the queue.`);
      setOpenKey(null);
    }
  }

  // A scanned code names one sheet; a typed block has no date, so it opens
  // that block's oldest open sheet, else its newest.
  function openScanned(raw: string) {
    const parsed = parseSheetScan(raw);
    if (!parsed) {
      setToast(`"${raw.trim()}" is not a Count Sheet code or a block number.`);
      return;
    }
    const key = parsed.serviceDate
      ? sheetKey(parsed.serviceDate, parsed.block)
      : (() => {
        const mine = sheets.filter((s) => s.block === parsed.block);
        const openOne = [...mine].filter((s) => isOpenState(s.state)).sort((a, b) => a.service_date.localeCompare(b.service_date))[0];
        const latest = [...mine].sort((a, b) => b.service_date.localeCompare(a.service_date))[0];
        const found = openOne ?? latest;
        return found ? sheetKey(found.service_date, found.block) : null;
      })();
    if (!key) {
      setToast(`No sheet for block ${parsed.block} in the worklist's dates.`);
      return;
    }
    setScan("");
    open(key);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (openKey) {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, button")) return;
      if (event.key === "ArrowDown") { event.preventDefault(); setCursor((c) => Math.min(c + 1, outstanding.length - 1)); }
      if (event.key === "ArrowUp") { event.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
      if (event.key === "Enter" && outstanding[cursor]) {
        event.preventDefault();
        open(sheetKey(outstanding[cursor].service_date, outstanding[cursor].block));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (openKey) {
    const position = queue.indexOf(openKey);
    const previous = position > 0 ? queue[position - 1] : null;
    const next = position >= 0 && position < queue.length - 1 ? queue[position + 1] : null;
    const nav = (
      <div className="ridership-nav">
        <button type="button" className="ridership-link" onClick={close}>← Worklist <kbd>Esc</kbd></button>
        <span className="ridership-dim">Sheet {position + 1} of {queue.length}{garage !== "all" ? ` · ${garageName(garage)}` : ""}</span>
        <span className="ridership-step">
          <button type="button" className="ridership-link" disabled={!previous} onClick={() => previous && leave(() => setOpenKey(previous))}>‹ Previous</button>
          <button type="button" className="ridership-link" disabled={!next} onClick={() => next && leave(() => setOpenKey(next))}>Skip ›</button>
        </span>
      </div>
    );
    return (
      <div className="ridership-entry">
        {toast && <div className="ridership-toast" role="status">{toast}</div>}
        {leaveWarned && <div className="ridership-problems" role="alert"><p>This sheet has changes that are not saved. Press Esc again, or choose again, to leave without saving.</p></div>}
        {sheet.state === "loading" && <p className="ridership-dim">Loading block {splitSheetKey(openKey).block}.</p>}
        {sheet.state === "error" && <div className="ridership-paper">{nav}<p className="ridership-problems" role="alert">{sheet.message}</p></div>}
        {sheet.state === "ready" && <div className="ridership-paper">
          <SheetForm key={`${openKey}|${sheet.data.version ?? ""}`} sheet={sheet.data} readOnly={!canEnter} nav={nav}
            onSaved={onSaved} onReload={() => loadOpenSheet(openKey, true)} onDirtyChange={setDirty} />
        </div>}
        <p className="ridership-dim ridership-keys">
          <kbd>Enter</kbd> next trip, then Save · <kbd>Ctrl/⌘ Enter</kbd> save from anywhere · <kbd>Esc</kbd> back to the worklist ·
          type <kbd>N</kbd> for Not counted, <kbd>D</kbd> for Did not operate
        </p>
      </div>
    );
  }

  return (
    <div className="ridership-entry">
      {toast && <div className="ridership-toast" role="status">{toast}</div>}
      {worklist.state === "error" && <p className="ridership-problems" role="alert">{worklist.message}</p>}
      {worklist.state === "loading" && <p className="ridership-dim">Loading the worklist.</p>}
      {worklist.state === "ready" && <>
        <div className="ridership-garages" aria-label="Completeness by garage">
          {worklist.data.garages.map((g) => {
            const active = garage === g.garage;
            return (
              <button key={garageName(g.garage)} type="button" aria-pressed={active}
                className={`ridership-garage${g.late > 0 ? " is-bad" : ""}${active ? " is-active" : ""}`}
                onClick={() => { setGarage(active ? "all" : g.garage); setCursor(0); }}>
                <span className="ridership-eyebrow">{garageName(g.garage)}</span>
                <span className="ridership-big">{garagePercent(g)}%</span>
                <span className="ridership-dim">
                  trips keyed · {g.open} sheet{g.open === 1 ? "" : "s"} open{g.late > 0 ? ` · ${g.late} late` : ""}
                  {g.not_counted_trips > 0 ? ` · ${g.not_counted_trips} not counted` : ""}
                </span>
              </button>
            );
          })}
          {worklist.data.garages.length === 0 && <p className="ridership-dim">The Dispatch Log has no trips in these dates.</p>}
        </div>

        <div className="ridership-toolbar">
          <label className="ridership-scan">
            <span className="ridership-eyebrow">Scan a sheet's QR code, or type a block number</span>
            <input value={scan} placeholder="Scan or type block…" aria-label="Scan or type block"
              onChange={(e) => setScan(e.target.value)}
              onKeyDown={(e) => {
                // An empty box hands the keys to the list, so the keyboard flow still works with it focused.
                if (scan === "") {
                  if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, outstanding.length - 1)); }
                  if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
                  if (e.key === "Enter" && outstanding[cursor]) { e.preventDefault(); open(sheetKey(outstanding[cursor].service_date, outstanding[cursor].block)); }
                  return;
                }
                if (e.key === "Enter") { e.preventDefault(); openScanned(scan); }
                if (e.key === "Escape") setScan("");
              }} />
          </label>
          <label className="ridership-range">
            <span className="ridership-eyebrow">Service dates</span>
            <select value={range} onChange={(e) => { setRange(Number(e.target.value)); setCursor(0); }}>
              {RANGES.map((r) => <option key={r.days} value={r.days}>{r.label}</option>)}
            </select>
          </label>
        </div>

        <div className="ridership-list-head">
          <h3>
            Sheets to enter ({outstanding.length})
            {garage !== "all" && <> · {garageName(garage)} <button type="button" className="ridership-link" onClick={() => setGarage("all")}>show all</button></>}
          </h3>
          {canEnter && outstanding.length > 0 && <button type="button" className="ridership-primary"
            onClick={() => open(sheetKey(outstanding[0].service_date, outstanding[0].block))}>
            Start entering · {outstanding.length} sheet{outstanding.length === 1 ? "" : "s"}
          </button>}
        </div>
        {worklist.data.trips_without_block > 0 && <p className="ridership-dim">
          {worklist.data.trips_without_block} Dispatch Log trip{worklist.data.trips_without_block === 1 ? " has" : "s have"} no block in these dates, so no sheet carries {worklist.data.trips_without_block === 1 ? "it" : "them"}.
        </p>}
        <div className="ridership-scroll"><table className="ridership-list">
          <thead>
            <tr><th>Status</th><th>Service date</th><th>Block</th><th>Garage</th><th>Trips</th><th>Due</th></tr>
          </thead>
          <tbody>
            {outstanding.map((s, index) => {
              const key = sheetKey(s.service_date, s.block);
              const blank = s.progress.required - s.progress.keyed;
              return (
                <tr key={key} className={index === cursor ? "is-cursor" : undefined} aria-selected={index === cursor}
                  onClick={() => open(key)} onMouseEnter={() => setCursor(index)}>
                  <td><span className={`ridership-pill is-${STATE_TONE[s.state]}`}>{STATE_LABEL[s.state]}</span></td>
                  <td>{formatServiceDate(s.service_date)}</td>
                  <td className="mono"><button type="button" className="ridership-link" onClick={(e) => { e.stopPropagation(); open(key); }}>{s.block}</button></td>
                  <td>{s.garage ?? <span className="ridership-pill is-warn">Unassigned</span>}</td>
                  <td>{blank === s.progress.required ? s.progress.required : `${blank} of ${s.progress.required} blank`}</td>
                  <td>{dueLabel(s.service_date)}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        {outstanding.length === 0 && <p className="ridership-dim">Every sheet{garage !== "all" ? ` for ${garageName(garage)}` : ""} in these dates is entered.</p>}
        <p className="ridership-dim ridership-keys">
          <kbd>↑</kbd> <kbd>↓</kbd> choose · <kbd>Enter</kbd> open · late sheets first, then the oldest service date · choose a garage to work only its sheets
        </p>
        {entered.length > 0 && <details className="ridership-done">
          <summary>Entered ({entered.length})</summary>
          <ul>
            {entered.map((s) => (
              <li key={sheetKey(s.service_date, s.block)}>
                <button type="button" className="ridership-link" onClick={() => open(sheetKey(s.service_date, s.block))}>
                  Block {s.block} · {formatServiceDate(s.service_date)}
                </button>{" "}
                <span className={`ridership-pill is-${STATE_TONE[s.state]}`}>{STATE_LABEL[s.state]}</span>
                {s.reconstructed && <span className="ridership-pill is-muted">Reconstructed</span>}
                {s.entered_by && <span className="ridership-dim"> by {s.entered_by}</span>}
              </li>
            ))}
          </ul>
        </details>}
      </>}
    </div>
  );
}
