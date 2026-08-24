import { useEffect, useMemo, useState } from "react";
import { type DetourFulfillmentMode, type DetourImage, type DetourIntake, type DetourSegmentInput } from "@mvta/shared";
import { api } from "../config.js";

const MODES: { value: DetourFulfillmentMode; label: string; help: string }[] = [
  { value: "fixed_route_manual", label: "Manual fixed-route exception", help: "Operations and operators carry out the reviewed instructions manually." },
  { value: "mobility_manual", label: "Manual mobility communication", help: "Mobility Operations and operators receive the reviewed service-area instructions." },
  { value: "avail", label: "Enter in Avail", help: "A human will enter the reviewed fixed-route Detour into Avail; OnBoard never writes it automatically." },
];

type ReviewAction = "accept" | "needs_information" | "duplicate" | "rejected";

export function DetourIntake() {
  const [rows, setRows] = useState<DetourIntake[]>([]);
  const [source, setSource] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [windowStatus, setWindowStatus] = useState<"pending" | "estimated" | "confirmed">("pending");
  const [affectedStops, setAffectedStops] = useState("");
  const [operationalImpacts, setOperationalImpacts] = useState("");
  const [confirmationContact, setConfirmationContact] = useState("");
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
  const [reviewing, setReviewing] = useState<{ row: DetourIntake; action: ReviewAction } | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [duplicateTarget, setDuplicateTarget] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [savedIntakeId, setSavedIntakeId] = useState<string | null>(null);

  async function load() {
    try { setRows((await api.getDetourIntake("pending_review")).intake); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not load intake"); }
  }
  useEffect(() => { void load(); }, []);

  const missing = useMemo(() => [
    !source.trim() ? "Add the detection source" : null,
    !description.trim() ? "Describe the closure or detour" : null,
    !instructions.trim() ? "Add action instructions" : null,
    !audiences.trim() ? "Name the required audiences" : null,
    !channels.trim() ? "Name the required channels" : null,
    impact === "fixed_route" && segments.length === 0 ? "Add at least one impacted route segment" : null,
    impact === "mobility" && !serviceArea.trim() ? "Add the mobility service area or zone" : null,
  ].filter((item): item is string => Boolean(item)), [source, description, instructions, audiences, channels, impact, segments, serviceArea]);

  function resetForm() {
    setSource(""); setDescription(""); setLocation(""); setStart(""); setEnd(""); setSegments([]);
    setStartTime(""); setEndTime(""); setWindowStatus("pending"); setAffectedStops(""); setOperationalImpacts(""); setConfirmationContact(""); setFiles([]); setSavedIntakeId(null);
    setImpact("fixed_route"); setServiceArea(""); setInstructions(""); setFulfillment("avail");
    setAudiences("operators, operations management"); setChannels("email, radio"); setEvidenceNotes(""); setEvidenceReference("");
  }

  async function uploadFiles(intakeId: string) {
    for (const file of files) {
      const contentType = file.type || "application/octet-stream";
      const { upload_url, blob_path } = await api.getDetourIntakeImageUploadUrl(intakeId, file.name, contentType, file.size);
      const response = await fetch(upload_url, { method: "PUT", headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": contentType }, body: file });
      if (!response.ok) throw new Error(`Supporting-file upload failed (${response.status})`);
      await api.createDetourIntakeImage(intakeId, { blob_path, file_name: file.name, content_type: contentType, size_bytes: file.size });
    }
  }

  async function create() {
    if (missing.length) return;
    setBusy(true); setError(null);
    let intakeId = savedIntakeId;
    try {
      if (!intakeId) {
        const intake = await api.createDetourIntake({
          detection_source: source, description, location: location || null,
          proposed_start_date: start || null, proposed_end_date: end || null, proposed_start_time: startTime || null, proposed_end_time: endTime || null, time_window_status: windowStatus,
          affected_stops_and_stations: affectedStops || null, operational_impacts: operationalImpacts || null, confirmation_contact: confirmationContact || null,
          service_impact: impact, service_area: impact === "mobility" ? serviceArea : null,
          action_instructions: instructions, proposed_fulfillment_mode: fulfillment,
          notification_audiences: audiences.split(",").map((item) => item.trim()).filter(Boolean),
          notification_channels: channels.split(",").map((item) => item.trim()).filter(Boolean),
          evidence_notes: evidenceNotes || null, evidence_reference: evidenceReference || null, segments,
        });
        intakeId = intake.id;
      }
      await uploadFiles(intakeId);
      resetForm(); await load();
    } catch (err) {
      if (intakeId) { setSavedIntakeId(intakeId); await load(); }
      setError(intakeId ? `Intake saved, but its supporting files were not all uploaded. Correct the issue and retry; a second intake will not be created. ${err instanceof Error ? err.message : ""}` : err instanceof Error ? err.message : "Could not create intake");
    }
    finally { setBusy(false); }
  }

  function openReview(row: DetourIntake, action: ReviewAction) {
    setReviewing({ row, action }); setReviewNotes(""); setDuplicateTarget(""); setError(null);
  }

  async function submitReview() {
    if (!reviewing) return;
    const { row, action } = reviewing;
    if (action !== "accept" && !reviewNotes.trim()) return;
    if (action === "duplicate" && !duplicateTarget.trim()) return;
    setBusy(true); setError(null);
    try {
      if (action === "accept") {
        const mode = row.proposed_fulfillment_mode;
        if (!mode || !MODES.some((item) => item.value === mode)) throw new Error("Choose a valid fulfillment path before accepting.");
        await api.promoteDetourIntake(row.id, mode, { start_date: row.proposed_start_date, end_date: row.proposed_end_date });
      } else {
        await api.reviewDetourIntake(row.id, {
          status: action,
          decision_notes: reviewNotes.trim(),
          ...(action === "duplicate" ? { duplicate_of_detour_id: duplicateTarget.trim() } : {}),
        });
      }
      setReviewing(null); await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save review decision"); }
    finally { setBusy(false); }
  }

  const selectedMode = MODES.find((mode) => mode.value === fulfillment);

  return <section className="panel">
    <div className="panel-header">Detour Intake</div>
    <div className="panel-body">
      <p className="panel-desc">Create the complete operational Detour once. OCC review, fulfillment, communication, and reporting stay connected to this record.</p>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="subcard">
        <h3>New Detour Intake</h3>
        <div className="form-section">
          <h4>Situation</h4><p>Capture what happened, where it applies, and the proposed operating window.</p>
          <div className="form-grid">
            <label>Detection source<input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Contractor, police, field report…" required /></label>
            <label>Location<input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Street, stop, facility, or landmark" /></label>
            <label className="form-grid-wide">Closure or detour description<textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is closed or changing?" required /></label>
            <label>Window status<select value={windowStatus} onChange={(e) => setWindowStatus(e.target.value as "pending" | "estimated" | "confirmed")}><option value="pending">Pending confirmation</option><option value="estimated">Estimated</option><option value="confirmed">Confirmed</option></select></label>
            <label>Proposed start<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
            <label>Start time<input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></label>
            <label>Proposed end<input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
            <label>End time<input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></label>
          </div>
        </div>
        <div className="form-section">
          <h4>Affected service</h4><p>Choose the service type; the form will request only the operational details that apply.</p>
          <div className="form-grid">
            <label>Service impact<select value={impact} onChange={(e) => { const next = e.target.value as "fixed_route" | "mobility"; setImpact(next); setFulfillment(next === "mobility" ? "mobility_manual" : "avail"); }}><option value="fixed_route">Fixed-route</option><option value="mobility">On-demand / mobility</option></select></label>
            <label>Proposed fulfillment<select value={fulfillment} onChange={(e) => setFulfillment(e.target.value as DetourFulfillmentMode)}>{MODES.filter((mode) => impact === "mobility" ? mode.value === "mobility_manual" : mode.value !== "mobility_manual").map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}</select></label>
            {selectedMode && <p className="form-grid-wide muted">{selectedMode.help}</p>}
            {impact === "mobility" ? <label className="form-grid-wide">Service area / zone<input value={serviceArea} onChange={(e) => setServiceArea(e.target.value)} placeholder="Mobility service area or zone" required /></label> : null}
            {impact === "fixed_route" ? <div className="form-grid-wide"><p className="field-label">Impacted route segments <span className="hint">at least one required</span></p>{segments.map((segment, index) => <div key={index} className="form-grid-segment"><input value={segment.routes} placeholder="Routes / stops" onChange={(e) => setSegments((current) => current.map((item, i) => i === index ? { ...item, routes: e.target.value } : item))} /><input value={segment.directions ?? ""} placeholder="Directions or operating notes" onChange={(e) => setSegments((current) => current.map((item, i) => i === index ? { ...item, directions: e.target.value || null } : item))} /><button type="button" className="btn-sm" onClick={() => setSegments((current) => current.filter((_, i) => i !== index))}>Remove</button></div>)}<button type="button" className="btn-sm" onClick={() => setSegments((current) => [...current, { routes: "", directions: null }])}>Add segment</button></div> : null}
            <label className="form-grid-wide">Affected stops and stations<textarea value={affectedStops} onChange={(e) => setAffectedStops(e.target.value)} placeholder="Stops, stations, platforms, or transfer points affected" /></label>
          </div>
        </div>
        <div className="form-section">
          <h4>Instructions and communications</h4><p>Write the action people carrying out the Detour must take and identify every required audience/channel.</p>
          <div className="form-grid">
            <label className="form-grid-wide">Action instructions<textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="What should operators, Operations, or enforcement do?" required /></label>
            <label className="form-grid-wide">Operational impacts<textarea value={operationalImpacts} onChange={(e) => setOperationalImpacts(e.target.value)} placeholder="Layover, restroom, staging, accessibility, or other operating impacts" /></label>
            <label>Confirmation source or contact<input value={confirmationContact} onChange={(e) => setConfirmationContact(e.target.value)} placeholder="Project contact, phone, or expected update" /></label>
            <label>Required audiences<input value={audiences} onChange={(e) => setAudiences(e.target.value)} placeholder="Comma-separated audiences" required /></label>
            <label>Required channels<input value={channels} onChange={(e) => setChannels(e.target.value)} placeholder="Comma-separated channels" required /></label>
          </div>
        </div>
        <div className="form-section">
          <h4>Evidence</h4><p>Preserve the supporting record so the reviewer can verify the report.</p>
          <div className="form-grid"><label className="form-grid-wide">Evidence notes<textarea value={evidenceNotes} onChange={(e) => setEvidenceNotes(e.target.value)} placeholder="What documentation supports this report?" /></label><label className="form-grid-wide">Evidence reference<input value={evidenceReference} onChange={(e) => setEvidenceReference(e.target.value)} placeholder="Case number or reference link" /></label><label className="form-grid-wide">Supporting files<input type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,text/plain" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} /><small>{files.length ? `${files.length} file${files.length === 1 ? "" : "s"} will be retained with this intake.` : "Attach the source email/PDF, maps, photos, or other supporting documents."}</small></label></div>
        </div>
        <div className="intake-checklist" aria-live="polite"><strong>{missing.length ? `${missing.length} items remaining before submission` : "Complete intake ready for submission"}</strong>{missing.length ? <ul>{missing.map((item) => <li key={item}>{item}</li>)}</ul> : <div className="is-complete">All required operational facts are present. OCC review starts after submission.</div>}</div>
        <div className="intake-form-actions"><span className="muted">Submitted records start in Pending OCC review.</span><button className="btn-primary" disabled={busy || missing.length > 0} onClick={() => void create()}>{savedIntakeId ? "Retry supporting-file upload" : "Submit complete Detour Intake"}</button></div>
      </div>
      <h3>Pending OCC review <span className="chip">{rows.length}</span></h3>
      {rows.length === 0 ? <p className="muted">No pending intake reports.</p> : <div className="table-wrap"><table className="data"><thead><tr><th>Situation</th><th>Window</th><th>Affected service</th><th>Next path</th><th>Actions</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.description}</strong><br /><span className="td-subtle">{row.detection_source} · {row.location || "Location not recorded"}</span><br /><span className="td-subtle">{row.action_instructions || "Instructions missing"}</span></td><td>{row.proposed_start_date || "—"} → {row.proposed_end_date || "open"}</td><td>{row.service_impact === "mobility" ? row.service_area || "Mobility area missing" : row.segments.length ? row.segments.map((segment) => segment.routes).join("; ") : "Route segments missing"}</td><td>{MODES.find((mode) => mode.value === row.proposed_fulfillment_mode)?.label || "Not selected"}</td><td><button className="btn-sm" disabled={busy} onClick={() => openReview(row, "accept")}>Accept &amp; continue</button>{" "}<button className="btn-sm" disabled={busy} onClick={() => openReview(row, "needs_information")}>Needs information</button>{" "}<button className="btn-sm" disabled={busy} onClick={() => openReview(row, "duplicate")}>Duplicate</button>{" "}<button className="btn-sm" disabled={busy} onClick={() => openReview(row, "rejected")}>Reject</button></td></tr>)}</tbody></table></div>}
    </div>
    {reviewing ? <div className="modal-overlay" role="presentation"><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="detour-review-title"><div className="modal-card-header"><div><span className="eyebrow">Review Detour Intake</span><h2 id="detour-review-title">{reviewing.row.description}</h2></div><button className="btn-icon" aria-label="Close review" onClick={() => setReviewing(null)}>×</button></div><p className="muted">{reviewing.row.location || "Location not recorded"} · {reviewing.row.proposed_start_date || "No start date"} {reviewing.row.proposed_start_time || ""} → {reviewing.row.proposed_end_date || "open"} {reviewing.row.proposed_end_time || ""} · {reviewing.row.time_window_status || "pending"}</p><div className="intake-checklist"><strong>Operational details</strong><ul><li>{reviewing.row.affected_stops_and_stations || "No affected stops or stations recorded."}</li><li>{reviewing.row.operational_impacts || "No additional operational impacts recorded."}</li><li>{reviewing.row.confirmation_contact || "No confirmation contact recorded."}</li></ul></div><IntakeImages intakeId={reviewing.row.id} />{reviewing.action === "accept" ? <div className="event-next-action"><div><span className="event-next-action-label">Acceptance boundary</span><strong>Make this same record authoritative</strong><p>Acceptance assigns the next fulfillment step. It does not enter Avail or publish communications.</p></div></div> : <>{reviewing.action === "duplicate" ? <label className="modal-field">Existing Detour or intake ID<input value={duplicateTarget} onChange={(e) => setDuplicateTarget(e.target.value)} placeholder="GUID of the existing record" autoFocus /></label> : null}<label className="modal-field">{reviewing.action === "needs_information" ? "Information still needed" : reviewing.action === "duplicate" ? "Why is this a duplicate?" : "Rejection reason"}<textarea value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} placeholder="Record the reason for this decision" autoFocus={reviewing.action !== "duplicate"} /></label></>}<div className="modal-actions"><button className="btn-sm" onClick={() => setReviewing(null)}>Cancel</button><button className="btn-primary" disabled={busy || (reviewing.action !== "accept" && !reviewNotes.trim()) || (reviewing.action === "duplicate" && !duplicateTarget.trim())} onClick={() => void submitReview()}>{reviewing.action === "accept" ? "Accept record" : reviewing.action === "needs_information" ? "Return for information" : reviewing.action === "duplicate" ? "Mark duplicate" : "Reject record"}</button></div></section></div> : null}
  </section>;
}

function IntakeImages({ intakeId }: { intakeId: string }) {
  const [images, setImages] = useState<DetourImage[] | null>(null);
  useEffect(() => { void api.getDetourIntakeImages(intakeId).then(({ images }) => setImages(images)).catch(() => setImages([])); }, [intakeId]);
  if (images === null) return <p className="muted">Loading supporting files…</p>;
  if (images.length === 0) return <p className="muted">No supporting files attached.</p>;
  return <div className="intake-checklist"><strong>Supporting files</strong><ul>{images.map((image) => <li key={image.id}>{image.read_url ? <a href={image.read_url} target="_blank" rel="noreferrer">{image.file_name}</a> : image.file_name}</li>)}</ul></div>;
}
