// One Count Sheet, laid out like the paper (spec §4): Avail's operator and bus
// with an override, the block's trips in order with their Dispatch Log status,
// one answer per trip, unscheduled trips, and Reconstructed.
//
// Keyboard-first: Enter moves down the trips and then to Save; Ctrl/⌘+Enter
// saves from anywhere. The operator and bus are skipped unless Avail had no
// pull-out for the block, when they come first.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ApiError, type RidershipAddedTripReason, type RidershipSheet } from "@mvta/shared";
import { api } from "../../../config.js";
import {
  blankRequiredTrips,
  cellFromInput,
  cellMeaning,
  clock,
  DIRECTIONS,
  directionLetter,
  draftFromSheet,
  dueLabel,
  EXCUSED_LABEL,
  formatServiceDate,
  garageName,
  isDirty,
  isOverridden,
  REASON_LABEL,
  saveFromDraft,
  timeSpan,
  START_STATUS_LABEL,
  STATE_LABEL,
  STATE_TONE,
  type AddedDraft,
  type SheetDraft,
} from "../../../lib/ridership.js";

const REASONS = Object.keys(REASON_LABEL) as RidershipAddedTripReason[];

let localKey = 0;
const emptyAdded = (): AddedDraft => ({ key: `new-${++localKey}`, id: null, route: "", direction: "N", start: "", reason: "tripper", cell: "" });

/** The next field in the Enter order inside `root`, or the Save button after the last. */
function focusNext(root: HTMLElement | null, from: HTMLElement) {
  if (!root) return;
  const flow = Array.from(root.querySelectorAll<HTMLInputElement>("[data-flow]:not(:disabled)"));
  const next = flow[flow.indexOf(from as HTMLInputElement) + 1];
  if (next) {
    next.focus();
    next.select();
  } else {
    root.querySelector<HTMLButtonElement>("[data-save]")?.focus();
  }
}

