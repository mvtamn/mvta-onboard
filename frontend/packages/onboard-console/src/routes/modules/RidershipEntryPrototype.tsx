// PROTOTYPE ONLY — throwaway. Three layouts for the OCC ridership entry workspace
// (plans/ridership-counting-spec.md, Dec 1 increment), switchable on
// /occ?prototype=ridership&variant=sheet|worklist|datasheet. In-memory fixtures,
// no API, no persistence. Operator names are fictional.
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import "./ridershipEntryPrototype.css";

// ---------------------------------------------------------------- fixtures

type Garage = "Burnsville" | "Eagan" | null;
type TripStatus = "ran" | "unknown" | "missed_confirmed" | "canceled";

interface Trip {
  tripId: string;
  route: string;
  dir: "N" | "S" | "E" | "W";
  start: string;
  end: string;
  status: TripStatus;
  median4wk: number | null;
}

interface Block {
  block: string;
  serviceDate: string;
  trips: Trip[];
  avail: { operator: string; operatorId: string; bus: string } | null;
}

const SERVICE_DATES = ["2026-10-28", "2026-10-29"] as const;
const TODAY = "2026-10-30";

function trip(tripId: string, route: string, dir: Trip["dir"], start: string, end: string, median4wk: number | null, status: TripStatus = "ran"): Trip {
  return { tripId, route, dir, start, end, status, median4wk };
}

function blocksFor(serviceDate: string): Block[] {
  return [
    {
      block: "001", serviceDate,
      avail: { operator: "Dana Whitfield", operatorId: "9012", bus: "4421" },
      trips: [
        trip("1436205", "495", "E", "03:20", "04:40", 15),
        trip("1436206", "495", "W", "04:55", "06:10", 22),
        trip("1436207", "495", "E", "06:25", "07:45", 31),
        trip("1436208", "495", "W", "08:00", "09:15", 18),
      ],
    },
    {
      block: "024", serviceDate,
      avail: { operator: "Marcus Lindqvist", operatorId: "9047", bus: "4388" },
      trips: [
        trip("1436310", "436", "S", "05:42", "06:32", 11),
        trip("1436311", "436", "N", "06:45", "07:40", 14),
        trip("1436312", "436", "S", "07:55", "08:45", 9, serviceDate === "2026-10-29" ? "unknown" : "ran"),
        trip("1436313", "436", "N", "09:00", "09:50", 7),
      ],
    },
    {
      block: "105", serviceDate,
      avail: { operator: "Priya Raman", operatorId: "9103", bus: "4502" },
      trips: [
        trip("1436420", "460", "N", "05:10", "05:58", 38),
        trip("1436421", "460", "S", "06:15", "07:05", 4),
        trip("1436422", "460", "N", "07:20", "08:10", 41, serviceDate === "2026-10-29" ? "missed_confirmed" : "ran"),
        trip("1436423", "460", "S", "15:30", "16:20", 6),
        trip("1436424", "460", "N", "16:35", "17:25", 35),
      ],
    },
    {
      block: "212", serviceDate,
      avail: null,
      trips: [
        trip("1436530", "442", "E", "06:05", "06:50", 12),
        trip("1436531", "442", "W", "07:05", "07:55", 16),
        trip("1436532", "444", "E", "08:10", "08:55", 8),
      ],
    },
    {
      block: "329", serviceDate,
      avail: { operator: "Tomas Okafor", operatorId: "9221", bus: "4513" },
      trips: [
        trip("1436640", "446", "N", "14:26", "15:11", 6),
        trip("1436641", "446", "S", "15:40", "16:24", 5),
        trip("1436642", "446", "N", "16:55", "17:22", 8),
      ],
    },
    {
      block: "418", serviceDate,
      avail: { operator: "Grace Halvorsen", operatorId: "9308", bus: "4610" },
      trips: [
        trip("1436750", "477", "N", "05:35", "06:30", 44),
        trip("1436751", "477", "S", "16:05", "17:00", 47),
        trip("1436752", "477", "N", "17:20", "18:10", 9, "canceled"),
      ],
    },
    {
      block: "501", serviceDate,
      avail: { operator: "Leon Abernathy", operatorId: "9415", bus: "4702" },
      trips: [
        trip("1436860", "420", "E", "09:10", "09:40", 5),
        trip("1436861", "420", "W", "09:50", "10:20", 6),
        trip("1436862", "420", "E", "10:30", "11:00", 4),
        trip("1436863", "420", "W", "11:10", "11:40", 7),
      ],
    },
  ];
}

const INITIAL_GARAGES: Record<string, Garage> = {
  "001": "Burnsville", "024": "Burnsville", "105": "Eagan", "212": null, "329": "Eagan", "418": "Eagan", "501": "Burnsville",
};

// ---------------------------------------------------------------- state model

interface SheetEntry {
  counts: Record<string, string>; // tripId -> typed value
  operator: string;
  operatorId: string;
  bus: string;
  operatorOverridden: boolean;
  reconstructed: boolean;
  added: { id: string; route: string; dir: string; start: string; reason: string; count: string }[];
  enteredAt: string | null; // ISO-ish date the sheet was saved
}

type Entries = Record<string, SheetEntry>; // key `${date}|${block}`

const key = (date: string, block: string) => `${date}|${block}`;

function emptyEntry(b: Block): SheetEntry {
  return {
    counts: {},
    operator: b.avail?.operator ?? "",
    operatorId: b.avail?.operatorId ?? "",
    bus: b.avail?.bus ?? "",
    operatorOverridden: false,
    reconstructed: false,
    added: [],
    enteredAt: null,
  };
}

// Seed: 10-28 mostly done (one sheet missing → late), 10-29 partly done.
function seedEntries(): Entries {
  const out: Entries = {};
  for (const date of SERVICE_DATES) {
    for (const b of blocksFor(date)) {
      const e = emptyEntry(b);
      const done = date === "2026-10-28" ? b.block !== "212" : ["001", "329"].includes(b.block);
      if (done) {
        for (const t of b.trips) if (needsCount(t)) e.counts[t.tripId] = String(t.median4wk ?? 0);
        e.enteredAt = date === "2026-10-28" ? "2026-10-29" : "2026-10-30";
        if (b.block === "329" && date === "2026-10-29") e.counts["1436640"] = "7";
      }
      out[key(date, b.block)] = e;
    }
  }
  return out;
}

const needsCount = (t: Trip) => t.status === "ran" || t.status === "unknown";

// Deadline: end of the calendar day after the service date.
function deadlineFor(date: string) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

type SheetState = "entered" | "partial" | "missing" | "late" | "entered_late";

function sheetState(b: Block, e: SheetEntry): SheetState {
  const required = b.trips.filter(needsCount);
  const have = required.filter((t) => (e.counts[t.tripId] ?? "") !== "").length;
  const due = deadlineFor(b.serviceDate);
  if (e.enteredAt && have === required.length) return e.enteredAt > due ? "entered_late" : "entered";
  if (TODAY > due) return "late";
  return have === 0 ? "missing" : "partial";
}

function outlier(t: Trip, value: string): string | null {
  if (value === "" || t.median4wk === null) return null;
  const n = Number(value);
  if (n > 3 * t.median4wk && n - t.median4wk >= 10) return `High vs 4-wk median ${t.median4wk}`;
  if (n === 0 && t.median4wk >= 5) return `Zero vs 4-wk median ${t.median4wk}`;
  return null;
}

const STATE_LABEL: Record<SheetState, string> = {
  entered: "Entered", partial: "In progress", missing: "Not entered", late: "Late", entered_late: "Entered late",
};
const STATE_PILL: Record<SheetState, string> = {
  entered: "rp-pill-ok", partial: "rp-pill-warn", missing: "rp-pill-muted", late: "rp-pill-bad", entered_late: "rp-pill-warn",
};
const TRIP_STATUS_LABEL: Record<TripStatus, string> = {
  ran: "Ran", unknown: "Feed unsure", missed_confirmed: "Missed (confirmed)", canceled: "Canceled",
};

// ---------------------------------------------------------------- shell

const VARIANTS = [
  { key: "combined", group: "OCC entry — chosen", tag: "★", label: "Worklist → sheet", desc: "Decided 2026-10-30: B's worklist opens A's form; the keyboard runs through the day." },
  { key: "sheet", group: "OCC entry — options considered", tag: "A", label: "Sheet", desc: "Pick a block; the form mirrors the paper sheet. Closest to Access today." },
  { key: "worklist", group: "OCC entry — options considered", tag: "B", label: "Worklist", desc: "Starts from what is missing by garage; enter sheets inline." },
  { key: "datasheet", group: "OCC entry — options considered", tag: "C", label: "Datasheet", desc: "One keyboard grid for the whole day; fastest for a stack of sheets." },
  { key: "mobile", group: "Operator app (future)", tag: "D", label: "Operator mobile", desc: "Operators count on an MVTA device instead of paper." },
  { key: "print", group: "Supporting screens", tag: "", label: "Print Count Sheets", desc: "The redesigned sheet, printed overnight." },
  { key: "garages", group: "Supporting screens", tag: "", label: "Block → garage list", desc: "Planning keeps this each service change." },
  { key: "apc", group: "Supporting screens", tag: "", label: "Compare with Avail APC", desc: "Manual counts vs Avail APC, shaped on the real stop-level feed (future)." },
] as const;
type Variant = (typeof VARIANTS)[number]["key"];
const isVariant = (v: string | null): v is Variant => VARIANTS.some((x) => x.key === v);

