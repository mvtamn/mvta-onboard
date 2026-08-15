import { useEffect, useState } from "react";
import { type DetourFulfillmentMode, type DetourIntake, type DetourSegmentInput } from "@mvta/shared";
import { api } from "../config.js";

const MODES: { value: DetourFulfillmentMode; label: string }[] = [
  { value: "fixed_route_manual", label: "Fixed-route manual" },
  { value: "mobility_manual", label: "Mobility manual" },
  { value: "avail", label: "Avail-backed" },
];

export function DetourIntake() {
  const [rows, setRows] = useState<DetourIntake[]>([]);
  const [source, setSource] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [segments, setSegments] = useState<DetourSegmentInput[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try { setRows((await api.getDetourIntake("pending_review")).intake); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not load intake"); }
  }
  useEffect(() => { void load(); }, []);

  async function create() {
    setBusy(true); setError(null);
    try {
      await api.createDetourIntake({
        detection_source: source, description, location: location || null,
        proposed_start_date: start || null, proposed_end_date: end || null,
        segments,
      });
      setSource(""); setDescription(""); setLocation(""); setStart(""); setEnd(""); setSegments([]);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not create intake"); }
    finally { setBusy(false); }
  }

  async function promote(row: DetourIntake) {
    const mode = window.prompt("Fulfillment mode: avail, fixed_route_manual, or mobility_manual", "fixed_route_manual") as DetourFulfillmentMode | null;
    if (!mode || !MODES.some((item) => item.value === mode)) return;
    setBusy(true); setError(null);
    try { await api.promoteDetourIntake(row.id, mode, { start_date: row.proposed_start_date, end_date: row.proposed_end_date }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not promote intake"); }
    finally { setBusy(false); }
  }

  async function reject(row: DetourIntake, status: "rejected" | "duplicate") {
    const decision_notes = window.prompt(
      status === "rejected" ? "Why is this intake being rejected?" : "Why is this intake a duplicate?",
    );
    if (!decision_notes?.trim()) return;
    const input: Parameters<typeof api.reviewDetourIntake>[1] = { status, decision_notes };
    if (status === "duplicate") {
      const target = window.prompt("Enter the existing Detour or intake GUID this duplicates");
      if (!target?.trim()) return;
      input.duplicate_of_detour_id = target.trim();
    }
    try { await api.reviewDetourIntake(row.id, input); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not review intake"); }
  }

  return <section className="panel">
    <div className="panel-header">Detour intake</div>
    <div className="panel-body">
      <p className="muted">Capture preliminary reports before they become authoritative Detours.</p>
      {error && <p className="error-text">{error}</p>}
      <div className="subcard">
        <h3>New intake report</h3>
        <div className="form-grid">
          <label>Detection source<input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Contractor, police, field report…" /></label>
          <label>Location<input value={location} onChange={(e) => setLocation(e.target.value)} /></label>
          <label className="form-grid-wide">Description<textarea value={description} onChange={(e) => setDescription(e.target.value)} /></label>
          <label>Proposed start<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label>Proposed end<input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
          <div className="form-grid-wide">
            <p className="field-label">Impacted route segments</p>
            {segments.map((segment, index) => <div key={index} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              <input value={segment.routes} placeholder="Routes / directions" onChange={(e) => setSegments((current) => current.map((item, i) => i === index ? { ...item, routes: e.target.value } : item))} />
              <input value={segment.directions ?? ""} placeholder="Turn-by-turn or operating notes" onChange={(e) => setSegments((current) => current.map((item, i) => i === index ? { ...item, directions: e.target.value || null } : item))} />
              <button type="button" className="btn-sm" onClick={() => setSegments((current) => current.filter((_, i) => i !== index))}>Remove</button>
            </div>)}
            <button type="button" className="btn-sm" onClick={() => setSegments((current) => [...current, { routes: "", directions: null }])}>Add segment</button>
          </div>
        </div>
        <button className="btn-primary" disabled={busy || !source.trim() || !description.trim()} onClick={() => void create()}>Log intake</button>
      </div>
      <h3>Pending review</h3>
      {rows.length === 0 ? <p className="muted">No pending intake reports.</p> : <div className="table-wrap"><table className="data"><thead><tr><th>Source</th><th>Description</th><th>Window</th><th>Impact</th><th>Actions</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.detection_source}</td><td>{row.description}<br /><span className="muted">{row.location}</span></td><td>{row.proposed_start_date || "—"} → {row.proposed_end_date || "open"}</td><td>{row.segments.length ? row.segments.map((segment) => segment.routes).join("; ") : "—"}</td><td><button className="btn-sm" disabled={busy} onClick={() => void promote(row)}>Promote</button>{" "}<button className="btn-sm" disabled={busy} onClick={() => void reject(row, "duplicate")}>Duplicate</button>{" "}<button className="btn-sm" disabled={busy} onClick={() => void reject(row, "rejected")}>Reject</button></td></tr>)}</tbody></table></div>}
    </div>
  </section>;
}
