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
  const [impact, setImpact] = useState<"fixed_route" | "mobility">("fixed_route");
  const [serviceArea, setServiceArea] = useState("");
  const [instructions, setInstructions] = useState("");
  const [fulfillment, setFulfillment] = useState<DetourFulfillmentMode>("avail");
  const [audiences, setAudiences] = useState("operators, operations management");
  const [channels, setChannels] = useState("email, radio");
  const [evidenceNotes, setEvidenceNotes] = useState("");
  const [evidenceReference, setEvidenceReference] = useState("");
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
        service_impact: impact,
        service_area: impact === "mobility" ? serviceArea : null,
        action_instructions: instructions,
        proposed_fulfillment_mode: fulfillment,
        notification_audiences: audiences.split(",").map((item) => item.trim()).filter(Boolean),
        notification_channels: channels.split(",").map((item) => item.trim()).filter(Boolean),
        evidence_notes: evidenceNotes || null,
        evidence_reference: evidenceReference || null,
        segments,
      });
      setSource(""); setDescription(""); setLocation(""); setStart(""); setEnd(""); setSegments([]);
      setImpact("fixed_route"); setServiceArea(""); setInstructions(""); setFulfillment("avail");
      setAudiences("operators, operations management"); setChannels("email, radio"); setEvidenceNotes(""); setEvidenceReference("");
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not create intake"); }
    finally { setBusy(false); }
  }

  async function promote(row: DetourIntake) {
    const mode = row.proposed_fulfillment_mode;
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

  async function requestInformation(row: DetourIntake) {
    const decision_notes = window.prompt("What information is still needed?");
    if (!decision_notes?.trim()) return;
    try { await api.reviewDetourIntake(row.id, { status: "needs_information", decision_notes }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not return intake for information"); }
  }

  return <section className="panel">
    <div className="panel-header">Detour Intake</div>
    <div className="panel-body">
      <p className="muted">Submit the complete operational Detour once. OCC review and the next fulfillment step stay on this record.</p>
      {error && <p className="error-text">{error}</p>}
      <div className="subcard">
        <h3>New intake report</h3>
        <div className="form-grid">
          <label>Detection source<input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Contractor, police, field report…" /></label>
          <label>Location<input value={location} onChange={(e) => setLocation(e.target.value)} /></label>
          <label className="form-grid-wide">Description<textarea value={description} onChange={(e) => setDescription(e.target.value)} /></label>
          <label>Proposed start<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label>Proposed end<input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
          <label>Service impact<select value={impact} onChange={(e) => { const next = e.target.value as "fixed_route" | "mobility"; setImpact(next); setFulfillment(next === "mobility" ? "mobility_manual" : "avail"); }}><option value="fixed_route">Fixed-route</option><option value="mobility">On-demand / mobility</option></select></label>
          <label>Proposed fulfillment<select value={fulfillment} onChange={(e) => setFulfillment(e.target.value as DetourFulfillmentMode)}>{MODES.filter((mode) => impact === "mobility" ? mode.value === "mobility_manual" : mode.value !== "mobility_manual").map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}</select></label>
          {impact === "mobility" ? <label className="form-grid-wide">Service area / zone<input value={serviceArea} onChange={(e) => setServiceArea(e.target.value)} placeholder="Mobility service area or zone" /></label> : null}
          <label className="form-grid-wide">Action instructions<textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="What should operators, Operations, or enforcement do?" /></label>
          {impact === "fixed_route" ? <div className="form-grid-wide">
            <p className="field-label">Impacted route segments</p>
            {segments.map((segment, index) => <div key={index} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              <input value={segment.routes} placeholder="Routes / directions" onChange={(e) => setSegments((current) => current.map((item, i) => i === index ? { ...item, routes: e.target.value } : item))} />
              <input value={segment.directions ?? ""} placeholder="Turn-by-turn or operating notes" onChange={(e) => setSegments((current) => current.map((item, i) => i === index ? { ...item, directions: e.target.value || null } : item))} />
              <button type="button" className="btn-sm" onClick={() => setSegments((current) => current.filter((_, i) => i !== index))}>Remove</button>
            </div>)}
            <button type="button" className="btn-sm" onClick={() => setSegments((current) => [...current, { routes: "", directions: null }])}>Add segment</button>
          </div> : null}
          <label>Required audiences<input value={audiences} onChange={(e) => setAudiences(e.target.value)} placeholder="Comma-separated audiences" /></label>
          <label>Required channels<input value={channels} onChange={(e) => setChannels(e.target.value)} placeholder="Comma-separated channels" /></label>
          <label className="form-grid-wide">Evidence notes<textarea value={evidenceNotes} onChange={(e) => setEvidenceNotes(e.target.value)} placeholder="What documentation supports this report?" /></label>
          <label className="form-grid-wide">Evidence reference<input value={evidenceReference} onChange={(e) => setEvidenceReference(e.target.value)} placeholder="File name, case number, or reference link" /></label>
        </div>
        <button className="btn-primary" disabled={busy || !source.trim() || !description.trim() || !instructions.trim() || !audiences.trim() || !channels.trim() || (impact === "fixed_route" && segments.length === 0) || (impact === "mobility" && !serviceArea.trim())} onClick={() => void create()}>Submit complete Detour Intake</button>
      </div>
      <h3>Pending review</h3>
      {rows.length === 0 ? <p className="muted">No pending intake reports.</p> : <div className="table-wrap"><table className="data"><thead><tr><th>Source</th><th>Description</th><th>Window</th><th>Impact</th><th>Next path</th><th>Actions</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.detection_source}</td><td>{row.description}<br /><span className="muted">{row.location}</span><br /><span className="muted">{row.action_instructions || "No action instructions"}</span></td><td>{row.proposed_start_date || "—"} → {row.proposed_end_date || "open"}</td><td>{row.service_impact === "mobility" ? row.service_area || "Mobility" : row.segments.length ? row.segments.map((segment) => segment.routes).join("; ") : "Fixed-route details missing"}</td><td>{row.proposed_fulfillment_mode || "—"}</td><td><button className="btn-sm" disabled={busy} onClick={() => void promote(row)}>Accept &amp; continue</button>{" "}<button className="btn-sm" disabled={busy} onClick={() => void requestInformation(row)}>Needs information</button>{" "}<button className="btn-sm" disabled={busy} onClick={() => void reject(row, "duplicate")}>Duplicate</button>{" "}<button className="btn-sm" disabled={busy} onClick={() => void reject(row, "rejected")}>Reject</button></td></tr>)}</tbody></table></div>}
    </div>
  </section>;
}