export function RidershipEntryPrototype() {
  const [searchParams, setSearchParams] = useSearchParams();
  const vp = searchParams.get("variant");
  const variant: Variant = isVariant(vp) ? vp : "combined";
  const [entries, setEntries] = useState<Entries>(seedEntries);
  const [garages, setGarages] = useState<Record<string, Garage>>(INITIAL_GARAGES);

  function setVariant(next: Variant) {
    const p = new URLSearchParams(searchParams);
    p.set("prototype", "ridership");
    p.set("variant", next);
    setSearchParams(p);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const el = event.target as HTMLElement | null;
      if (el?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const i = VARIANTS.findIndex((x) => x.key === variant);
      const off = event.key === "ArrowLeft" ? -1 : 1;
      setVariant(VARIANTS[(i + off + VARIANTS.length) % VARIANTS.length].key);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchParams, variant]);

  const update = (date: string, block: string, fn: (e: SheetEntry) => SheetEntry) =>
    setEntries((all) => ({ ...all, [key(date, block)]: fn(all[key(date, block)]) }));

  const props: VariantProps = { entries, update, garages };
  const groups = [...new Set(VARIANTS.map((v) => v.group))];
  const current = VARIANTS.find((v) => v.key === variant)!;

  return (
    <div className="rp">
      <div className="rp-banner">PROTOTYPE · made-up data · nothing is saved · today is {TODAY}</div>
      <nav className="rp-options" aria-label="Prototype options">
        {groups.map((g) => (
          <div key={g} className="rp-options-group">
            <div className="rp-eyebrow">{g}</div>
            <div className="rp-options-row">
              {VARIANTS.filter((v) => v.group === g).map((v) => (
                <button key={v.key} className={`rp-option ${v.key === variant ? "active" : ""}`} onClick={() => setVariant(v.key)} aria-pressed={v.key === variant}>
                  <span className="rp-option-title">{v.tag && <span className="rp-option-tag">{v.tag}</span>}{v.label}</span>
                  <span className="rp-option-desc">{v.desc}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <h2 className="rp-current">{current.tag && `${current.tag} · `}{current.label}</h2>
      {variant === "combined" && <CombinedVariant {...props} />}
      {variant === "sheet" && <SheetVariant {...props} />}
      {variant === "worklist" && <WorklistVariant {...props} />}
      {variant === "datasheet" && <DatasheetVariant {...props} />}
      {variant === "mobile" && <OperatorMobile />}
      {variant === "print" && <PrintSheets garages={garages} />}
      {variant === "garages" && <GarageList garages={garages} setGarages={setGarages} />}
      {variant === "apc" && <ApcComparison />}
      <StatePanel entries={entries} garages={garages} />
      <Switcher variant={variant} setVariant={setVariant} />
    </div>
  );
}

interface VariantProps {
  entries: Entries;
  update: (date: string, block: string, fn: (e: SheetEntry) => SheetEntry) => void;
  garages: Record<string, Garage>;
}

// ---------------------------------------------------------------- shared entry form

function SheetForm({ b, e, update, garage, compact = false, onSave, nav }: { b: Block; e: SheetEntry; update: VariantProps["update"]; garage: Garage; compact?: boolean; onSave?: () => void; nav?: React.ReactNode }) {
  const set = (fn: (e: SheetEntry) => SheetEntry) => update(b.serviceDate, b.block, fn);
  const state = sheetState(b, e);
  const [adding, setAdding] = useState(false);
  const [blankMsg, setBlankMsg] = useState<string | null>(null);
  const blanks = b.trips.filter((t) => needsCount(t) && (e.counts[t.tripId] ?? "") === "");
  function save(root: HTMLElement | null) {
    if (blanks.length) {
      setBlankMsg(`${blanks.length} trip${blanks.length === 1 ? "" : "s"} still blank — every trip that ran needs a count.`);
      const el = root?.querySelector<HTMLInputElement>(`[data-trip-input][data-trip="${blanks[0].tripId}"]`);
      el?.focus();
      return;
    }
    setBlankMsg(null);
    set((x) => ({ ...x, enteredAt: TODAY }));
    onSave?.();
  }
  const [draft, setDraft] = useState({ route: "", dir: "N", start: "", reason: "Tripper", count: "" });

  return (
    <div className={`rp-form ${compact ? "compact" : ""}`}
      onKeyDown={(ev) => { if (onSave && ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); save(ev.currentTarget); } }}>
      {nav}
      <div className="rp-form-head">
        <div>
          <div className="rp-eyebrow">Count Sheet · {b.serviceDate} · {garage ?? "Unassigned garage"}</div>
          <h3>Block {b.block}</h3>
        </div>
        <span className={`rp-pill ${STATE_PILL[state]}`}>{STATE_LABEL[state]}</span>
      </div>

      <div className="rp-who">
        <label>Operator<input autoFocus={!compact && b.avail === null} value={e.operator} onChange={(ev) => set((x) => ({ ...x, operator: ev.target.value, operatorOverridden: ev.target.value !== (b.avail?.operator ?? "") }))} /></label>
        <label>Operator ID<input value={e.operatorId} onChange={(ev) => set((x) => ({ ...x, operatorId: ev.target.value, operatorOverridden: true }))} /></label>
        <label>Bus<input value={e.bus} onChange={(ev) => set((x) => ({ ...x, bus: ev.target.value, operatorOverridden: true }))} /></label>
        <div className="rp-source">
          {b.avail === null ? <span className="rp-pill rp-pill-warn">No Avail login — type from sheet</span>
            : e.operatorOverridden ? <span className="rp-pill rp-pill-accent">Changed from Avail ({b.avail.operator}, bus {b.avail.bus})</span>
            : <span className="rp-pill rp-pill-muted">From Avail login</span>}
        </div>
      </div>

      <table className="rp-trips">
        <thead><tr><th>Trip</th><th>Route</th><th>Dir</th><th>Time</th><th>Dispatch Log</th><th className="num">Boardings</th><th /></tr></thead>
        <tbody>
          {b.trips.map((t, i) => {
            const v = e.counts[t.tripId] ?? "";
            const flag = outlier(t, v);
            return (
              <tr key={t.tripId} className={needsCount(t) ? "" : "rp-excused"}>
                <td className="mono">{t.tripId}</td><td>{t.route}</td><td>{t.dir}</td><td className="mono">{t.start}–{t.end}</td>
                <td>{TRIP_STATUS_LABEL[t.status]}</td>
                <td className="num">
                  {needsCount(t)
                    ? <input data-trip-input data-trip={t.tripId} aria-label={`Boardings trip ${t.tripId}`} inputMode="numeric" value={v} autoFocus={!compact && i === 0 && b.avail !== null}
                        onChange={(ev) => set((x) => ({ ...x, counts: { ...x.counts, [t.tripId]: ev.target.value.replace(/\D/g, "") } }))}
                        onKeyDown={(ev) => { if (ev.key === "Enter" && !ev.metaKey && !ev.ctrlKey) { ev.preventDefault(); focusNext(ev.currentTarget); } }} />
                    : <span className="rp-dim">not required</span>}
                </td>
                <td>{flag && <span className="rp-pill rp-pill-warn" title="In January this becomes a flag the contractor answers">{flag}</span>}</td>
              </tr>
            );
          })}
          {e.added.map((a) => (
            <tr key={a.id} className="rp-added">
              <td className="mono">added</td><td>{a.route}</td><td>{a.dir}</td><td className="mono">{a.start}</td><td>Unscheduled · {a.reason}</td>
              <td className="num">{a.count}</td><td><button className="rp-link" onClick={() => set((x) => ({ ...x, added: x.added.filter((y) => y.id !== a.id) }))}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      {adding ? (
        <div className="rp-add">
          <input placeholder="Route" value={draft.route} onChange={(ev) => setDraft({ ...draft, route: ev.target.value })} />
          <select value={draft.dir} onChange={(ev) => setDraft({ ...draft, dir: ev.target.value })}>{["N", "S", "E", "W"].map((d) => <option key={d}>{d}</option>)}</select>
          <input placeholder="Start HH:MM" value={draft.start} onChange={(ev) => setDraft({ ...draft, start: ev.target.value })} />
          <select value={draft.reason} onChange={(ev) => setDraft({ ...draft, reason: ev.target.value })}>{["Tripper", "Extra service", "OCC-directed", "Other"].map((r) => <option key={r}>{r}</option>)}</select>
          <input placeholder="Boardings" value={draft.count} onChange={(ev) => setDraft({ ...draft, count: ev.target.value.replace(/\D/g, "") })} />
          <button onClick={() => { set((x) => ({ ...x, added: [...x.added, { ...draft, id: `${Date.now()}` }] })); setAdding(false); setDraft({ route: "", dir: "N", start: "", reason: "Tripper", count: "" }); }}>Add</button>
          <button className="rp-link" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      ) : (
        <button className="rp-link" onClick={() => setAdding(true)}>+ Add an unscheduled trip from the sheet</button>
      )}

      <div className="rp-form-foot">
        <label className="rp-check"><input type="checkbox" checked={e.reconstructed} onChange={(ev) => set((x) => ({ ...x, reconstructed: ev.target.checked }))} /> Sheet marked <strong>Reconstructed</strong></label>
        <span className="rp-dim">Due by end of {deadlineFor(b.serviceDate)}</span>
        <button data-save className="rp-primary" onClick={(ev) => save(ev.currentTarget.closest(".rp-form"))}>{onSave ? "Save · next sheet" : "Save sheet"}</button>
      </div>
      {blankMsg && <div className="rp-pill rp-pill-bad rp-blank-msg">{blankMsg}</div>}
    </div>
  );
}

function focusNext(el: HTMLInputElement) {
  const all = Array.from(document.querySelectorAll<HTMLInputElement>("[data-trip-input]"));
  const i = all.indexOf(el);
  if (!all[i + 1]) { document.querySelector<HTMLButtonElement>("[data-save]")?.focus(); return; }
  all[i + 1].focus();
  all[i + 1].select();
}

// ---------------------------------------------------------------- ★ Chosen: worklist → sheet form (PROTOTYPE)

// Decided 2026-10-30 (spec §4): land on B's worklist; a row opens A's form full-width;
// Enter moves down the trips and onto Save; Save (or Ctrl/⌘+Enter) goes straight to the
// next sheet in the queue; Esc returns to the worklist. ↑/↓ + Enter work on the list.
const SHEET_ORDER: SheetState[] = ["late", "missing", "partial", "entered_late", "entered"];

function CombinedVariant({ entries, update, garages }: VariantProps) {
  const [garage, setGarage] = useState<string>("All");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  const all = SERVICE_DATES.flatMap((d) => blocksFor(d).map((b) => ({ b, k: key(d, b.block), s: sheetState(b, entries[key(d, b.block)]) })));
  const isOpenSheet = (s: SheetState) => s !== "entered" && s !== "entered_late";
  const byGarage = ["Burnsville", "Eagan", "Unassigned"].map((g) => {
    const mine = all.filter((r) => (garages[r.b.block] ?? "Unassigned") === g);
    const required = mine.flatMap((r) => r.b.trips.filter(needsCount).map((t) => ({ r, t })));
    const have = required.filter(({ r, t }) => (entries[r.k].counts[t.tripId] ?? "") !== "").length;
    return { g, open: mine.filter((r) => isOpenSheet(r.s)).length, late: mine.filter((r) => r.s === "late").length, pct: required.length ? Math.round((100 * have) / required.length) : 100 };
  });
  const outstanding = all
    .filter((r) => isOpenSheet(r.s) && (garage === "All" || (garages[r.b.block] ?? "Unassigned") === garage))
    .sort((x, y) => SHEET_ORDER.indexOf(x.s) - SHEET_ORDER.indexOf(y.s) || x.b.serviceDate.localeCompare(y.b.serviceDate) || x.b.block.localeCompare(y.b.block));
  const enteredToday = all.filter((r) => entries[r.k].enteredAt === TODAY);

  function open(k: string) {
    // Snapshot the queue so saving a sheet doesn't reshuffle what "next" means.
    const q = outstanding.map((r) => r.k);
    setQueue(q.includes(k) ? q : [k, ...q]);
    setOpenKey(k);
    setToast(null);
  }
  function close() {
    setOpenKey(null);
  }
  function savedGoNext(k: string) {
    const rest = queue.slice(queue.indexOf(k) + 1).filter((x) => x !== k);
    const [d, blk] = k.split("|");
    if (rest.length) {
      const [nd, nb] = rest[0].split("|");
      setToast(`Block ${blk} (${d}) saved — now on block ${nb} (${nd}).`);
      setOpenKey(rest[0]);
    } else {
      setToast(`Block ${blk} (${d}) saved — that was the last sheet in the queue.`);
      setOpenKey(null);
    }
  }

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      const el = ev.target as HTMLElement | null;
      if (openKey) {
        if (ev.key === "Escape") { ev.preventDefault(); close(); }
        return;
      }
      if (el?.matches("input, textarea, select")) return;
      if (ev.key === "ArrowDown") { ev.preventDefault(); setCursor((c) => Math.min(c + 1, outstanding.length - 1)); }
      if (ev.key === "ArrowUp") { ev.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
      if (ev.key === "Enter" && outstanding[cursor] && !el?.matches("button")) { ev.preventDefault(); open(outstanding[cursor].k); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (openKey) {
    const [d, blk] = openKey.split("|");
    const b = blocksFor(d).find((x) => x.block === blk)!;
    const pos = queue.indexOf(openKey);
    const prev = pos > 0 ? queue[pos - 1] : null;
    const next = pos >= 0 && pos < queue.length - 1 ? queue[pos + 1] : null;
    const nav = (
      <div className="rp-x-nav">
        <button className="rp-link" onClick={close}>← Worklist <span className="rp-kbd">Esc</span></button>
        <span className="rp-dim">Sheet {pos + 1} of {queue.length}{garage !== "All" ? ` · ${garage}` : ""}</span>
        <span className="rp-x-step">
          <button className="rp-link" disabled={!prev} onClick={() => prev && setOpenKey(prev)}>‹ Previous</button>
          <button className="rp-link" disabled={!next} onClick={() => next && setOpenKey(next)}>Skip ›</button>
        </span>
      </div>
    );
    return (
      <div className="rp-x">
        {toast && <div className="rp-x-toast" role="status">{toast}</div>}
        <div className="rp-a-paper">
          <SheetForm key={openKey} b={b} e={entries[openKey]} update={update} garage={garages[b.block] ?? null} onSave={() => savedGoNext(openKey)} nav={nav} />
        </div>
        <p className="rp-dim rp-x-keys"><span className="rp-kbd">Enter</span> next trip, then Save · <span className="rp-kbd">Ctrl/⌘ Enter</span> save from anywhere · <span className="rp-kbd">Esc</span> back to the worklist · operator/bus are skipped unless you click them</p>
      </div>
    );
  }

  return (
    <div className="rp-x">
      {toast && <div className="rp-x-toast" role="status">{toast}</div>}
      <div className="rp-b-garages rp-x-garages">
        {byGarage.map((g) => (
          <button key={g.g} className={`rp-b-garage ${g.late ? "bad" : ""} ${garage === g.g ? "active" : ""}`} onClick={() => { setGarage(garage === g.g ? "All" : g.g); setCursor(0); }} aria-pressed={garage === g.g}>
            <div className="rp-eyebrow">{g.g}</div>
            <div className="rp-big">{g.pct}%</div>
            <div className="rp-dim">trips counted · {g.open} sheets open{g.late ? ` · ${g.late} late` : ""}</div>
          </button>
        ))}
      </div>
      <div className="rp-apc-head">
        <h3 className="rp-b-title">Sheets to enter ({outstanding.length}){garage !== "All" && <> · {garage} <button className="rp-link" onClick={() => setGarage("All")}>show all</button></>}</h3>
        {outstanding.length > 0 && <button className="rp-primary" onClick={() => open(outstanding[0].k)}>Start entering — {outstanding.length} sheet{outstanding.length === 1 ? "" : "s"}</button>}
      </div>
      <table className="rp-b-list">
        <thead><tr><th>Status</th><th>Service date</th><th>Block</th><th>Garage</th><th>Routes</th><th>Operator · bus</th><th>Trips</th><th>Due</th></tr></thead>
        <tbody>
          {outstanding.map(({ b, k, s }, i) => {
            const e = entries[k];
            const need = b.trips.filter(needsCount);
            const missing = need.filter((t) => (e.counts[t.tripId] ?? "") === "").length;
            return (
              <tr key={k} className={i === cursor ? "open" : ""} onClick={() => open(k)} onMouseEnter={() => setCursor(i)}>
                <td><span className={`rp-pill ${STATE_PILL[s]}`}>{STATE_LABEL[s]}</span></td>
                <td>{b.serviceDate}</td><td className="mono">{b.block}</td>
                <td>{garages[b.block] ?? <span className="rp-pill rp-pill-warn">Unassigned</span>}</td>
                <td>{[...new Set(b.trips.map((t) => t.route))].join(", ")}</td>
                <td>{b.avail ? <span className="mono">{b.avail.operatorId} · {b.avail.bus}</span> : <span className="rp-dim">no Avail login</span>}</td>
                <td>{missing === need.length ? `${need.length}` : `${missing} of ${need.length} blank`}</td>
                <td>{deadlineFor(b.serviceDate)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {outstanding.length === 0 && <p className="rp-dim">Every sheet{garage !== "All" ? ` for ${garage}` : ""} is entered.</p>}
      <p className="rp-dim rp-x-keys"><span className="rp-kbd">↑</span> <span className="rp-kbd">↓</span> choose · <span className="rp-kbd">Enter</span> open · late sheets first, then oldest service date · click a garage to work only its sheets</p>
      {enteredToday.length > 0 && (
        <details className="rp-x-done">
          <summary>Entered today ({enteredToday.length})</summary>
          <ul>{enteredToday.map((r) => <li key={r.k}><button className="rp-link" onClick={() => open(r.k)}>Block {r.b.block} · {r.b.serviceDate}</button> <span className={`rp-pill ${STATE_PILL[r.s]}`}>{STATE_LABEL[r.s]}</span></li>)}</ul>
        </details>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- A: Sheet

function SheetVariant({ entries, update, garages }: VariantProps) {
  const [date, setDate] = useState<string>(SERVICE_DATES[1]);
  const [garageFilter, setGarageFilter] = useState<string>("All");
  const [block, setBlock] = useState<string>("024");
  const blocks = blocksFor(date).filter((b) => garageFilter === "All" || (garages[b.block] ?? "Unassigned") === garageFilter);
  const current = blocksFor(date).find((b) => b.block === block) ?? blocks[0];

  return (
    <div className="rp-a">
      <aside className="rp-a-picker">
        <label>Service date<select value={date} onChange={(e) => setDate(e.target.value)}>{SERVICE_DATES.map((d) => <option key={d}>{d}</option>)}</select></label>
        <label>Garage<select value={garageFilter} onChange={(e) => setGarageFilter(e.target.value)}>{["All", "Burnsville", "Eagan", "Unassigned"].map((g) => <option key={g}>{g}</option>)}</select></label>
        <label>Find block<input placeholder="Type or scan block…" onKeyDown={(e) => { if (e.key === "Enter") setBlock(e.currentTarget.value.padStart(3, "0")); }} /></label>
        <ul>
          {blocks.map((b) => {
            const s = sheetState(b, entries[key(date, b.block)]);
            return (
              <li key={b.block}>
                <button className={current?.block === b.block ? "active" : ""} onClick={() => setBlock(b.block)}>
                  <span className="mono">{b.block}</span>
                  <span className={`rp-dot ${STATE_PILL[s]}`} title={STATE_LABEL[s]} />
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
      {current && <div className="rp-a-paper"><SheetForm key={key(date, current.block)} b={current} e={entries[key(date, current.block)]} update={update} garage={garages[current.block] ?? null} /></div>}
    </div>
  );
}

// ---------------------------------------------------------------- B: Worklist

function WorklistVariant({ entries, update, garages }: VariantProps) {
  const [open, setOpen] = useState<string | null>(null);
  const rows = SERVICE_DATES.flatMap((d) => blocksFor(d).map((b) => ({ b, s: sheetState(b, entries[key(d, b.block)]) })));
  const outstanding = rows.filter((r) => r.s !== "entered" && r.s !== "entered_late");
  const byGarage = ["Burnsville", "Eagan", "Unassigned"].map((g) => {
    const mine = rows.filter((r) => (garages[r.b.block] ?? "Unassigned") === g);
    const required = mine.flatMap((r) => r.b.trips.filter(needsCount).map((t) => ({ r, t })));
    const have = required.filter(({ r, t }) => (entries[key(r.b.serviceDate, r.b.block)].counts[t.tripId] ?? "") !== "").length;
    return { g, open: mine.filter((r) => r.s !== "entered" && r.s !== "entered_late").length, late: mine.filter((r) => r.s === "late").length, pct: required.length ? Math.round((100 * have) / required.length) : 100 };
  });
  const order: SheetState[] = ["late", "missing", "partial", "entered_late", "entered"];
  outstanding.sort((x, y) => order.indexOf(x.s) - order.indexOf(y.s) || x.b.serviceDate.localeCompare(y.b.serviceDate));

  return (
    <div className="rp-b">
      <div className="rp-b-garages">
        {byGarage.map((g) => (
          <div key={g.g} className={`rp-b-garage ${g.late ? "bad" : ""}`}>
            <div className="rp-eyebrow">{g.g}</div>
            <div className="rp-big">{g.pct}%</div>
            <div className="rp-dim">trips counted · {g.open} sheets open{g.late ? ` · ${g.late} late` : ""}</div>
          </div>
        ))}
      </div>
      <h3 className="rp-b-title">Sheets to enter ({outstanding.length})</h3>
      <table className="rp-b-list">
        <thead><tr><th>Status</th><th>Service date</th><th>Block</th><th>Garage</th><th>Routes</th><th>Trips needing a count</th><th>Due</th><th /></tr></thead>
        <tbody>
          {outstanding.map(({ b, s }) => {
            const k = key(b.serviceDate, b.block);
            const e = entries[k];
            const need = b.trips.filter(needsCount);
            const missing = need.filter((t) => (e.counts[t.tripId] ?? "") === "").length;
            return [
              <tr key={k} className={open === k ? "open" : ""} onClick={() => setOpen(open === k ? null : k)}>
                <td><span className={`rp-pill ${STATE_PILL[s]}`}>{STATE_LABEL[s]}</span></td>
                <td>{b.serviceDate}</td><td className="mono">{b.block}</td><td>{garages[b.block] ?? <span className="rp-pill rp-pill-warn">Unassigned</span>}</td>
                <td>{[...new Set(b.trips.map((t) => t.route))].join(", ")}</td>
                <td>{missing} of {need.length}</td><td>{deadlineFor(b.serviceDate)}</td>
                <td><button className="rp-link">{open === k ? "Close" : "Enter"}</button></td>
              </tr>,
              open === k && <tr key={`${k}-form`} className="rp-b-drawer"><td colSpan={8}><SheetForm b={b} e={e} update={update} garage={garages[b.block] ?? null} compact /></td></tr>,
            ];
          })}
        </tbody>
      </table>
      {outstanding.length === 0 && <p className="rp-dim">Every sheet is entered.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- C: Datasheet

function DatasheetVariant({ entries, update, garages }: VariantProps) {
  const [date, setDate] = useState<string>(SERVICE_DATES[1]);
  const [garage, setGarage] = useState("All");
  const [onlyOpen, setOnlyOpen] = useState(false);
  const blocks = blocksFor(date).filter((b) => garage === "All" || (garages[b.block] ?? "Unassigned") === garage);

  const totals = useMemo(() => {
    const req = blocks.flatMap((b) => b.trips.filter(needsCount).map((t) => entries[key(date, b.block)].counts[t.tripId] ?? ""));
    return { required: req.length, have: req.filter((v) => v !== "").length };
  }, [blocks, entries, date]);

  return (
    <div className="rp-c">
      <div className="rp-c-bar">
        <label>Service date<select value={date} onChange={(e) => setDate(e.target.value)}>{SERVICE_DATES.map((d) => <option key={d}>{d}</option>)}</select></label>
        <label>Garage<select value={garage} onChange={(e) => setGarage(e.target.value)}>{["All", "Burnsville", "Eagan", "Unassigned"].map((g) => <option key={g}>{g}</option>)}</select></label>
        <label className="rp-check"><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> Only sheets not entered</label>
        <input className="rp-c-jump" placeholder="Scan sheet QR or type block → Enter" onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          const b = e.currentTarget.value.padStart(3, "0");
          const first = document.querySelector<HTMLInputElement>(`[data-block='${b}'] [data-trip-input]`);
          first?.focus();
        }} />
        <span className="rp-c-progress">{totals.have} / {totals.required} trips counted</span>
      </div>
      <table className="rp-c-grid">
        <thead><tr><th>Block</th><th>Trip</th><th>Route</th><th>Dir</th><th>Start</th><th>Dispatch Log</th><th className="num">Boardings</th><th>Check</th><th>Operator · bus</th></tr></thead>
        {blocks.map((b) => {
          const k = key(date, b.block);
          const e = entries[k];
          const s = sheetState(b, e);
          if (onlyOpen && (s === "entered" || s === "entered_late")) return null;
          return (
            <tbody key={k} data-block={b.block}>
              <tr className="rp-c-blockrow">
                <td colSpan={6}><strong className="mono">Block {b.block}</strong> · {garages[b.block] ?? "Unassigned"} · <span className={`rp-pill ${STATE_PILL[s]}`}>{STATE_LABEL[s]}</span>
                  <label className="rp-check rp-inline"><input type="checkbox" checked={e.reconstructed} onChange={(ev) => update(date, b.block, (x) => ({ ...x, reconstructed: ev.target.checked }))} /> Reconstructed</label>
                </td>
                <td colSpan={2}><button className="rp-link" onClick={() => update(date, b.block, (x) => ({ ...x, enteredAt: TODAY }))}>Mark sheet entered</button></td>
                <td>
                  <input className="rp-c-who" value={e.operator} placeholder={b.avail ? "" : "No Avail login"} onChange={(ev) => update(date, b.block, (x) => ({ ...x, operator: ev.target.value, operatorOverridden: true }))} />
                  <input className="rp-c-bus" value={e.bus} onChange={(ev) => update(date, b.block, (x) => ({ ...x, bus: ev.target.value, operatorOverridden: true }))} />
                  {e.operatorOverridden && <span className="rp-pill rp-pill-accent">changed</span>}
                </td>
              </tr>
              {b.trips.map((t) => {
                const v = e.counts[t.tripId] ?? "";
                const flag = outlier(t, v);
                return (
                  <tr key={t.tripId} className={needsCount(t) ? "" : "rp-excused"}>
                    <td /><td className="mono">{t.tripId}</td><td>{t.route}</td><td>{t.dir}</td><td className="mono">{t.start}</td><td>{TRIP_STATUS_LABEL[t.status]}</td>
                    <td className="num">{needsCount(t)
                      ? <input data-trip-input inputMode="numeric" aria-label={`Boardings trip ${t.tripId}`} value={v}
                          onChange={(ev) => update(date, b.block, (x) => ({ ...x, counts: { ...x.counts, [t.tripId]: ev.target.value.replace(/\D/g, "") } }))}
                          onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === "ArrowDown") { ev.preventDefault(); focusNext(ev.currentTarget); } }} />
                      : <span className="rp-dim">—</span>}</td>
                    <td>{flag && <span className="rp-pill rp-pill-warn">{flag}</span>}</td><td />
                  </tr>
                );
              })}
            </tbody>
          );
        })}
      </table>
      <p className="rp-dim">Unscheduled trips: in this layout they'd be added from a block row's menu (not mocked).</p>
    </div>
  );
}

// ---------------------------------------------------------------- Print + garage list

function PrintSheets({ garages }: { garages: Record<string, Garage> }) {
  const date = "2026-10-31";
  const blocks = blocksFor(date);
  return (
    <div className="rp-print">
      <div className="rp-print-bar">
        <span>Next service date <strong>{date}</strong> · {blocks.length} sheets · printed overnight after the Dispatch Log is built</span>
        <button className="rp-primary" onClick={() => window.print()}>Print</button>
      </div>
      <div className="rp-print-pages">
        {blocks.slice(0, 3).map((b) => (
          <div key={b.block} className="rp-sheet">
            <div className="rp-sheet-head">
              <div><div className="rp-sheet-title">PASSENGER COUNT SHEET</div><div className="rp-dim">{garages[b.block] ?? "Unassigned"} garage</div></div>
              <div className="rp-qr" aria-label="QR code">QR<br /><span className="mono">{date.replace(/-/g, "")}-{b.block}</span></div>
            </div>
            <div className="rp-sheet-fields">
              <div>Service date <strong>{date}</strong></div><div>Block <strong>{b.block}</strong></div>
              <div>Operator ________________________</div><div>ID ________</div><div>Bus # ________</div>
            </div>
            <table>
              <thead><tr><th>Trip</th><th>Route</th><th>Dir</th><th>Time</th><th>Tally</th><th>Total boardings</th></tr></thead>
              <tbody>
                {b.trips.map((t) => <tr key={t.tripId}><td className="mono">{t.tripId}</td><td>{t.route}</td><td>{t.dir}</td><td className="mono">{t.start}–{t.end}</td><td /><td /></tr>)}
                <tr className="rp-sheet-section"><td colSpan={6}>Unscheduled trips (route · direction · start)</td></tr>
                <tr><td colSpan={4} /><td /><td /></tr><tr><td colSpan={4} /><td /><td /></tr>
              </tbody>
            </table>
            <div className="rp-sheet-foot">☐ Reconstructed (sheet lost or damaged) · Write "Did not operate" in Total for a trip that did not run</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GarageList({ garages, setGarages }: { garages: Record<string, Garage>; setGarages: (g: Record<string, Garage>) => void }) {
  const unassigned = Object.values(garages).filter((g) => g === null).length;
  return (
    <div className="rp-garages">
      <p>Service change <strong>2026-08-10</strong> · Planning maintains this list each service change. {unassigned > 0 && <span className="rp-pill rp-pill-warn">{unassigned} block unassigned</span>}</p>
      <table>
        <thead><tr><th>Block</th><th>Routes</th><th>Garage</th></tr></thead>
        <tbody>
          {blocksFor("2026-10-29").map((b) => (
            <tr key={b.block}>
              <td className="mono">{b.block}</td><td>{[...new Set(b.trips.map((t) => t.route))].join(", ")}</td>
              <td>
                <select value={garages[b.block] ?? ""} onChange={(e) => setGarages({ ...garages, [b.block]: (e.target.value || null) as Garage })}>
                  <option value="">Unassigned</option><option>Burnsville</option><option>Eagan</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="rp-dim">On a new service change, blocks would copy forward by number and Planning confirms (not mocked).</p>
    </div>
  );
}

// ---------------------------------------------------------------- Operator mobile (future)

// The operator's block comes from their Avail login, so there is nothing to
// scan. Counting buttons lock while AVL says the bus is moving: OPR-038 bans
// device use while operating, so this is an MVTA-issued device, used at stops.
function OperatorMobile() {
  const b = blocksFor("2026-10-29").find((x) => x.block === "329")!;
  const [screen, setScreen] = useState<"start" | "count" | "review" | "done">("start");
  const [moving, setMoving] = useState(false);
  const [active, setActive] = useState(0);
  const [tally, setTally] = useState<Record<string, number>>({});
  const [dno, setDno] = useState<Record<string, boolean>>({});
  const t = b.trips[active];
  const bump = (d: number) => setTally((x) => ({ ...x, [t.tripId]: Math.max(0, (x[t.tripId] ?? 0) + d) }));

  return (
    <div className="rp-mob-wrap">
      <div className="rp-phone">
        <div className="rp-phone-status"><span>9:41</span><span>MVTA device</span></div>
        {screen === "start" && (
          <div className="rp-mob">
            <div className="rp-eyebrow">Passenger count</div>
            <h3>Good afternoon, T. Okafor</h3>
            <div className="rp-mob-card">
              <div className="rp-dim">From your Avail login</div>
              <div className="rp-mob-big">Block {b.block}</div>
              <div>Bus {b.avail?.bus} · {b.trips.length} trips · Route 446</div>
            </div>
            <button className="rp-mob-primary" onClick={() => setScreen("count")}>Start counting</button>
            <button className="rp-link">Not your block? Scan the sheet QR</button>
          </div>
        )}
        {screen === "count" && (
          <div className="rp-mob">
            <div className="rp-mob-trips">
              {b.trips.map((x, i) => (
                <button key={x.tripId} className={i === active ? "active" : ""} onClick={() => setActive(i)}>
                  <span className="mono">{x.start}</span><span>{x.route} {x.dir}</span><strong>{dno[x.tripId] ? "DNO" : tally[x.tripId] ?? 0}</strong>
                </button>
              ))}
            </div>
            {moving ? (
              <div className="rp-mob-locked">Bus moving — counting locked<br /><span className="rp-dim">Count at the stop.</span></div>
            ) : (
              <div className="rp-mob-counter">
                <div className="rp-dim">{t.route} {t.dir} · {t.start}–{t.end}</div>
                <div className="rp-mob-count">{tally[t.tripId] ?? 0}</div>
                <div className="rp-mob-buttons">
                  <button onClick={() => bump(-1)} aria-label="Minus one">−</button>
                  <button className="plus" onClick={() => bump(1)} aria-label="Plus one">+1</button>
                </div>
                <label className="rp-check"><input type="checkbox" checked={!!dno[t.tripId]} onChange={(e) => setDno({ ...dno, [t.tripId]: e.target.checked })} /> This trip did not operate</label>
              </div>
            )}
            <div className="rp-mob-foot">
              <button className="rp-link" disabled={active === 0} onClick={() => setActive(active - 1)}>‹ Prev trip</button>
              {active < b.trips.length - 1
                ? <button className="rp-link" onClick={() => setActive(active + 1)}>Next trip ›</button>
                : <button className="rp-mob-primary small" onClick={() => setScreen("review")}>Finish block</button>}
            </div>
          </div>
        )}
        {screen === "review" && (
          <div className="rp-mob">
            <h3>Check and submit</h3>
            <table className="rp-trips">
              <tbody>{b.trips.map((x) => <tr key={x.tripId}><td className="mono">{x.start}</td><td>{x.route} {x.dir}</td><td className="num"><strong>{dno[x.tripId] ? "Did not operate" : tally[x.tripId] ?? 0}</strong></td></tr>)}</tbody>
            </table>
            <button className="rp-link">+ Add an unscheduled trip</button>
            <button className="rp-mob-primary" onClick={() => setScreen("done")}>Submit at pull-in</button>
            <button className="rp-link" onClick={() => setScreen("count")}>Back</button>
          </div>
        )}
        {screen === "done" && (
          <div className="rp-mob">
            <div className="rp-mob-card ok"><div className="rp-mob-big">Submitted</div><div>Block {b.block} · {Object.values(tally).reduce((s, n) => s + n, 0)} boardings</div><div className="rp-dim">On time — no paper sheet needed.</div></div>
            <button className="rp-link" onClick={() => { setScreen("start"); setTally({}); setDno({}); setActive(0); }}>Start over (prototype)</button>
          </div>
        )}
      </div>
      <aside className="rp-mob-notes">
        <h3>How this would work</h3>
        <ul>
          <li><strong>No scanning.</strong> The block comes from the operator's Avail login, the same source the OCC screen pre-fills from.</li>
          <li><strong>Counts at stops only.</strong> Counting locks while AVL says the bus is moving.
            <label className="rp-check"><input type="checkbox" checked={moving} onChange={(e) => setMoving(e.target.checked)} /> Simulate bus moving</label></li>
          <li><strong>Submitting replaces the sheet.</strong> The submission time is the "timely" proof, and OCC entry is no longer needed for that block.</li>
          <li><strong>Same rules as OCC entry:</strong> did-not-operate, unscheduled trips, deadline, outlier flags.</li>
        </ul>
        <h3>Decisions this needs</h3>
        <ul>
          <li><strong>Device.</strong> OPR-038 bans personal devices on duty, so this needs an MVTA-issued phone or tablet, or the MDT. Which?</li>
          <li><strong>Mounting.</strong> Handheld, or mounted at the farebox?</li>
          <li><strong>Buses with APC.</strong> Skip manual counting entirely, or count on both during validation?</li>
          <li><strong>Offline.</strong> Counts must save on the device through dead zones and send later.</li>
        </ul>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------- Avail APC comparison (future)

// PROTOTYPE — rows shaped exactly like Avail360 ApcRidershipBySvcLvlBlockRouteTripTimepoint/v1
// as seen in the 2026-10-28 sample (spec §12): one row per STOP per trip, Trip = scheduled
// start HHMM, Block as an int, one StopName-null row per trip for boardings not placed at a
// stop, pseudo-routes mixed in, and no vehicle/operator/health field. Stop names and every
// figure here are made up; nothing is read from the real sample.
interface ApcRow {
  CalendarDate: string; ServiceLevelDesc: string; Block: number; RouteID: number; RouteName: string;
  Trip: number; TripName: string; Direction: "North" | "South" | "East" | "West" | null;
  StopName: string | null; Timepoint: 0 | 1; Boards: number; Alights: number;
}

const PSEUDO_ROUTES: Record<number, string> = { 999: "Deadhead", 1010: "Flex", 1121: "MN United", 4444: "MVTA Connect", 5555: "Training", 6666: "Maintenance" };
const DIR_WORD = { N: "North", S: "South", E: "East", W: "West" } as const;
const DIR_LETTER = { North: "N", South: "S", East: "E", West: "W" } as const;

// [stop id, made-up name, timepoint]
const ROUTE_STOPS: Record<string, [number, string, 0 | 1][]> = {
  "495": [[40101, "Burnsville Transit Station", 1], [40112, "County Rd 42 at Elm St", 0], [40130, "Apple Valley Transit Station", 1], [40144, "Cedar Ave at 140th St", 0], [40188, "Mall of America Transit Ctr", 1]],
  "436": [[30535, "Eagan Transit Station", 1], [30540, "Yankee Rd at Oak Dr", 0], [30552, "Lone Pine Rd at Ridge Ct", 0], [30561, "Cedar Grove Station", 1], [30577, "Blackhawk Park & Ride", 1]],
  "460": [[40101, "Burnsville Transit Station", 1], [40160, "Heart of the City P&R", 0], [51552, "46th St Station Gate J", 1], [51600, "Marquette Ave at 7th St", 1]],
  "442": [[40101, "Burnsville Transit Station", 1], [40121, "Southcross Dr at Maple Ln", 0], [40130, "Apple Valley Transit Station", 1]],
  "444": [[40201, "Savage Park & Ride", 1], [40210, "Hwy 13 at Quarry Rd", 0], [40101, "Burnsville Transit Station", 1]],
  "446": [[30535, "Eagan Transit Station", 1], [30610, "Cliff Rd at Birch Ave", 0], [40170, "Burnsville Center", 1]],
  "477": [[40301, "Lakeville Cedar P&R", 1], [40101, "Burnsville Transit Station", 1], [51600, "Marquette Ave at 7th St", 1]],
  "420": [[40101, "Burnsville Transit Station", 1], [40140, "Nicollet Ave at 130th St", 0], [40145, "Nicollet Ave at Burnsville Pkwy", 1], [40150, "River Hills Dr at Pine Ln", 0]],
};

const SAMPLE_DATE = "2026-10-28";
const hhmm = (start: string) => Number(start.replace(":", ""));
const fromHhmm = (n: number) => `${String(Math.floor(n / 100)).padStart(2, "0")}:${String(n % 100).padStart(2, "0")}`;
const blockNum = (b: string) => Number(b);
const blockStr = (n: number) => String(n).padStart(3, "0");

function spread(n: number, parts: number, seed: number) {
  const out = Array(parts).fill(0) as number[];
  for (let i = 0; i < n; i++) out[(i * 7 + seed) % parts]++;
  return out;
}

function apcTripRows(block: number, route: string, dir: keyof typeof DIR_WORD, start: number, boards: number, unplaced: number): ApcRow[] {
  const stops = ROUTE_STOPS[route] ?? [[1, "Start", 1], [2, "End", 1]];
  const placed = Math.max(0, boards - unplaced);
  const b = [...spread(placed, stops.length - 1, start), 0];
  const a = [0, ...spread(placed, stops.length - 1, start + 3)];
  const base = { CalendarDate: `${SAMPLE_DATE}T00:00:00.000`, ServiceLevelDesc: "Weekday", Block: block, RouteID: Number(route), RouteName: route, Trip: start, TripName: `${start}-${dir}`, Direction: DIR_WORD[dir] };
  const rows: ApcRow[] = stops.map(([id, name, tp], i) => ({ ...base, StopName: `${id} - ${name}`.slice(0, 48), Timepoint: tp, Boards: b[i], Alights: a[i] }));
  // The feed sorts by StopName (no stop sequence) and puts the unplaced row first.
  rows.sort((x, y) => x.StopName!.localeCompare(y.StopName!));
  if (unplaced > 0 || start % 3 === 0) rows.unshift({ ...base, StopName: null, Timepoint: 0, Boards: unplaced, Alights: unplaced ? 1 : boards ? 2 : 0 });
  return rows;
}

// APC ÷ true ridership by bus, to make the by-bus view say something.
const BUS_RATIO: Record<string, number> = { "4421": 1.12, "4388": 1.45, "4502": 1.08, "4513": 0, "4610": 0.7, "4702": 1.04 };

// Manual counts keyed for 2026-10-28: the 4-week median give or take one, except four
// trips that trip the §6 outlier rule, each set up to show a different APC reading.
const MANUAL_OVERRIDE: Record<string, number> = {
  "1436311": 0,   // 436 N, median 14 — sheet blank, APC saw riders
  "1436420": 140, // 460 N, median 38 — keyed 140 for 40, APC sides with the median
  "1436861": 31,  // 420 W, median 6 — a real surge, APC sides with the count
  "1436641": 0,   // 446 S, median 5 — bus 4513 has no working counter, no evidence
};
const APC_OVERRIDE: Record<string, number> = { "1436861": 33 };
const manualFor = (t: Trip) => MANUAL_OVERRIDE[t.tripId] ?? (t.median4wk === null ? null : Math.max(0, t.median4wk + (Number(t.tripId.slice(-1)) % 3) - 1));

function apcSampleRows(): ApcRow[] {
  const out: ApcRow[] = [];
  for (const b of blocksFor(SAMPLE_DATE)) {
    const ratio = BUS_RATIO[b.avail?.bus ?? ""] ?? 1.1;
    for (const t of b.trips) {
      if (!needsCount(t)) continue;
      if (t.tripId === "1436863") continue; // scheduled, ran, but no APC rows at all
      const zero = ratio === 0 || t.tripId === "1436421"; // whole bus, or one trip, reads zero everywhere
      const boards = zero ? 0 : APC_OVERRIDE[t.tripId] ?? Math.round((t.median4wk ?? 0) * ratio);
      out.push(...apcTripRows(blockNum(b.block), t.route, t.dir, hhmm(t.start), boards, zero ? 0 : Number(t.tripId.slice(-1)) % 3));
    }
  }
  // A tripper APC saw that the Dispatch Log does not carry (spec §4 unscheduled trip).
  out.push(...apcTripRows(105, "460", "N", 750, 23, 1));
  // Pseudo-routes: Trip 0, "(X) Undefined", no direction.
  const pseudo = (block: number, route: number, boards: number): ApcRow => ({ CalendarDate: `${SAMPLE_DATE}T00:00:00.000`, ServiceLevelDesc: "Weekday", Block: block, RouteID: route, RouteName: PSEUDO_ROUTES[route], Trip: 0, TripName: "(X) Undefined", Direction: null, StopName: null, Timepoint: 0, Boards: boards, Alights: boards });
  out.push(pseudo(1, 999, 2), pseudo(24, 999, 1), pseudo(105, 999, 0), pseudo(418, 5555, 0), pseudo(212, 1121, 3));
  return out;
}

type ApcStatus = "compared" | "all_zero" | "no_rows" | "apc_only" | "no_manual";
interface ApcTripView {
  key: string; block: string; route: string; dir: string; start: string; tripName: string; bus: string | null;
  manual: number | null; median: number | null; flag: string | null; apc: number | null; unplaced: number; rows: ApcRow[]; status: ApcStatus;
}

// Match: Block (int → 001) + route + direction + scheduled start (Trip HHMM) on the service date.
function buildApcView(rows: ApcRow[]) {
  const revenue = rows.filter((r) => !(r.RouteID in PSEUDO_ROUTES));
  const pseudo = rows.filter((r) => r.RouteID in PSEUDO_ROUTES);
  const keyOf = (block: string, route: string, dir: string, start: number) => `${block}|${route}|${dir}|${start}`;
  const apcByKey = new Map<string, ApcRow[]>();
  for (const r of revenue) {
    const k = keyOf(blockStr(r.Block), String(r.RouteID), DIR_LETTER[r.Direction!], r.Trip);
    apcByKey.set(k, [...(apcByKey.get(k) ?? []), r]);
  }
  const trips: ApcTripView[] = [];
  const blocks = blocksFor(SAMPLE_DATE);
  for (const b of blocks) for (const t of b.trips) {
    if (!needsCount(t)) continue;
    const k = keyOf(b.block, t.route, t.dir, hhmm(t.start));
    const mine = apcByKey.get(k) ?? [];
    apcByKey.delete(k);
    const apc = mine.reduce((s, r) => s + r.Boards, 0);
    const allZero = mine.length > 0 && mine.every((r) => r.Boards === 0 && r.Alights === 0);
    const manual = manualFor(t);
    const flag = manual === null ? null : outlier(t, String(manual));
    const status: ApcStatus = mine.length === 0 ? "no_rows" : allZero ? "all_zero" : manual === null ? "no_manual" : "compared";
    trips.push({ key: k, block: b.block, route: t.route, dir: t.dir, start: t.start, tripName: mine[0]?.TripName ?? `${hhmm(t.start)}-${t.dir}`, bus: b.avail?.bus ?? null, manual, median: t.median4wk, flag, apc: status === "compared" || status === "no_manual" ? apc : null, unplaced: mine.filter((r) => r.StopName === null).reduce((s, r) => s + r.Boards, 0), rows: mine, status });
  }
  for (const [k, mine] of apcByKey) {
    const [block, route, dir, start] = k.split("|");
    trips.push({ key: k, block, route, dir, start: fromHhmm(Number(start)), tripName: mine[0].TripName, bus: blocks.find((b) => b.block === block)?.avail?.bus ?? null, manual: null, median: null, flag: null, apc: mine.reduce((s, r) => s + r.Boards, 0), unplaced: mine.filter((r) => r.StopName === null).reduce((s, r) => s + r.Boards, 0), rows: mine, status: "apc_only" });
  }
  trips.sort((a, b) => a.block.localeCompare(b.block) || a.start.localeCompare(b.start));
  return { revenue, pseudo, trips };
}

// What APC says about a flagged count (§6 flag, §12 "accuracy evidence"): whichever of the
// keyed count and the 4-week median the APC figure sits closer to.
function apcReading(r: ApcTripView): { pill: string; reading: string; answer: string } {
  if (r.apc === null) return { pill: "rp-pill-muted", reading: r.status === "no_rows" ? "No APC rows" : "No working counter", answer: "No evidence — answer from the sheet and the operator" };
  if (Math.abs(r.apc - r.manual!) <= Math.abs(r.apc - (r.median ?? 0)))
    return { pill: "rp-pill-ok", reading: `APC ${r.apc} backs the count`, answer: "Likely real — confirm with a note" };
  return { pill: "rp-pill-bad", reading: `APC ${r.apc} backs the usual ${r.median}`, answer: r.manual === 0 ? "Riders were aboard — find the sheet or re-key" : "Likely a keying error — correct it" };
}

const STATUS_PILL: Record<ApcStatus, [string, string]> = {
  compared: ["rp-pill-ok", "Compared"],
  no_manual: ["rp-pill-muted", "No manual count"],
  all_zero: ["rp-pill-bad", "All zeros — treated as no APC"],
  no_rows: ["rp-pill-muted", "No APC rows"],
  apc_only: ["rp-pill-warn", "APC only — unscheduled trip?"],
};

function ratioTable(label: string, groups: { name: string; trips: ApcTripView[] }[], tolerance: number, hint: string) {
  return (
    <table className="rp-b-list rp-apc-ratio">
      <thead><tr><th>{label}</th><th className="num">Trips</th><th className="num">Manual</th><th className="num">APC</th><th className="num">APC ÷ manual</th><th /></tr></thead>
      <tbody>{groups.map((g) => {
        const m = g.trips.reduce((s, r) => s + r.manual!, 0); const a = g.trips.reduce((s, r) => s + r.apc!, 0);
        const ratio = m ? a / m : 1;
        return <tr key={g.name}><td className="mono">{g.name}</td><td className="num">{g.trips.length}</td><td className="num">{m}</td><td className="num">{a}</td><td className="num">{ratio.toFixed(2)}</td><td>{Math.abs(ratio - 1) > tolerance / 100 && <span className="rp-pill rp-pill-warn">{hint}</span>}</td></tr>;
      })}</tbody>
    </table>
  );
}

function ApcComparison() {
  const [tolerance, setTolerance] = useState(15);
  const [open, setOpen] = useState<string | null>(null);
  const [show, setShow] = useState<"all" | "flagged" | "compared" | "not">("all");
  const [tpOnly, setTpOnly] = useState(false);
  const [byWhat, setByWhat] = useState<"route" | "bus">("route");
  const { revenue, pseudo, trips } = useMemo(() => buildApcView(apcSampleRows()), []);

  const flagged = trips.filter((r) => r.flag);
  // Flagged counts stay out of the totals and ratios until answered, so one keying error
  // doesn't paint a whole bus or route.
  const comparedAll = trips.filter((r) => r.status === "compared");
  const compared = comparedAll.filter((r) => !r.flag);
  const diffPct = (r: ApcTripView) => (r.manual === 0 ? (r.apc === 0 ? 0 : 100) : Math.round((100 * (r.apc! - r.manual!)) / r.manual!));
  const within = compared.filter((r) => Math.abs(diffPct(r)) <= tolerance).length;
  const sumManual = compared.reduce((s, r) => s + r.manual!, 0);
  const sumApc = compared.reduce((s, r) => s + r.apc!, 0);
  const scheduled = trips.filter((r) => r.status !== "apc_only");
  const matched = scheduled.filter((r) => r.status !== "no_rows");
  const apcOnly = trips.filter((r) => r.status === "apc_only");
  const unplacedBoards = revenue.filter((r) => r.StopName === null).reduce((s, r) => s + r.Boards, 0);
  const groupBy = (f: (r: ApcTripView) => string) => [...new Set(compared.map(f))].sort().map((name) => ({ name, trips: compared.filter((r) => f(r) === name) }));
  const visible = trips.filter((r) => show === "all" || (show === "flagged" ? !!r.flag : show === "compared" ? r.status === "compared" : r.status !== "compared"));

  return (
    <div className="rp-apc">
      <div className="rp-banner rp-banner-soft">FUTURE · rows shaped on the real Avail360 <span className="mono">ApcRidershipBySvcLvlBlockRouteTripTimepoint/v1</span> response (sample 2026-10-28) · stop names and figures made up · service date {SAMPLE_DATE}</div>

      <div className="rp-b-garages rp-apc-cards">
        <div className="rp-b-garage">
          <div className="rp-eyebrow">1 · Avail feed</div>
          <div className="rp-big">{revenue.length + pseudo.length} rows</div>
          <div className="rp-dim">one per stop per trip · {new Set(revenue.map((r) => `${r.Block}|${r.RouteID}|${r.Trip}|${r.Direction}`)).size} revenue trips · {pseudo.length} pseudo-route rows set aside · {unplacedBoards} boardings not placed at a stop, kept in trip totals</div>
        </div>
        <div className="rp-b-garage">
          <div className="rp-eyebrow">2 · Matched to Dispatch Log</div>
          <div className="rp-big">{matched.length} / {scheduled.length}</div>
          <div className="rp-dim">by block + route + direction + start (Trip HHMM) · {apcOnly.length} APC trip{apcOnly.length === 1 ? "" : "s"} with no scheduled match</div>
        </div>
        <div className="rp-b-garage">
          <div className="rp-eyebrow">3 · Manual vs APC</div>
          <div className="rp-big">{sumManual} vs {sumApc}</div>
          <div className="rp-dim">{compared.length} compared trips ({comparedAll.length - compared.length} flagged left out) · {compared.length ? Math.round((100 * within) / compared.length) : 0}% within ±<input className="rp-tol" aria-label="Tolerance percent" value={tolerance} onChange={(e) => setTolerance(Number(e.target.value.replace(/\D/g, "")) || 0)} />%</div>
        </div>
      </div>

      <h3 className="rp-b-title">Flagged counts — what APC says <span className="rp-pill rp-pill-warn">{flagged.length}</span></h3>
      <p className="rp-dim rp-apc-note">Flag rule (§6): more than 3× the 4-week median and at least 10 above it, or 0 when the median is 5 or more. APC is evidence for the contractor's answer, not the answer.</p>
      <table className="rp-b-list rp-apc-flags">
        <thead><tr><th>Block</th><th>Trip</th><th>Bus</th><th className="num">Keyed</th><th className="num">4-wk median</th><th>Flag</th><th>APC reading</th><th>Suggested answer</th></tr></thead>
        <tbody>{flagged.map((r) => {
          const e = apcReading(r);
          return <tr key={r.key} onClick={() => { setShow("flagged"); setOpen(r.key); }}>
            <td className="mono">{r.block}</td><td>{r.route} {r.dir} <span className="mono">{r.start}</span></td><td className="mono">{r.bus ?? "—"}</td>
            <td className="num"><strong>{r.manual}</strong></td><td className="num">{r.median}</td>
            <td><span className="rp-pill rp-pill-warn">{r.flag}</span></td>
            <td><span className={`rp-pill ${e.pill}`}>{e.reading}</span></td><td>{e.answer}</td>
          </tr>;
        })}</tbody>
      </table>

      <div className="rp-apc-head">
        <h3 className="rp-b-title">Where does the gap sit?</h3>
        <div className="rp-aux" role="tablist">
          <button className={byWhat === "route" ? "active" : ""} onClick={() => setByWhat("route")}>By route</button>
          <button className={byWhat === "bus" ? "active" : ""} onClick={() => setByWhat("bus")}>By bus</button>
        </div>
      </div>
      {byWhat === "route"
        ? ratioTable("Route", groupBy((r) => r.route), tolerance, "Gap on the whole route — counting practice or counters?")
        : <>
            {ratioTable("Bus", groupBy((r) => r.bus ?? "not in pull-out"), tolerance, "Steady gap on one bus — check this counter")}
            <p className="rp-dim">The APC feed has no vehicle. Bus comes from Avail's pull-out report by block, so a block that changed bus mid-day is attributed to the first bus.</p>
          </>}

      <div className="rp-apc-head">
        <h3 className="rp-b-title">By trip — click a row for Avail's stop rows</h3>
        <div className="rp-aux" role="tablist">
          {([["all", `All ${trips.length}`], ["flagged", `Flagged ${flagged.length}`], ["compared", `Compared ${comparedAll.length}`], ["not", `Not compared ${trips.length - comparedAll.length}`]] as const).map(([k, l]) => (
            <button key={k} className={show === k ? "active" : ""} onClick={() => setShow(k)}>{l}</button>
          ))}
        </div>
      </div>
      <table className="rp-b-list">
        <thead><tr><th>Block</th><th>Route</th><th>Start</th><th>TripName</th><th>Bus</th><th className="num">Manual</th><th className="num">APC boards</th><th className="num">Unplaced</th><th className="num">Diff</th><th>Flag</th><th>Status</th></tr></thead>
        <tbody>{visible.flatMap((r) => {
          const d = r.status === "compared" ? diffPct(r) : null;
          const [pill, label] = STATUS_PILL[r.status];
          const stops = tpOnly ? r.rows.filter((x) => x.Timepoint === 1 || x.StopName === null) : r.rows;
          return [
            <tr key={r.key} onClick={() => setOpen(open === r.key ? null : r.key)} className={open === r.key ? "open" : ""}>
              <td className="mono">{r.block}</td><td>{r.route} {r.dir}</td><td className="mono">{r.start}</td><td className="mono">{r.tripName}</td><td className="mono">{r.bus ?? "—"}</td>
              <td className="num">{r.manual ?? "—"}</td><td className="num">{r.apc ?? "—"}</td><td className="num">{r.rows.length ? r.unplaced : "—"}</td>
              <td className="num">{d === null ? "—" : <span className={Math.abs(d) > tolerance ? "rp-bad" : ""}>{d > 0 ? "+" : ""}{d}%</span>}</td>
              <td>{r.flag && <span className="rp-pill rp-pill-warn">{r.flag.startsWith("Zero") ? "Zero" : "High"}</span>}</td>
              <td><span className={`rp-pill ${pill}`}>{label}</span></td>
            </tr>,
            open === r.key && <tr key={`${r.key}-stops`} className="rp-b-drawer"><td colSpan={11}>
              {r.rows.length ? (<>
                <label className="rp-dim rp-apc-tp"><input type="checkbox" checked={tpOnly} onChange={(e) => setTpOnly(e.target.checked)} /> Timepoints only</label>
                <table className="rp-trips rp-tp"><thead><tr><th>StopName</th><th>TP</th><th className="num">Boards</th><th className="num">Alights</th></tr></thead>
                  <tbody>{stops.map((x, i) => <tr key={i}><td>{x.StopName ?? <em className="rp-dim">Not placed at a stop</em>}</td><td>{x.Timepoint ? "●" : ""}</td><td className="num">{x.Boards}</td><td className="num">{x.Alights}</td></tr>)}</tbody></table>
                <p className="rp-dim">Avail sends stops in StopName order with no stop sequence, so this is not the order the bus served them.</p>
              </>) : <span className="rp-dim">Avail sent no rows for this trip.</span>}
            </td></tr>,
          ];
        })}</tbody>
      </table>

      <h3 className="rp-b-title">Set aside — pseudo-routes in the same feed</h3>
      <table className="rp-b-list rp-apc-ratio">
        <thead><tr><th>Route</th><th>Name</th><th className="num">Rows</th><th className="num">Boards</th><th>Why</th></tr></thead>
        <tbody>{[...new Set(pseudo.map((r) => r.RouteID))].sort((a, b) => a - b).map((id) => {
          const mine = pseudo.filter((r) => r.RouteID === id);
          return <tr key={id}><td className="mono">{id}</td><td>{PSEUDO_ROUTES[id]}</td><td className="num">{mine.length}</td><td className="num">{mine.reduce((s, r) => s + r.Boards, 0)}</td><td className="rp-dim">{id === 1121 ? "Special event — possible source for event counts (C7)" : "Not fixed-route service"}</td></tr>;
        })}</tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- state + switcher

function StatePanel({ entries, garages }: { entries: Entries; garages: Record<string, Garage> }) {
  const summary = Object.fromEntries(Object.entries(entries).map(([k, e]) => {
    const [d, blk] = k.split("|");
    const b = blocksFor(d).find((x) => x.block === blk)!;
    return [k, { state: sheetState(b, e), counts: e.counts, operator: e.operator, bus: e.bus, overridden: e.operatorOverridden, reconstructed: e.reconstructed, added: e.added.length, enteredAt: e.enteredAt }];
  }));
  return (
    <details className="rp-state">
      <summary>Prototype state</summary>
      <pre>{JSON.stringify({ garages, sheets: summary }, null, 2)}</pre>
    </details>
  );
}

function Switcher({ variant, setVariant }: { variant: Variant; setVariant: (v: Variant) => void }) {
  if (!import.meta.env.DEV) return null;
  const i = VARIANTS.findIndex((x) => x.key === variant);
  const prev = VARIANTS[(i - 1 + VARIANTS.length) % VARIANTS.length];
  const next = VARIANTS[(i + 1) % VARIANTS.length];
  return (
    <div className="rp-switcher" aria-label="Prototype layout switcher">
      <button onClick={() => setVariant(prev.key)} aria-label={`Show ${prev.label}`}>←</button>
      <span>{i + 1}/{VARIANTS.length} · <strong>{VARIANTS[i].label}</strong> · ← → keys</span>
      <button onClick={() => setVariant(next.key)} aria-label={`Show ${next.label}`}>→</button>
    </div>
  );
}
