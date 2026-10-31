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
  { key: "sheet", group: "OCC entry — pick one", tag: "A", label: "Sheet", desc: "Pick a block; the form mirrors the paper sheet. Closest to Access today." },
  { key: "worklist", group: "OCC entry — pick one", tag: "B", label: "Worklist", desc: "Starts from what is missing by garage; enter sheets inline." },
  { key: "datasheet", group: "OCC entry — pick one", tag: "C", label: "Datasheet", desc: "One keyboard grid for the whole day; fastest for a stack of sheets." },
  { key: "mobile", group: "Operator app (future)", tag: "D", label: "Operator mobile", desc: "Operators count on an MVTA device instead of paper." },
  { key: "print", group: "Supporting screens", tag: "", label: "Print Count Sheets", desc: "The redesigned sheet, printed overnight." },
  { key: "garages", group: "Supporting screens", tag: "", label: "Block → garage list", desc: "Planning keeps this each service change." },
  { key: "apc", group: "Supporting screens", tag: "", label: "Compare with Avail APC", desc: "Manual counts vs Avail APC boards/alights (future)." },
] as const;
type Variant = (typeof VARIANTS)[number]["key"];
const isVariant = (v: string | null): v is Variant => VARIANTS.some((x) => x.key === v);

export function RidershipEntryPrototype() {
  const [searchParams, setSearchParams] = useSearchParams();
  const vp = searchParams.get("variant");
  const variant: Variant = isVariant(vp) ? vp : "sheet";
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

// Shape from Avail360 "APC Ridership By Service Level, Block, Route, Trip,
// Timepoint" (ApcRidershipBySvcLvlBlockRouteTripTimepoint/v1/{Property}).
// The spec gives filters (Block/Route/Trip Farebox IDs, date range) but no
// response schema, so these field names are guesses until a sample comes back.
interface ApcTimepoint { timepoint: string; boards: number; alights: number }
interface ApcTrip { serviceLevel: string; blockFareboxId: string; routeFareboxId: string; tripFareboxId: string; dir: string; start: string; bus: string; manual: number | null; timepoints: ApcTimepoint[] | null; health: "ok" | "no_apc" | "door_fault" }

const TIMEPOINTS: Record<string, string[]> = {
  "495": ["Burnsville TS", "Apple Valley TS", "Mall of America"],
  "436": ["Eagan TS", "Cedar Grove", "Blackhawk P&R", "Eagan TS"],
  "460": ["Burnsville TS", "I-35W & 46th", "Downtown Mpls"],
  "446": ["Eagan TS", "Cliff Rd", "Burnsville Ctr"],
  "477": ["Lakeville Cedar", "Burnsville TS", "Downtown Mpls"],
  "420": ["Burnsville TS", "Nicollet Ave", "Burnsville TS"],
  "442": ["Burnsville TS", "Apple Valley TS"], "444": ["Savage", "Burnsville TS"],
};

function apcFixtures(): ApcTrip[] {
  const health: Record<string, ApcTrip["health"]> = { "4421": "ok", "4388": "ok", "4502": "door_fault", "4513": "no_apc", "4610": "ok", "4702": "ok" };
  const drift: Record<string, number> = { "4421": 0.94, "4388": 1.02, "4610": 0.71, "4702": 1.0 };
  const out: ApcTrip[] = [];
  for (const b of blocksFor("2026-10-28")) {
    const bus = b.avail?.bus ?? "—";
    const h = health[bus] ?? "no_apc";
    for (const t of b.trips) {
      if (!needsCount(t)) continue;
      const total = t.median4wk === null ? 0 : Math.round(t.median4wk * (drift[bus] ?? 1) + (t.tripId.endsWith("7") ? 3 : 0));
      const tps = TIMEPOINTS[t.route] ?? ["Start", "End"];
      // Boards split across all but the last timepoint, alights across all but the first.
      const split = (n: number, parts: number) => Array.from({ length: parts }, (_, i) => Math.floor(n / parts) + (i < n % parts ? 1 : 0));
      const boards = [...split(total, tps.length - 1), 0];
      const alights = [0, ...split(total, tps.length - 1)];
      const timepoints = h === "ok" ? tps.map((name, i) => ({ timepoint: name, boards: boards[i], alights: alights[i] }))
        : h === "door_fault" ? tps.map((name) => ({ timepoint: name, boards: 0, alights: 0 })) : null;
      out.push({ serviceLevel: "Weekday", blockFareboxId: String(Number(b.block)), routeFareboxId: t.route, tripFareboxId: t.tripId.slice(-4), dir: t.dir, start: t.start, bus, manual: t.median4wk, timepoints, health: h });
    }
  }
  return out;
}

const sumBoards = (t: ApcTrip) => t.timepoints?.reduce((s, x) => s + x.boards, 0) ?? null;

function ApcComparison() {
  const [tolerance, setTolerance] = useState(15);
  const [open, setOpen] = useState<string | null>(null);
  const rows = apcFixtures();
  const comparable = rows.filter((r) => r.health === "ok" && r.manual !== null);
  const diffPct = (r: ApcTrip) => { const a = sumBoards(r)!; const m = r.manual!; return m === 0 ? (a === 0 ? 0 : 100) : Math.round((100 * (a - m)) / m); };
  const within = comparable.filter((r) => Math.abs(diffPct(r)) <= tolerance).length;
  const sumManual = comparable.reduce((s, r) => s + r.manual!, 0);
  const sumApc = comparable.reduce((s, r) => s + sumBoards(r)!, 0);
  const byBus = [...new Set(comparable.map((r) => r.bus))].map((bus) => {
    const mine = comparable.filter((r) => r.bus === bus);
    const m = mine.reduce((s, r) => s + r.manual!, 0); const a = mine.reduce((s, r) => s + sumBoards(r)!, 0);
    return { bus, trips: mine.length, ratio: m ? a / m : 1 };
  });

  return (
    <div className="rp-apc">
      <div className="rp-banner rp-banner-soft">FUTURE · shaped on Avail360 <span className="mono">ApcRidershipBySvcLvlBlockRouteTripTimepoint/v1</span> · response field names assumed until a sample arrives · made-up figures</div>
      <div className="rp-b-garages">
        <div className="rp-b-garage"><div className="rp-eyebrow">Trips comparable</div><div className="rp-big">{comparable.length} / {rows.length}</div><div className="rp-dim">bus has working APC and a manual count</div></div>
        <div className="rp-b-garage"><div className="rp-eyebrow">Agreement</div><div className="rp-big">{comparable.length ? Math.round((100 * within) / comparable.length) : 0}%</div><div className="rp-dim">within ±<input className="rp-tol" value={tolerance} onChange={(e) => setTolerance(Number(e.target.value.replace(/\D/g, "")) || 0)} />% of manual</div></div>
        <div className="rp-b-garage"><div className="rp-eyebrow">Boardings, 2026-10-28</div><div className="rp-big">{sumManual} vs {sumApc}</div><div className="rp-dim">manual vs APC on comparable trips</div></div>
      </div>
      <h3 className="rp-b-title">By bus — is it the counter or the sheet?</h3>
      <table className="rp-b-list">
        <thead><tr><th>Bus</th><th>Trips</th><th>APC ÷ manual</th><th /></tr></thead>
        <tbody>{byBus.map((b) => <tr key={b.bus}><td className="mono">{b.bus}</td><td>{b.trips}</td><td>{b.ratio.toFixed(2)}</td><td>{Math.abs(b.ratio - 1) > tolerance / 100 && <span className="rp-pill rp-pill-warn">Steady gap — check this counter, or this operator's sheets</span>}</td></tr>)}</tbody>
      </table>
      <h3 className="rp-b-title">By trip — click a row for Avail's timepoint detail</h3>
      <table className="rp-b-list">
        <thead><tr><th>Service level</th><th>Block FB</th><th>Route FB</th><th>Trip FB</th><th>Start</th><th>Bus</th><th className="num">Manual</th><th className="num">APC boards</th><th className="num">Diff</th><th>APC health</th></tr></thead>
        <tbody>{rows.flatMap((r) => {
          const k = `${r.blockFareboxId}-${r.tripFareboxId}`;
          const ok = r.health === "ok" && r.manual !== null;
          const d = ok ? diffPct(r) : null;
          return [
            <tr key={k} onClick={() => setOpen(open === k ? null : k)} className={open === k ? "open" : ""}>
              <td>{r.serviceLevel}</td><td className="mono">{r.blockFareboxId}</td><td>{r.routeFareboxId} {r.dir}</td><td className="mono">{r.tripFareboxId}</td><td className="mono">{r.start}</td><td className="mono">{r.bus}</td>
              <td className="num">{r.manual ?? "—"}</td><td className="num">{r.health === "ok" ? sumBoards(r) : "—"}</td>
              <td className="num">{d === null ? "—" : <span className={Math.abs(d) > tolerance ? "rp-bad" : ""}>{d > 0 ? "+" : ""}{d}%</span>}</td>
              <td>{r.health === "ok" ? <span className="rp-pill rp-pill-ok">Working</span> : r.health === "door_fault" ? <span className="rp-pill rp-pill-bad">All zeros — excluded</span> : <span className="rp-pill rp-pill-muted">No APC on bus</span>}</td>
            </tr>,
            open === k && <tr key={`${k}-tp`} className="rp-b-drawer"><td colSpan={10}>
              {r.timepoints ? (
                <table className="rp-trips rp-tp"><thead><tr><th>Timepoint</th><th className="num">Boards</th><th className="num">Alights</th></tr></thead>
                  <tbody>{r.timepoints.map((x, i) => <tr key={i}><td>{x.timepoint}</td><td className="num">{x.boards}</td><td className="num">{x.alights}</td></tr>)}</tbody></table>
              ) : <span className="rp-dim">No APC data for this bus.</span>}
            </td></tr>,
          ];
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
