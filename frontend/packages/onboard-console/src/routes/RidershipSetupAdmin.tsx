// Administration › Ridership setup (spec §5, §10): the block → garage list
// Planning keeps each service change. The worklist's completeness by garage
// and the per-garage print stacks read it, and a block with no garage shows
// as Unassigned so the gap is visible rather than silent. Rows are dated: a
// service change's list applies from its first day and leaves earlier service
// dates as they were. A block keeps its garage from one service change to the
// next until someone changes it, so the work is setting many blocks at once:
// pick the garage from a list, select blocks (by checkbox, shift-click or a
// typed range) and assign them together.
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { ApiError, type RidershipBlockGarageList } from "@mvta/shared";
import { api } from "../config.js";
import { garageChanges, garageOptions, parseBlockSelection, rowInForce } from "../lib/ridership.js";
import "./modules/serviceRisk.css";
import "./modules/ridership/ridership.css";

const todayCentral = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

/** "" in the filter and the draft is Unassigned. */
type Filter = "all" | string;

function loadError(error: unknown): string {
  if (error instanceof ApiError && error.status === 503) return "Ridership counting is not set up in this environment yet: migration 153 has not been applied.";
  return "The block → garage list could not be loaded.";
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function RidershipSetupAdmin() {
  const [list, setList] = useState<RidershipBlockGarageList | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [day, setDay] = useState(todayCentral);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [newBlock, setNewBlock] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  useEffect(() => {
    api.getRidershipBlockGarages().then(setList).catch((error) => setFailure(loadError(error)));
  }, []);

  // Every block the Dispatch Log ran lately or runs tomorrow, and every block
  // the list already names, so a block that stopped running is still editable.
  const blocks = useMemo(() => {
    if (!list) return [];
    return [...new Set([...list.recent_blocks, ...list.rows.map((r) => r.block), ...Object.keys(draft)])].sort();
  }, [list, draft]);
  const garages = useMemo(() => garageOptions(list?.garages ?? []), [list]);

  // The form shows what is in force on the chosen day; a block changed here keeps the change.
  const valueOf = (block: string) => draft[block] ?? rowInForce(list?.rows ?? [], block, day)?.garage ?? "";
  const changes = list ? garageChanges(list.rows, Object.fromEntries(blocks.map((b) => [b, valueOf(b)])), day) : [];
  const countOf = (garage: string) => blocks.filter((b) => valueOf(b) === garage).length;
  const unassigned = countOf("");
  const shown = filter === "all" ? blocks : blocks.filter((b) => valueOf(b) === filter);
  const shownSelected = shown.filter((b) => selected.has(b));
  const allShownSelected = shown.length > 0 && shownSelected.length === shown.length;

  function resetFeedback() {
    setMessage(null);
    setProblems([]);
  }

  function addBlock() {
    const block = newBlock.trim();
    if (!/^\d{1,3}$/.test(block)) {
      setProblems(["A block is a number of up to three digits."]);
      return;
    }
    setProblems([]);
    setNewBlock("");
    const padded = block.padStart(3, "0");
    // A block already listed keeps its row; a new one starts Unassigned.
    if (!blocks.includes(padded)) setDraft((current) => ({ ...current, [padded]: "" }));
  }

  // Shift-click selects every shown block between the last one clicked and this one.
  function toggle(block: string, event: MouseEvent<HTMLInputElement>) {
    const on = !selected.has(block);
    const next = new Set(selected);
    const from = anchor === null ? -1 : shown.indexOf(anchor);
    const to = shown.indexOf(block);
    if (event.shiftKey && from >= 0 && to >= 0) {
      for (const b of shown.slice(Math.min(from, to), Math.max(from, to) + 1)) {
        if (on) next.add(b); else next.delete(b);
      }
    } else if (on) {
      next.add(block);
    } else {
      next.delete(block);
    }
    setSelected(next);
    setAnchor(block);
  }

  function toggleAllShown() {
    const next = new Set(selected);
    for (const b of shown) {
      if (allShownSelected) next.delete(b); else next.add(b);
    }
    setSelected(next);
  }

  function selectTyped() {
    const wanted = parseBlockSelection(typed);
    if (!wanted) {
      setProblems(["Type block numbers and ranges, such as 1-69, 306, 309."]);
      return;
    }
    const listed = new Set(blocks);
    const found = wanted.filter((b) => listed.has(b));
    if (found.length === 0) {
      setProblems([`None of those blocks is listed. Add a block by number first if it is new.`]);
      return;
    }
    setProblems([]);
    setSelected(new Set([...selected, ...found]));
    setTyped("");
    // Selecting by number shows the whole list, so no selected block is hidden by the filter.
    setFilter("all");
  }

  function assignSelected(garage: string) {
    if (selected.size === 0) return;
    const chosen = [...selected];
    setDraft((current) => ({ ...current, ...Object.fromEntries(chosen.map((b) => [b, garage])) }));
    setSelected(new Set());
    setAnchor(null);
    setMessage(`${plural(chosen.length, "block")} set to ${garage || "Unassigned"}. Save the list to keep it.`);
    setProblems([]);
  }

  async function save() {
    if (changes.length === 0 || saving) return;
    setSaving(true);
    resetFeedback();
    try {
      const next = await api.saveRidershipBlockGarages({ effective_from: day, rows: changes });
      setList(next);
      setDraft({});
      setMessage(`${plural(changes.length, "block")} saved, in force from ${day}.`);
    } catch (error) {
      if (error instanceof ApiError && Array.isArray(error.details)) {
        setProblems((error.details as { message: string }[]).map((d) => d.message));
      } else {
        setProblems([error instanceof Error && error.message ? error.message : "The list could not be saved."]);
      }
    } finally {
      setSaving(false);
    }
  }

  return <div className="risk-module ridership-setup">
    <div className="risk-module-head">
      <div>
        <span className="risk-eyebrow">Administration · Service Setup</span>
        <h2>Ridership setup</h2>
        <p>Which garage runs each block. Each garage prints its own Count Sheets, and a block with no garage shows as Unassigned. A block keeps its garage from one service change to the next until you change it.</p>
      </div>
    </div>

    {failure && <p className="ridership-problems" role="alert">{failure}</p>}
    {!list && !failure && <p className="ridership-dim">Loading the block → garage list.</p>}

    {list && <>
      <div className="ridership-toolbar">
        <label className="ridership-range">
          <span className="ridership-eyebrow">In force from (first day of the service change)</span>
          <input type="date" value={day} onChange={(e) => { setDay(e.target.value); setDraft({}); resetFeedback(); }} />
        </label>
        <label className="ridership-range">
          <span className="ridership-eyebrow">Add a block not listed</span>
          <span className="ridership-inline">
            <input className="ridership-short" inputMode="numeric" value={newBlock} aria-label="Block number"
              onChange={(e) => setNewBlock(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addBlock(); } }} />
            <button type="button" className="ridership-secondary" onClick={addBlock}>Add</button>
          </span>
        </label>
      </div>

      <div className="ridership-garage-counts" role="group" aria-label="Show blocks">
        <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
          All <b>{blocks.length}</b>
        </button>
        {garages.map((g) => (
          <button key={g} type="button" aria-pressed={filter === g} onClick={() => setFilter(g)}>
            {g} <b>{countOf(g)}</b>
          </button>
        ))}
        <button type="button" aria-pressed={filter === ""} className={unassigned > 0 ? "is-warn" : undefined} onClick={() => setFilter("")}>
          Unassigned <b>{unassigned}</b>
        </button>
      </div>

      <div className="ridership-bulk">
        <label className="ridership-range">
          <span className="ridership-eyebrow">Select blocks by number</span>
          <span className="ridership-inline">
            <input value={typed} placeholder="1-69, 306, 309" aria-label="Blocks to select"
              onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); selectTyped(); } }} />
            <button type="button" className="ridership-secondary" onClick={selectTyped}>Select</button>
          </span>
        </label>
        <div className="ridership-bulk-assign" aria-live="polite">
          <span><b>{plural(selected.size, "block")}</b> selected{selected.size > 0 && <> · <button type="button" className="ridership-link" onClick={() => setSelected(new Set())}>clear</button></>}</span>
          <span className="ridership-inline">
            {garages.map((g) => (
              <button key={g} type="button" className="ridership-secondary" disabled={selected.size === 0} onClick={() => assignSelected(g)}>
                Assign to {g}
              </button>
            ))}
            <button type="button" className="ridership-link" disabled={selected.size === 0} onClick={() => assignSelected("")}>Make unassigned</button>
          </span>
        </div>
      </div>

      {/* Above the list, not below it: with 180 blocks the end of the table is a long way down. */}
      <div className="ridership-form-foot">
        <span className="ridership-dim">
          {changes.length === 0 ? "No changes." : `${plural(changes.length, "change")}, in force from ${day}. Service dates before it keep the garage they had.`}
        </span>
        <button type="button" className="ridership-primary" disabled={changes.length === 0 || saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save the list"}
        </button>
      </div>
      {message && <p className="ridership-toast" role="status">{message}</p>}
      {problems.length > 0 && <div className="ridership-problems" role="alert">{problems.map((p) => <p key={p}>{p}</p>)}</div>}
      <div className="ridership-scroll"><table className="ridership-list ridership-garage-table">
        <thead><tr>
          <th className="ridership-pick">
            <input type="checkbox" aria-label="Select every block shown" checked={allShownSelected} disabled={shown.length === 0}
              ref={(el) => { if (el) el.indeterminate = shownSelected.length > 0 && !allShownSelected; }}
              onChange={toggleAllShown} />
          </th>
          <th>Block</th><th>Garage</th><th>Since</th>
        </tr></thead>
        <tbody>
          {shown.map((block) => {
            const inForce = rowInForce(list.rows, block, day);
            const changed = changes.some((c) => c.block === block);
            const value = valueOf(block);
            return (
              <tr key={block} className={[changed && "is-changed", selected.has(block) && "is-selected"].filter(Boolean).join(" ") || undefined}>
                <td className="ridership-pick">
                  <input type="checkbox" aria-label={`Select block ${block}`} checked={selected.has(block)}
                    onClick={(e) => toggle(block, e)} onChange={() => undefined} />
                </td>
                <td className="mono">{block}</td>
                <td>
                  <select aria-label={`Garage for block ${block}`} value={value}
                    onChange={(e) => setDraft((current) => ({ ...current, [block]: e.target.value }))}>
                    <option value="">Unassigned</option>
                    {garages.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </td>
                <td className="ridership-dim">
                  {inForce?.garage ? `${inForce.effective_from} · ${inForce.updated_by}` : inForce ? `Unassigned since ${inForce.effective_from}` : "Never assigned"}
                  {changed && " · changing"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
      {blocks.length === 0 && <p className="ridership-dim">The Dispatch Log has no blocks in the last two weeks, and the list is empty. Add blocks by number.</p>}
      {blocks.length > 0 && shown.length === 0 && <p className="ridership-dim">No block is {filter === "" ? "unassigned" : `set to ${filter}`}.</p>}

    </>}
  </div>;
}
