// Administration › Ridership setup (spec §5, §10): the block → garage list
// Planning keeps each service change. The worklist's completeness by garage
// reads it, and a block with no garage shows as Unassigned so the gap is
// visible rather than silent. Rows are dated: a service change's list applies
// from its first day and leaves earlier service dates as they were.
import { useEffect, useMemo, useState } from "react";
import { ApiError, type RidershipBlockGarageList } from "@mvta/shared";
import { api } from "../config.js";
import { garageChanges, rowInForce } from "../lib/ridership.js";
import "./modules/serviceRisk.css";
import "./modules/ridership/ridership.css";

const todayCentral = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

function loadError(error: unknown): string {
  if (error instanceof ApiError && error.status === 503) return "Ridership counting is not set up in this environment yet: migration 153 has not been applied.";
  return "The block → garage list could not be loaded.";
}

export function RidershipSetupAdmin() {
  const [list, setList] = useState<RidershipBlockGarageList | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [day, setDay] = useState(todayCentral);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [newBlock, setNewBlock] = useState("");
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

  // The form shows what is in force on the chosen day; a block typed over keeps what was typed.
  const valueOf = (block: string) => draft[block] ?? rowInForce(list?.rows ?? [], block, day)?.garage ?? "";
  const changes = list ? garageChanges(list.rows, Object.fromEntries(blocks.map((b) => [b, valueOf(b)])), day) : [];
  const unassigned = blocks.filter((b) => valueOf(b).trim() === "").length;

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

  async function save() {
    if (changes.length === 0 || saving) return;
    setSaving(true);
    setMessage(null);
    setProblems([]);
    try {
      const next = await api.saveRidershipBlockGarages({ effective_from: day, rows: changes });
      setList(next);
      setDraft({});
      setMessage(`${changes.length} block${changes.length === 1 ? "" : "s"} saved, in force from ${day}.`);
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
        <p>Which garage runs each block. Keep it each service change: the Ridership worklist groups its completeness by garage, and a block with no garage shows as Unassigned.</p>
      </div>
    </div>

    {failure && <p className="ridership-problems" role="alert">{failure}</p>}
    {!list && !failure && <p className="ridership-dim">Loading the block → garage list.</p>}

    {list && <>
      <div className="ridership-toolbar">
        <label className="ridership-range">
          <span className="ridership-eyebrow">In force from (first day of the service change)</span>
          <input type="date" value={day} onChange={(e) => { setDay(e.target.value); setDraft({}); setMessage(null); }} />
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

      <p>
        {blocks.length} block{blocks.length === 1 ? "" : "s"}
        {unassigned > 0 && <> · <span className="ridership-pill is-warn">{unassigned} unassigned</span></>}
      </p>

      <datalist id="ridership-garage-names">
        {list.garages.map((g) => <option key={g} value={g} />)}
      </datalist>
      <div className="ridership-scroll"><table className="ridership-list ridership-garage-table">
        <thead><tr><th>Block</th><th>Garage</th><th>Since</th></tr></thead>
        <tbody>
          {blocks.map((block) => {
            const inForce = rowInForce(list.rows, block, day);
            const changed = changes.some((c) => c.block === block);
            return (
              <tr key={block} className={changed ? "is-changed" : undefined}>
                <td className="mono">{block}</td>
                <td>
                  <input list="ridership-garage-names" aria-label={`Garage for block ${block}`} placeholder="Unassigned" value={valueOf(block)}
                    onChange={(e) => setDraft((current) => ({ ...current, [block]: e.target.value }))} />
                </td>
                <td className="ridership-dim">
                  {inForce ? `${inForce.effective_from} · ${inForce.updated_by}` : "Never assigned"}
                  {changed && " · changing"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
      {blocks.length === 0 && <p className="ridership-dim">The Dispatch Log has no blocks in the last two weeks, and the list is empty. Add blocks by number.</p>}

      <div className="ridership-form-foot">
        <span className="ridership-dim">
          {changes.length === 0 ? "No changes." : `${changes.length} change${changes.length === 1 ? "" : "s"}, in force from ${day}. Service dates before it keep the garage they had.`}
        </span>
        <button type="button" className="ridership-primary" disabled={changes.length === 0 || saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save the list"}
        </button>
      </div>
      {message && <p className="ridership-toast" role="status">{message}</p>}
      {problems.length > 0 && <div className="ridership-problems" role="alert">{problems.map((p) => <p key={p}>{p}</p>)}</div>}
    </>}
  </div>;
}
