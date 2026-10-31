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
  { key: "sheet", label: "Sheet — mirror the paper" },
  { key: "worklist", label: "Worklist — completeness first" },
  { key: "datasheet", label: "Datasheet — keyboard grid" },
] as const;
type Variant = (typeof VARIANTS)[number]["key"];
const isVariant = (v: string | null): v is Variant => VARIANTS.some((x) => x.key === v);

type Aux = "entry" | "print" | "garages" | "apc";

export function RidershipEntryPrototype() {
  const [searchParams, setSearchParams] = useSearchParams();
  const vp = searchParams.get("variant");
  const variant: Variant = isVariant(vp) ? vp : "sheet";
  const [aux, setAux] = useState<Aux>("entry");
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

  return (
    <div className="rp">
      <div className="rp-banner">PROTOTYPE · fixtures only · nothing is saved · today is {TODAY}</div>
      <div className="rp-aux" role="tablist">
        <button className={aux === "entry" ? "active" : ""} onClick={() => setAux("entry")}>Ridership entry</button>
        <button className={aux === "print" ? "active" : ""} onClick={() => setAux("print")}>Print Count Sheets</button>
        <button className={aux === "garages" ? "active" : ""} onClick={() => setAux("garages")}>Block → garage list</button>
        <button className={aux === "apc" ? "active" : ""} onClick={() => setAux("apc")}>Compare with Avail APC (future)</button>
      </div>
      {aux === "entry" && variant === "sheet" && <SheetVariant {...props} />}
      {aux === "entry" && variant === "worklist" && <WorklistVariant {...props} />}
      {aux === "entry" && variant === "datasheet" && <DatasheetVariant {...props} />}
      {aux === "print" && <PrintSheets garages={garages} />}
      {aux === "garages" && <GarageList garages={garages} setGarages={setGarages} />}
      {aux === "apc" && <ApcComparison />}
      <StatePanel entries={entries} garages={garages} />
      {aux === "entry" && <Switcher variant={variant} setVariant={setVariant} />}
    </div>
  );
}

interface VariantProps {
  entries: Entries;
  update: (date: string, block: string, fn: (e: SheetEntry) => SheetEntry) => void;
  garages: Record<string, Garage>;
}

// ---------------------------------------------------------------- shared entry form

function SheetForm({ b, e, update, garage, compact = false }: { b: Block; e: SheetEntry; update: VariantProps["update"]; garage: Garage; compact?: boolean }) {
  const set = (fn: (e: SheetEntry) => SheetEntry) => update(b.serviceDate, b.block, fn);
  const state = sheetState(b, e);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ route: "", dir: "N", start: "", reason: "Tripper", count: "" });

  return (
    <div className={`rp-form ${compact ? "compact" : ""}`}>
      <div className="rp-form-head">
        <div>
          <div className="rp-eyebrow">Count Sheet · {b.serviceDate} · {garage ?? "Unassigned garage"}</div>
          <h3>Block {b.block}</h3>
        </div>
        <span className={`rp-pill ${STATE_PILL[state]}`}>{STATE_LABEL[state]}</span>
      </div>

      <div className="rp-who">
        <label>Operator<input value={e.operator} onChange={(ev) => set((x) => ({ ...x, operator: ev.target.value, operatorOverridden: ev.target.value !== (b.avail?.operator ?? "") }))} /></label>
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
                    ? <input data-trip-input aria-label={`Boardings trip ${t.tripId}`} inputMode="numeric" value={v} autoFocus={!compact && i === 0}
                        onChange={(ev) => set((x) => ({ ...x, counts: { ...x.counts, [t.tripId]: ev.target.value.replace(/\D/g, "") } }))}
                        onKeyDown={(ev) => { if (ev.key === "Enter") focusNext(ev.currentTarget); }} />
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
        <button className="rp-primary" onClick={() => set((x) => ({ ...x, enteredAt: TODAY }))}>Save sheet</button>
      </div>
    </div>
  );
}

