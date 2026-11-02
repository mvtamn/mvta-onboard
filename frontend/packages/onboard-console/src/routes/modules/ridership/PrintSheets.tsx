// Ridership › Print sheets (build plan PR 4, the bulk-printing evaluation of
// 2026-10-31). The garage's check-in desk prints the next service date's
// Count Sheets as one PDF: its own garage only, in pull-out order, with an
// optional blank back per page for printers that default to double-sided.
// The print log says whether the garage has printed, who printed and when,
// and which blocks the Dispatch Log changed since - with a reprint of just
// those. Any date prints, so a lost sheet can be reprinted. A block with no
// garage is in no garage's stack, so each garage's view says how many there
// are and which: otherwise no desk prints them and the operator gets no sheet.
// While the desk looks at another date, today's sheets that changed after
// printing (the 03:30 Dispatch Log run) are called out with a reprint, for the
// morning check.
import { useCallback, useEffect, useState } from "react";
import { ApiError, type RidershipPrintStatus } from "@mvta/shared";
import { api } from "../../../config.js";
import {
  PRINT_STATE_LABEL,
  PRINT_STATE_TONE,
  blocksToPrint,
  centralDay,
  clock,
  formatServiceDate,
  garageFromValue,
  garageName,
  garageValue,
  printedTime,
  reprintsAfterPrinting,
  sheetLinkBase,
} from "../../../lib/ridership.js";

type Load<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "error"; message: string };

// Per-viewer conveniences: the desk's garage and printer habit. Storage can
// be unavailable (private windows, blocked site data); the page works without.
const GARAGE_KEY = "ridership.print.garage";
const BACKS_KEY = "ridership.print.blankBacks";
function remembered(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function remember(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* not kept; nothing breaks */ }
}