export function SheetForm({ sheet, readOnly, onSaved, onReload, onDirtyChange, nav }: {
  sheet: RidershipSheet;
  readOnly: boolean;
  onSaved: (saved: RidershipSheet) => void;
  /** After a conflict: fetch the sheet as someone else saved it. */
  onReload: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  nav?: ReactNode;
}) {
  const [draft, setDraft] = useState<SheetDraft>(() => draftFromSheet(sheet));
  const [adding, setAdding] = useState<AddedDraft | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [conflict, setConflict] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const prefill = sheet.pullout.prefill;
  const overridden = isOverridden(draft, prefill);
  const dirty = isDirty(sheet, draft);
  const set = (patch: Partial<SheetDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const setCell = (tripId: string, raw: string) => setDraft((current) => ({ ...current, cells: { ...current.cells, [tripId]: cellFromInput(raw) } }));
  const setAdded = (key: string, patch: Partial<AddedDraft>) =>
    setDraft((current) => ({ ...current, added: current.added.map((row) => (row.key === key ? { ...row, ...patch } : row)) }));

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  // Where typing starts: the operator when Avail has nobody for the block,
  // otherwise the first trip still blank, otherwise the first trip.
  useEffect(() => {
    if (readOnly) return;
    const form = root.current;
    if (!form) return;
    const blank = blankRequiredTrips(sheet, draft)[0];
    const target = !prefill
      ? form.querySelector<HTMLInputElement>("[data-operator]")
      : (blank && form.querySelector<HTMLInputElement>(`[data-trip="${CSS.escape(blank)}"]`)) || form.querySelector<HTMLInputElement>("[data-trip]");
    target?.focus();
    // Only when a sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet.service_date, sheet.block]);

  // The Save button stays focusable while saving (aria-disabled, not
  // disabled): a disabled button drops focus, and keys typed during the save
  // would then land wherever the browser put it.
  async function save() {
    if (readOnly || saving) return;
    const { save: body, problems: found } = saveFromDraft(sheet, draft);
    if (!body) {
      setProblems(found.map((p) => p.message));
      const first = found[0]?.target;
      const target = first?.startsWith("added:")
        ? root.current?.querySelector<HTMLInputElement>(`[data-added="${CSS.escape(first.slice(6))}"]`)
        : first ? root.current?.querySelector<HTMLInputElement>(`[data-trip="${CSS.escape(first)}"]`) : null;
      target?.focus();
      return;
    }
    setSaving(true);
    setProblems([]);
    setConflict(null);
    try {
      const saved = await api.saveRidershipSheet(sheet.service_date, sheet.block, body);
      onSaved(saved);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setConflict(error.message);
      } else if (error instanceof ApiError && Array.isArray(error.details)) {
        setProblems((error.details as { message: string }[]).map((d) => d.message));
      } else {
        setProblems([error instanceof Error && error.message ? error.message : "The sheet could not be saved."]);
      }
    } finally {
      setSaving(false);
    }
  }

  function onFormKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void save();
    }
  }

  function onFlowKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      focusNext(root.current, event.currentTarget);
    }
  }

  function addRow() {
    if (!adding) return;
    setDraft((current) => ({ ...current, added: [...current.added, adding] }));
    setAdding(null);
  }

  return (
    <div className="ridership-form" ref={root} onKeyDown={onFormKey}>
      {nav}
      <header className="ridership-form-head">
        <div>
          <span className="ridership-eyebrow">Count Sheet · {formatServiceDate(sheet.service_date)} · {garageName(sheet.garage)}</span>
          <h3>Block {sheet.block}</h3>
        </div>
        <span className={`ridership-pill is-${STATE_TONE[sheet.state]}`}>{STATE_LABEL[sheet.state]}</span>
      </header>

      <fieldset className="ridership-who" disabled={readOnly}>
        <legend className="sr-only">Operator and bus</legend>
        <label>Operator
          <input data-operator data-flow={prefill ? undefined : true} value={draft.operator_name} onKeyDown={prefill ? undefined : onFlowKey}
            onChange={(e) => set({ operator_name: e.target.value })} />
        </label>
        <label>Operator ID
          <input data-flow={prefill ? undefined : true} value={draft.operator_id} onKeyDown={prefill ? undefined : onFlowKey}
            onChange={(e) => set({ operator_id: e.target.value })} />
        </label>
        <label>Bus
          <input data-flow={prefill ? undefined : true} value={draft.bus} onKeyDown={prefill ? undefined : onFlowKey}
            onChange={(e) => set({ bus: e.target.value })} />
        </label>
        <div className="ridership-source">
          {!prefill ? <span className="ridership-pill is-warn">No Avail pull-out for this block · type it from the sheet</span>
            : overridden ? <span className="ridership-pill is-accent">Changed from Avail ({prefill.operator_name ?? "no name"}, bus {prefill.bus ?? "none"})</span>
            : <span className="ridership-pill is-muted">From Avail's pull-out, run {prefill.run}</span>}
          {!readOnly && sheet.pullout.other_runs.length > 0 && <span className="ridership-runs">
            Relief on this block:{" "}
            {[prefill, ...sheet.pullout.other_runs].filter((r) => r !== null).map((r) => (
              <button key={r.run} type="button" className="ridership-link"
                onClick={() => set({ operator_name: r.operator_name ?? "", operator_id: r.operator_id ?? "", bus: r.bus ?? "" })}>
                run {r.run}: {r.operator_name ?? "no name"}{r.bus ? ` · bus ${r.bus}` : ""}
              </button>
            ))}
          </span>}
        </div>
      </fieldset>

      <div className="ridership-scroll"><table className="ridership-trips">
        <thead>
          <tr><th>Trip</th><th>Route</th><th>Dir</th><th>Dispatch Log</th><th className="num">Boardings</th><th /></tr>
        </thead>
        <tbody>
          {sheet.trips.map((trip) => {
            const cell = draft.cells[trip.trip_id] ?? "";
            const meaning = cellMeaning(cell);
            return (
              <tr key={trip.trip_id} className={trip.required ? undefined : "is-excused"}>
                {/* Named as the paper sheet and Access name it; the GTFS id is the key underneath. */}
                <td className="ridership-trip">
                  <span className="ridership-trip-time">{timeSpan(trip.scheduled_start_seconds, trip.scheduled_end_seconds)}</span>
                  <span className="ridership-trip-id mono" title="GTFS trip ID">{trip.trip_id}</span>
                </td>
                <td>{trip.route_short_name ?? "-"}</td>
                <td>{directionLetter(trip.direction_label)}</td>
                <td>{trip.excused_reason ? EXCUSED_LABEL[trip.excused_reason] : START_STATUS_LABEL[trip.start_status]}</td>
                <td className="num">
                  <input data-flow data-trip={trip.trip_id} aria-label={`Boardings, ${trip.route_short_name ?? "route ?"} ${directionLetter(trip.direction_label)} ${clock(trip.scheduled_start_seconds)}`} inputMode="numeric" autoComplete="off"
                    className={meaning ? "is-letter" : undefined} value={cell} disabled={readOnly}
                    placeholder={trip.required ? "" : "-"} onKeyDown={onFlowKey} onChange={(e) => setCell(trip.trip_id, e.target.value)} />
                </td>
                <td className="ridership-dim">{meaning ?? (trip.required ? "" : "No count needed")}</td>
              </tr>
            );
          })}
          {draft.added.map((row) => (
            <tr key={row.key} className="is-added">
              <td>
                <span className="ridership-pill is-accent">Unscheduled</span>
                <input aria-label="Start time" className="ridership-short" value={row.start} disabled={readOnly} onChange={(e) => setAdded(row.key, { start: e.target.value })} />
              </td>
              <td><input aria-label="Route" className="ridership-short" value={row.route} disabled={readOnly} onChange={(e) => setAdded(row.key, { route: e.target.value })} /></td>
              <td>
                <select aria-label="Direction" value={row.direction} disabled={readOnly} onChange={(e) => setAdded(row.key, { direction: e.target.value })}>
                  {DIRECTIONS.map((d) => <option key={d}>{d}</option>)}
                </select>
              </td>
              <td>
                <select aria-label="Reason" value={row.reason} disabled={readOnly} onChange={(e) => setAdded(row.key, { reason: e.target.value as RidershipAddedTripReason })}>
                  {REASONS.map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}
                </select>
              </td>
              <td className="num">
                <input data-flow data-added={row.key} aria-label={`Boardings, unscheduled route ${row.route || "trip"}`} inputMode="numeric" autoComplete="off"
                  className={cellMeaning(row.cell) ? "is-letter" : undefined} value={row.cell} disabled={readOnly}
                  onKeyDown={onFlowKey} onChange={(e) => setAdded(row.key, { cell: cellFromInput(e.target.value, false) })} />
              </td>
              <td>{!readOnly && <button type="button" className="ridership-link"
                onClick={() => setDraft((current) => ({ ...current, added: current.added.filter((r) => r.key !== row.key) }))}>Remove</button>}</td>
            </tr>
          ))}
        </tbody>
      </table></div>

      {!readOnly && (adding ? (
        <div className="ridership-add" role="group" aria-label="Add an unscheduled trip"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); addRow(); } }}>
          <label>Route<input autoFocus className="ridership-short" value={adding.route} onChange={(e) => setAdding({ ...adding, route: e.target.value })} /></label>
          <label>Dir
            <select value={adding.direction} onChange={(e) => setAdding({ ...adding, direction: e.target.value })}>
              {DIRECTIONS.map((d) => <option key={d}>{d}</option>)}
            </select>
          </label>
          <label>Start<input className="ridership-short" placeholder="7:30 PM" value={adding.start} onChange={(e) => setAdding({ ...adding, start: e.target.value })} /></label>
          <label>Reason
            <select value={adding.reason} onChange={(e) => setAdding({ ...adding, reason: e.target.value as RidershipAddedTripReason })}>
              {REASONS.map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}
            </select>
          </label>
          <label>Boardings<input className="ridership-short" inputMode="numeric" value={adding.cell} onChange={(e) => setAdding({ ...adding, cell: cellFromInput(e.target.value, false) })} /></label>
          <button type="button" className="ridership-secondary" onClick={addRow}>Add</button>
          <button type="button" className="ridership-link" onClick={() => setAdding(null)}>Cancel</button>
        </div>
      ) : (
        <button type="button" className="ridership-link ridership-add-open" onClick={() => setAdding(emptyAdded())}>+ Add an unscheduled trip from the sheet</button>
      ))}

      <footer className="ridership-form-foot">
        <label className="ridership-check">
          <input type="checkbox" checked={draft.reconstructed} disabled={readOnly} onChange={(e) => set({ reconstructed: e.target.checked })} />
          Sheet marked <strong>Reconstructed</strong>
        </label>
        <span className="ridership-dim">Due by {dueLabel(sheet.service_date)}</span>
        {!readOnly && <button type="button" data-save className="ridership-primary" aria-disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save · next sheet"}
        </button>}
      </footer>
      {problems.length > 0 && <div className="ridership-problems" role="alert">
        {problems.map((p) => <p key={p}>{p}</p>)}
      </div>}
      {conflict && <div className="ridership-problems" role="alert">
        <p>{conflict}</p>
        <button type="button" className="ridership-secondary" onClick={onReload}>Reload the sheet</button>
      </div>}
      {sheet.header?.entered_by && <p className="ridership-dim">
        First entered by {sheet.header.entered_by}{sheet.header.updated_by && sheet.header.updated_by !== sheet.header.entered_by ? `, last changed by ${sheet.header.updated_by}` : ""}.
      </p>}
    </div>
  );
}