function focusNext(el: HTMLInputElement) {
  const all = Array.from(document.querySelectorAll<HTMLInputElement>("[data-trip-input]"));
  const i = all.indexOf(el);
  all[i + 1]?.focus();
  all[i + 1]?.select();
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

// ---------------------------------------------------------------- Avail APC comparison (future)

// ASSUMPTION: no APC data reaches OnBoard today. This mocks a per-trip Avail APC
// boardings figure, as Avail's APC reporting would give it, for buses with
// working counters. Shape and availability are unconfirmed.
interface ApcRow { tripId: string; route: string; dir: string; start: string; block: string; bus: string; manual: number | null; apc: number | null; apcHealth: "ok" | "no_apc" | "door_fault" }

function apcFixtures(): ApcRow[] {
  const rows: ApcRow[] = [];
  const apcBuses: Record<string, ApcRow["apcHealth"]> = { "4421": "ok", "4388": "ok", "4502": "door_fault", "4513": "no_apc", "4610": "ok", "4702": "ok" };
  const drift: Record<string, number> = { "4421": 0.94, "4388": 1.02, "4610": 0.71, "4702": 1.0 };
  for (const b of blocksFor("2026-10-28")) {
    const bus = b.avail?.bus ?? "—";
    const health = apcBuses[bus] ?? "no_apc";
    for (const t of b.trips) {
      if (!needsCount(t)) continue;
      const manual = t.median4wk;
      const apc = health === "ok" && manual !== null ? Math.round(manual * (drift[bus] ?? 1) + (t.tripId.endsWith("7") ? 3 : 0)) : health === "door_fault" ? 0 : null;
      rows.push({ tripId: t.tripId, route: t.route, dir: t.dir, start: t.start, block: b.block, bus, manual, apc, apcHealth: health });
    }
  }
  return rows;
}

function ApcComparison() {
  const [tolerance, setTolerance] = useState(15);
  const rows = apcFixtures();
  const comparable = rows.filter((r) => r.apcHealth === "ok" && r.manual !== null && r.apc !== null);
  const diffPct = (r: ApcRow) => (r.manual! === 0 ? (r.apc! === 0 ? 0 : 100) : Math.round((100 * (r.apc! - r.manual!)) / r.manual!));
  const within = comparable.filter((r) => Math.abs(diffPct(r)) <= tolerance).length;
  const sumManual = comparable.reduce((s, r) => s + r.manual!, 0);
  const sumApc = comparable.reduce((s, r) => s + r.apc!, 0);
  const byBus = [...new Set(comparable.map((r) => r.bus))].map((bus) => {
    const mine = comparable.filter((r) => r.bus === bus);
    const m = mine.reduce((s, r) => s + r.manual!, 0); const a = mine.reduce((s, r) => s + r.apc!, 0);
    return { bus, trips: mine.length, ratio: m ? a / m : 1 };
  });

  return (
    <div className="rp-apc">
      <div className="rp-banner rp-banner-soft">FUTURE · assumes Avail APC per-trip boardings reach OnBoard — not available today</div>
      <div className="rp-b-garages">
        <div className="rp-b-garage"><div className="rp-eyebrow">Trips comparable</div><div className="rp-big">{comparable.length} / {rows.length}</div><div className="rp-dim">bus has working APC and a manual count</div></div>
        <div className="rp-b-garage"><div className="rp-eyebrow">Agreement</div><div className="rp-big">{comparable.length ? Math.round((100 * within) / comparable.length) : 0}%</div><div className="rp-dim">within ±<input className="rp-tol" value={tolerance} onChange={(e) => setTolerance(Number(e.target.value.replace(/\D/g, "")) || 0)} />%</div></div>
        <div className="rp-b-garage"><div className="rp-eyebrow">Day total</div><div className="rp-big">{sumManual} vs {sumApc}</div><div className="rp-dim">manual vs APC on comparable trips</div></div>
      </div>
      <h3 className="rp-b-title">By bus — is the counter or the sheet drifting?</h3>
      <table className="rp-b-list">
        <thead><tr><th>Bus</th><th>Trips</th><th>APC ÷ manual</th><th /></tr></thead>
        <tbody>{byBus.map((b) => <tr key={b.bus}><td className="mono">{b.bus}</td><td>{b.trips}</td><td>{b.ratio.toFixed(2)}</td><td>{Math.abs(b.ratio - 1) > tolerance / 100 && <span className="rp-pill rp-pill-warn">Consistent gap — check the counter or this operator's sheets</span>}</td></tr>)}</tbody>
      </table>
      <h3 className="rp-b-title">By trip · 2026-10-28</h3>
      <table className="rp-b-list">
        <thead><tr><th>Block</th><th>Trip</th><th>Route</th><th>Start</th><th>Bus</th><th className="num">Manual</th><th className="num">APC</th><th className="num">Diff</th><th>APC health</th></tr></thead>
        <tbody>{rows.map((r) => {
          const ok = r.apcHealth === "ok" && r.manual !== null && r.apc !== null;
          const d = ok ? diffPct(r) : null;
          return (
            <tr key={r.tripId}>
              <td className="mono">{r.block}</td><td className="mono">{r.tripId}</td><td>{r.route} {r.dir}</td><td className="mono">{r.start}</td><td className="mono">{r.bus}</td>
              <td className="num">{r.manual ?? "—"}</td><td className="num">{r.apc ?? "—"}</td>
              <td className="num">{d === null ? "—" : <span className={Math.abs(d) > tolerance ? "rp-bad" : ""}>{d > 0 ? "+" : ""}{d}%</span>}</td>
              <td>{r.apcHealth === "ok" ? <span className="rp-pill rp-pill-ok">Working</span> : r.apcHealth === "door_fault" ? <span className="rp-pill rp-pill-bad">Door sensor fault — excluded</span> : <span className="rp-pill rp-pill-muted">No APC on bus</span>}</td>
            </tr>
          );
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
      <span><strong>{String.fromCharCode(65 + i)}</strong> · {VARIANTS[i].label}</span>
      <button onClick={() => setVariant(next.key)} aria-label={`Show ${next.label}`}>→</button>
    </div>
  );
}