function loadError(error: unknown): string {
  if (error instanceof ApiError && error.status === 503) return error.message;
  if (error instanceof ApiError && error.status === 403) return "Printing Count Sheets needs the Ridership Printer, Ridership Recorder or Ridership Manager role.";
  return "The print list could not be loaded.";
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "001, 002 and 003"; past twelve, the first ten and how many more. */
function listBlocks(blocks: readonly string[]): string {
  const shown = blocks.length > 12 ? blocks.slice(0, 10) : blocks;
  const rest = blocks.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} and ${rest} more`;
  return shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

export function PrintSheets() {
  const [day, setDay] = useState(() => centralDay(1));
  // undefined: not chosen yet; the first load picks the remembered garage or the first one.
  const [garage, setGarage] = useState<string | null | undefined>(undefined);
  const [blankBacks, setBlankBacks] = useState(() => remembered(BACKS_KEY) === "true");
  const [status, setStatus] = useState<Load<RidershipPrintStatus>>({ state: "loading" });
  // The date's Unassigned blocks, while a named garage is chosen; null when there are none or they could not be read.
  const [unassigned, setUnassigned] = useState<string[] | null>(null);
  // The chosen garage's sheets for today, when the date shown is another day.
  const [todayStatus, setTodayStatus] = useState<RidershipPrintStatus | null>(null);
  const [printing, setPrinting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const date = day.replace(/-/g, "");
  const today = centralDay(0).replace(/-/g, "");

  const load = useCallback(async (chosen: string | null | undefined) => {
    setStatus({ state: "loading" });
    let shown = chosen;
    try {
      let data = await api.getRidershipPrintStatus({ date, garage: chosen });
      if (chosen === undefined || !data.garages.includes(chosen)) {
        const saved = remembered(GARAGE_KEY);
        const pick = data.garages.find((g) => saved !== null && garageValue(g) === saved) ?? data.garages[0];
        if (pick !== undefined) {
          data = await api.getRidershipPrintStatus({ date, garage: pick });
          setGarage(pick);
          shown = pick;
        }
      }
      const shownGarage = data.garage === undefined ? chosen : data.garage;
      let orphans: string[] | null = null;
      if (shownGarage !== null && data.garages.includes(null)) {
        orphans = await api.getRidershipPrintStatus({ date, garage: null })
          .then((u) => u.sheets.map((s) => s.block).sort())
          .catch(() => null);
      }
      setUnassigned(orphans && orphans.length > 0 ? orphans : null);
      setStatus({ state: "ready", data });
    } catch (error) {
      setStatus({ state: "error", message: loadError(error) });
    }
    // Only a note: if today's list can't be read, the page still prints.
    setTodayStatus(date === today || shown === undefined ? null
      : await api.getRidershipPrintStatus({ date: today, garage: shown }).catch(() => null));
  }, [date, today]);

  // The date decides which garages have sheets, so changing it re-picks.
  useEffect(() => { void load(garage); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  function chooseGarage(value: string) {
    const next = garageFromValue(value);
    setGarage(next);
    remember(GARAGE_KEY, value);
    setMessage(null);
    setProblem(null);
    void load(next);
  }

  async function print(blocks?: string[], on: string = date) {
    if (printing || garage === undefined) return;
    // Opened before the request, while the click still counts as the user's,
    // so a popup blocker lets the PDF through.
    const tab = window.open("", "_blank");
    setPrinting(true);
    setMessage(null);
    setProblem(null);
    try {
      const pdf = await api.printRidershipSheets({
        date: on, garage, blocks, blank_backs: blankBacks,
        link_base: sheetLinkBase(window.location.origin, import.meta.env.BASE_URL),
      });
      const url = URL.createObjectURL(pdf);
      if (tab) {
        tab.location.href = url;
      } else {
        const link = document.createElement("a");
        link.href = url;
        link.download = `count-sheets-${on}.pdf`;
        link.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
      const what = blocks ? plural(blocks.length, "sheet") : "the stack";
      setMessage(`Opened ${what} for ${garageName(garage)}${on === date ? "" : `, ${formatServiceDate(on)},`} as a PDF. Print it at actual size${blankBacks ? "" : ", single-sided"}.`);
      void load(garage);
    } catch (error) {
      tab?.close();
      setProblem(error instanceof Error && error.message ? error.message : "The sheets could not be printed.");
    } finally {
      setPrinting(false);
    }
  }

  const data = status.state === "ready" ? status.data : null;
  const sheets = data?.sheets ?? [];
  const pending = blocksToPrint(sheets);
  const dropped = data?.dropped ?? [];
  const stale = sheets.filter((s) => s.state === "changed");
  const label = garage === undefined ? "" : garageName(garage);
  const morning = todayStatus ? reprintsAfterPrinting(todayStatus) : null;
  const morningBlocks = morning ? [...morning.changed, ...morning.added] : [];

  return (
    <div className="ridership-print">
      {morning && morning.total > 0 && (
        <div className="ridership-print-status is-warn" role="note">
          <b>Today, {formatServiceDate(today)}: {plural(morning.total, "sheet")} changed after printing</b> for {label}.{" "}
          {morning.changed.length > 0 && <>The Dispatch Log changed {morning.changed.map((b) => `block ${b}`).join(", ")}. </>}
          {morning.added.length > 0 && <>{morning.added.map((b) => `Block ${b}`).join(", ")} {morning.added.length === 1 ? "is" : "are"} new since printing. </>}
          {morning.dropped.length > 0 && <>Take back the sheet for {morning.dropped.map((b) => `block ${b}`).join(", ")}: no longer running today. </>}
          {morningBlocks.length > 0 && (
            <button type="button" className="ridership-link" disabled={printing} onClick={() => void print(morningBlocks, today)}>
              Reprint today's {plural(morningBlocks.length, "sheet")}
            </button>
          )}
        </div>
      )}
      <div className="ridership-toolbar">
        <label className="ridership-range">
          <span className="ridership-eyebrow">Service date</span>
          <input type="date" value={day} onChange={(e) => { if (e.target.value) { setDay(e.target.value); setMessage(null); setProblem(null); } }} />
        </label>
        <label className="ridership-range">
          <span className="ridership-eyebrow">Garage</span>
          <select value={garage === undefined ? "" : garageValue(garage)} disabled={!data || data.garages.length === 0}
            onChange={(e) => chooseGarage(e.target.value)}>
            {(data?.garages ?? []).map((g) => <option key={garageValue(g)} value={garageValue(g)}>{garageName(g)}</option>)}
          </select>
        </label>
        <label className="ridership-check">
          <input type="checkbox" checked={blankBacks} onChange={(e) => { setBlankBacks(e.target.checked); remember(BACKS_KEY, String(e.target.checked)); }} />
          Blank back on each page (for double-sided printers)
        </label>
        <button type="button" className="ridership-primary" disabled={printing || sheets.length === 0} onClick={() => void print()}>
          {printing ? "Making the PDF…" : `Print ${plural(sheets.length, "sheet")}${label ? ` · ${label}` : ""}`}
        </button>
      </div>
      {day === centralDay(1) && <p className="ridership-dim">Tomorrow, {formatServiceDate(date)}. Any other date is a reprint.</p>}

      {data && unassigned && garage !== null && (
        <div className="ridership-print-status is-warn" role="note">
          <b>{unassigned.length === 1 ? "1 block has no garage" : `${unassigned.length} blocks have no garage`}</b> on {formatServiceDate(date)}, so {unassigned.length === 1 ? "it is" : "they are"} not in any garage's stack:{" "}
          {listBlocks(unassigned)}. Print {unassigned.length === 1 ? "it" : "them"} from{" "}
          <button type="button" className="ridership-link" onClick={() => chooseGarage(garageValue(null))}>Unassigned</button>
          , and ask Planning to set the garage in Administration › Ridership setup.
        </div>
      )}
      {data && garage === null && sheets.length > 0 && (
        <p className="ridership-dim">These blocks have no garage, so no garage's stack includes them. Print them here and hand them to the right desk. Planning sets the garage in Administration › Ridership setup.</p>
      )}

      {status.state === "loading" && <p className="ridership-dim">Loading the print list.</p>}
      {status.state === "error" && <p className="ridership-problems" role="alert">{status.message}</p>}

      {data && data.garages.length === 0 && (
        <p className="ridership-dim">The Dispatch Log has no blocks on {formatServiceDate(date)} yet. Each service date's trips arrive at 3:30 AM the day before (4:30 AM during daylight saving time).</p>
      )}

      {data && sheets.length > 0 && (
        <div className={`ridership-print-status is-${pending.length === 0 ? "ok" : data.last_print ? "warn" : "todo"}`}>
          {!data.last_print && pending.length === sheets.length && (
            <><b>Not printed yet</b> for {label}, {formatServiceDate(date)}. Sheets come off in pull-out order, one block per page.</>
          )}
          {pending.length === 0 && (
            <><b>Printed</b>{data.last_print && <> {printedTime(data.last_print.printed_at)} by {data.last_print.printed_by}</>} · {plural(sheets.length, "sheet")} · nothing has changed since.</>
          )}
          {pending.length > 0 && (data.last_print || pending.length < sheets.length) && (
            <>
              <b>{stale.length > 0 ? "The Dispatch Log has changed since printing" : "Not every sheet is printed"}</b> for{" "}
              {pending.map((b) => `block ${b}`).join(", ")}.{" "}
              <button type="button" className="ridership-link" disabled={printing} onClick={() => void print(pending)}>
                Reprint just {pending.length === 1 ? "that sheet" : `those ${pending.length} sheets`}
              </button>
            </>
          )}
        </div>
      )}

      {dropped.length > 0 && (
        <p className="ridership-problems" role="alert">
          <b>{dropped.length === 1 ? `Block ${dropped[0].block} no longer runs` : `Blocks ${dropped.map((d) => d.block).join(", ")} no longer run`}</b>{" "}
          on {formatServiceDate(date)}, but {dropped.length === 1 ? "its sheet was" : "their sheets were"} printed. Take {dropped.length === 1 ? "it" : "them"} back from the desk.
        </p>
      )}

      {sheets.length > 0 && (
        <div className="ridership-scroll"><table className="ridership-list">
          <thead><tr><th>Order</th><th>Block</th><th>First trip</th><th>Trips</th><th>Pages</th><th>Print</th><th>Last printed</th><th /></tr></thead>
          <tbody>
            {sheets.map((s) => (
              <tr key={s.block} className={s.state === "changed" ? "is-changed" : undefined}>
                <td>{s.order}</td>
                <td className="mono">{s.block}</td>
                <td>{clock(s.first_start_seconds)}</td>
                <td>{s.trips}</td>
                <td>{s.pages}</td>
                <td><span className={`ridership-pill is-${PRINT_STATE_TONE[s.state]}`}>{PRINT_STATE_LABEL[s.state]}</span></td>
                <td className="ridership-dim">{s.printed_at ? `${printedTime(s.printed_at)} · ${s.printed_by}` : "-"}</td>
                <td>
                  <button type="button" className="ridership-link" disabled={printing} aria-label={`Reprint block ${s.block}`} onClick={() => void print([s.block])}>
                    {s.state === "not_printed" ? "Print" : "Reprint"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}

      {message && <p className="ridership-toast" role="status">{message}</p>}
      {problem && <p className="ridership-problems" role="alert">{problem}</p>}
    </div>
  );
}
