import { useEffect, useMemo, useState } from "react";
import { type CreateDetourIntakeInput, type DetourFulfillmentMode, type DetourImage, type DetourIntake, type DetourIntakeStatus, type DetourLikelyDuplicate, type DetourSegmentInput } from "@mvta/shared";
import { api } from "../config.js";
import { dateTimeLabel } from "../lib/detourDates.js";
import { DETOUR_ATTACHMENT_ACCEPT, isImageAttachment } from "../components/DetourAttachments.js";
import { DetourMap } from "../components/DetourMap.js";

const MODES: { value: DetourFulfillmentMode; label: string; help: string }[] = [
  { value: "fixed_route_manual", label: "Manual fixed-route exception", help: "Operations and operators carry out the reviewed instructions manually." },
  { value: "mobility_manual", label: "Manual mobility communication", help: "Mobility Operations and operators receive the reviewed service-area instructions." },
  { value: "avail", label: "Enter in Avail", help: "A human will enter the reviewed fixed-route Detour into Avail; OnBoard never writes it automatically." },
];

type ReviewAction = "accept" | "needs_information" | "duplicate" | "rejected" | "withdrawn";

// The queue is split by what the record is waiting on. Pending rows wait on
// OCC; returned rows wait on whoever filed them to add what was asked for;
// decided rows are the audit trail. Everything comes from one unfiltered
// GET so the counts in the tabs and the rows under them never disagree.
type QueueTab = "pending_review" | "needs_information" | "decided";
const QUEUE_TABS: { key: QueueTab; label: string }[] = [
  { key: "pending_review", label: "Pending OCC review" },
  { key: "needs_information", label: "Needs information" },
  { key: "decided", label: "Decided" },
];
const DECIDED: readonly DetourIntakeStatus[] = ["accepted", "rejected", "duplicate", "withdrawn"];
const STATUS_LABELS: Record<DetourIntakeStatus, string> = {
  draft: "Draft",
  pending_review: "Pending OCC review",
  needs_information: "Returned for information",
  accepted: "Accepted",
  rejected: "Rejected",
  duplicate: "Duplicate",
  withdrawn: "Withdrawn",
};

interface IntakeFormState {
  source: string; description: string; location: string;
  start: string; end: string; startTime: string; endTime: string;
  windowStatus: "pending" | "estimated" | "confirmed";
  affectedStops: string; operationalImpacts: string; confirmationContact: string;
  impact: "fixed_route" | "mobility"; serviceArea: string; instructions: string;
  fulfillment: DetourFulfillmentMode; audiences: string; channels: string;
  evidenceNotes: string; evidenceReference: string; segments: DetourSegmentInput[];
  geometry: string | null;
}

const BLANK_FORM: IntakeFormState = {
  source: "", description: "", location: "", start: "", end: "", startTime: "", endTime: "", windowStatus: "pending",
  affectedStops: "", operationalImpacts: "", confirmationContact: "", impact: "fixed_route", serviceArea: "", instructions: "",
  fulfillment: "avail", audiences: "operators, operations management", channels: "email, radio", evidenceNotes: "", evidenceReference: "", segments: [],
  geometry: null,
};

// Loads an existing record into the form for correction. The list already
// carries HH:MM times and YYYY-MM-DD dates, which is exactly what the time
// and date inputs accept.
function intakeToForm(row: DetourIntake): IntakeFormState {
  return {
    source: row.detection_source, description: row.description, location: row.location ?? "",
    start: row.proposed_start_date ?? "", end: row.proposed_end_date ?? "",
    startTime: row.proposed_start_time ?? "", endTime: row.proposed_end_time ?? "",
    windowStatus: row.time_window_status ?? "pending",
    affectedStops: row.affected_stops_and_stations ?? "", operationalImpacts: row.operational_impacts ?? "", confirmationContact: row.confirmation_contact ?? "",
    impact: row.service_impact ?? "fixed_route", serviceArea: row.service_area ?? "", instructions: row.action_instructions ?? "",
    fulfillment: row.proposed_fulfillment_mode ?? (row.service_impact === "mobility" ? "mobility_manual" : "avail"),
    audiences: (row.notification_audiences ?? []).join(", "), channels: (row.notification_channels ?? []).join(", "),
    evidenceNotes: row.evidence_notes ?? "", evidenceReference: row.evidence_reference ?? "",
    segments: row.segments.map((segment) => ({ routes: segment.routes, directions: segment.directions ?? null })),
    geometry: row.geometry_json ?? null,
  };
}

function formToInput(f: IntakeFormState): CreateDetourIntakeInput {
  return {
    detection_source: f.source, description: f.description, location: f.location || null,
    proposed_start_date: f.start || null, proposed_end_date: f.end || null, proposed_start_time: f.startTime || null, proposed_end_time: f.endTime || null, time_window_status: f.windowStatus,
    affected_stops_and_stations: f.affectedStops || null, operational_impacts: f.operationalImpacts || null, confirmation_contact: f.confirmationContact || null,
    service_impact: f.impact, service_area: f.impact === "mobility" ? f.serviceArea : null,
    action_instructions: f.instructions, proposed_fulfillment_mode: f.fulfillment,
    notification_audiences: f.audiences.split(",").map((item) => item.trim()).filter(Boolean),
    notification_channels: f.channels.split(",").map((item) => item.trim()).filter(Boolean),
    evidence_notes: f.evidenceNotes || null, evidence_reference: f.evidenceReference || null, segments: f.segments,
    geometry_json: f.geometry,
  };
}

export function DetourIntake() {
  const [rows, setRows] = useState<DetourIntake[]>([]);
  const [tab, setTab] = useState<QueueTab>("pending_review");
  const [form, setForm] = useState<IntakeFormState>(BLANK_FORM);
  // The open record being corrected, or null for a new report.
  const [editing, setEditing] = useState<DetourIntake | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<{ row: DetourIntake; action: ReviewAction } | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [duplicateTarget, setDuplicateTarget] = useState("");
  // Which record type the duplicate target GUID names; picking a likely
  // duplicate sets both, typing a GUID by hand assumes a Detour.
  const [duplicateKind, setDuplicateKind] = useState<"detour" | "intake">("detour");
  const [files, setFiles] = useState<File[]>([]);
  const [savedIntakeId, setSavedIntakeId] = useState<string | null>(null);

  async function load() {
    try { setRows((await api.getDetourIntake()).intake); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not load intake"); }
  }
  useEffect(() => { void load(); }, []);

  const set = <K extends keyof IntakeFormState>(key: K, value: IntakeFormState[K]) => setForm((current) => ({ ...current, [key]: value }));

  const missing = useMemo(() => [
    !form.source.trim() ? "Add the detection source" : null,
    !form.description.trim() ? "Describe the closure or detour" : null,
    !form.instructions.trim() ? "Add action instructions" : null,
    !form.audiences.trim() ? "Name the required audiences" : null,
    !form.channels.trim() ? "Name the required channels" : null,
    form.impact === "fixed_route" && form.segments.length === 0 ? "Add at least one impacted route segment" : null,
    form.impact === "mobility" && !form.serviceArea.trim() ? "Add the mobility service area or zone" : null,
  ].filter((item): item is string => Boolean(item)), [form]);

  function resetForm() {
    setForm(BLANK_FORM); setEditing(null); setFiles([]); setSavedIntakeId(null);
  }

  function startEdit(row: DetourIntake) {
    setEditing(row); setForm(intakeToForm(row)); setFiles([]); setSavedIntakeId(null); setError(null); setNotice(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
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

  async function submit() {
    if (missing.length) return;
    setBusy(true); setError(null); setNotice(null);
    let intakeId = savedIntakeId;
    try {
      if (!intakeId) {
        if (editing) {
          const result = await api.updateDetourIntake(editing.id, formToInput(form));
          intakeId = editing.id;
          setNotice(result.resubmitted ? "Intake updated and returned to the OCC review queue." : "Intake updated.");
        } else {
          intakeId = (await api.createDetourIntake(formToInput(form))).id;
        }
      }
      await uploadFiles(intakeId);
      resetForm(); await load();
    } catch (err) {
      if (intakeId) { setSavedIntakeId(intakeId); await load(); }
      setError(intakeId ? `Intake saved, but its supporting files were not all uploaded. Correct the issue and retry; a second intake will not be created. ${err instanceof Error ? err.message : ""}` : err instanceof Error ? err.message : "Could not save intake");
    }
    finally { setBusy(false); }
  }

  function openReview(row: DetourIntake, action: ReviewAction) {
    setReviewing({ row, action }); setReviewNotes(""); setDuplicateTarget(""); setDuplicateKind("detour"); setError(null);
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
          ...(action === "duplicate" ? (duplicateKind === "intake" ? { duplicate_of_intake_id: duplicateTarget.trim() } : { duplicate_of_detour_id: duplicateTarget.trim() }) : {}),
        });
      }
      setReviewing(null); await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save review decision"); }
    finally { setBusy(false); }
  }

  const selectedMode = MODES.find((mode) => mode.value === form.fulfillment);
  const counts: Record<QueueTab, number> = {
    pending_review: rows.filter((row) => row.status === "pending_review").length,
    needs_information: rows.filter((row) => row.status === "needs_information").length,
    decided: rows.filter((row) => DECIDED.includes(row.status)).length,
  };
  const visible = rows.filter((row) => tab === "decided" ? DECIDED.includes(row.status) : row.status === tab);
  const resubmitting = editing?.status === "needs_information";

  return <section className="panel">
    <div className="panel-header">Detour Intake</div>
    <div className="panel-body">
      <p className="panel-desc">Create the complete operational Detour once. OCC review, fulfillment, communication, and reporting stay connected to this record.</p>
      {error && <p className="error-text" role="alert">{error}</p>}
      {notice && <p className="muted" role="status">{notice}</p>}
      <div className="subcard">
        <h3>{editing ? (resubmitting ? "Update and resubmit Detour Intake" : "Update Detour Intake") : "New Detour Intake"}</h3>
        {resubmitting && editing ? <div className="intake-checklist"><strong>Information OCC asked for</strong><p>{editing.decision_notes || "No specific request was recorded."}</p><span className="td-subtle">Returned by {editing.reviewed_by || "OCC"}{editing.reviewed_at ? ` · ${dateTimeLabel(editing.reviewed_at)}` : ""}</span></div> : null}
        <div className="form-section">
          <h4>Situation</h4><p>Capture what happened, where it applies, and the proposed operating window.</p>
          <div className="form-grid">
            <label>Detection source<input value={form.source} onChange={(e) => set("source", e.target.value)} placeholder="Contractor, police, field report…" required /></label>
            <label>Location<input value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="Street, stop, facility, or landmark" /></label>
            <label className="form-grid-wide">Closure or detour description<textarea value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="What is closed or changing?" required /></label>
            <label>Window status<select value={form.windowStatus} onChange={(e) => set("windowStatus", e.target.value as IntakeFormState["windowStatus"])}><option value="pending">Pending confirmation</option><option value="estimated">Estimated</option><option value="confirmed">Confirmed</option></select></label>
            <label>Proposed start<input type="date" value={form.start} onChange={(e) => set("start", e.target.value)} /></label>
            <label>Start time<input type="time" value={form.startTime} onChange={(e) => set("startTime", e.target.value)} /></label>
            <label>Proposed end<input type="date" value={form.end} onChange={(e) => set("end", e.target.value)} /></label>
            <label>End time<input type="time" value={form.endTime} onChange={(e) => set("endTime", e.target.value)} /></label>
          </div>
        </div>
        <div className="form-section">
          <h4>Map</h4><p>Draw where the closure is - a stop, a street, or an area - then find the GTFS stops it touches and add them, with the routes that serve them, to the affected service below. Optional; the drawing is carried onto the Detour at acceptance.</p>
          <DetourMap
            value={form.geometry}
            onChange={(geometry) => set("geometry", geometry)}
            onSuggest={({ stops, routes }) => {
              const stopText = stops.map((s) => `${s.stop_name} (#${s.stop_id})`).join("; ");
              const existingRoutes = new Set(form.segments.map((seg) => seg.routes.trim()).filter(Boolean));
              const newSegments = routes.filter((r) => !existingRoutes.has(r)).map((r) => ({ routes: r, directions: null }));
              setForm((current) => ({
                ...current,
                affectedStops: [current.affectedStops.trim(), stopText].filter(Boolean).join("; "),
                segments: current.impact === "fixed_route" ? [...current.segments, ...newSegments] : current.segments,
              }));
              setNotice(`Added ${stops.length} stop${stops.length === 1 ? "" : "s"}${newSegments.length ? ` and ${newSegments.length} route segment${newSegments.length === 1 ? "" : "s"}` : ""} from the map.`);
            }}
          />
        </div>
        <div className="form-section">
          <h4>Affected service</h4><p>Choose the service type; the form will request only the operational details that apply.</p>
          <div className="form-grid">
            <label>Service impact<select value={form.impact} onChange={(e) => { const next = e.target.value as IntakeFormState["impact"]; setForm((current) => ({ ...current, impact: next, fulfillment: next === "mobility" ? "mobility_manual" : "avail" })); }}><option value="fixed_route">Fixed-route</option><option value="mobility">On-demand / mobility</option></select></label>
            <label>Proposed fulfillment<select value={form.fulfillment} onChange={(e) => set("fulfillment", e.target.value as DetourFulfillmentMode)}>{MODES.filter((mode) => form.impact === "mobility" ? mode.value === "mobility_manual" : mode.value !== "mobility_manual").map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}</select></label>
            {selectedMode && <p className="form-grid-wide muted">{selectedMode.help}</p>}
            {form.impact === "mobility" ? <label className="form-grid-wide">Service area / zone<input value={form.serviceArea} onChange={(e) => set("serviceArea", e.target.value)} placeholder="Mobility service area or zone" required /></label> : null}
            {form.impact === "fixed_route" ? <div className="form-grid-wide"><p className="field-label">Impacted route segments <span className="hint">at least one required</span></p>{form.segments.map((segment, index) => <div key={index} className="form-grid-segment"><input value={segment.routes} placeholder="Routes / stops" onChange={(e) => set("segments", form.segments.map((item, i) => i === index ? { ...item, routes: e.target.value } : item))} /><input value={segment.directions ?? ""} placeholder="Directions or operating notes" onChange={(e) => set("segments", form.segments.map((item, i) => i === index ? { ...item, directions: e.target.value || null } : item))} /><button type="button" className="btn-sm" onClick={() => set("segments", form.segments.filter((_, i) => i !== index))}>Remove</button></div>)}<button type="button" className="btn-sm" onClick={() => set("segments", [...form.segments, { routes: "", directions: null }])}>Add segment</button></div> : null}
            <label className="form-grid-wide">Affected stops and stations<textarea value={form.affectedStops} onChange={(e) => set("affectedStops", e.target.value)} placeholder="Stops, stations, platforms, or transfer points affected" /></label>
          </div>
        </div>
        <div className="form-section">
          <h4>Instructions and communications</h4><p>Write the action people carrying out the Detour must take and identify every required audience/channel.</p>
          <div className="form-grid">
            <label className="form-grid-wide">Action instructions<textarea value={form.instructions} onChange={(e) => set("instructions", e.target.value)} placeholder="What should operators, Operations, or enforcement do?" required /></label>
            <label className="form-grid-wide">Operational impacts<textarea value={form.operationalImpacts} onChange={(e) => set("operationalImpacts", e.target.value)} placeholder="Layover, restroom, staging, accessibility, or other operating impacts" /></label>
            <label>Confirmation source or contact<input value={form.confirmationContact} onChange={(e) => set("confirmationContact", e.target.value)} placeholder="Project contact, phone, or expected update" /></label>
            <label>Required audiences<input value={form.audiences} onChange={(e) => set("audiences", e.target.value)} placeholder="Comma-separated audiences" required /></label>
            <label>Required channels<input value={form.channels} onChange={(e) => set("channels", e.target.value)} placeholder="Comma-separated channels" required /></label>
          </div>
        </div>
        <div className="form-section">
          <h4>Evidence</h4><p>Preserve the supporting record so the reviewer can verify the report.</p>
          <div className="form-grid"><label className="form-grid-wide">Evidence notes<textarea value={form.evidenceNotes} onChange={(e) => set("evidenceNotes", e.target.value)} placeholder="What documentation supports this report?" /></label><label className="form-grid-wide">Evidence reference<input value={form.evidenceReference} onChange={(e) => set("evidenceReference", e.target.value)} placeholder="Case number or reference link" /></label><label className="form-grid-wide">Supporting files<input type="file" accept={DETOUR_ATTACHMENT_ACCEPT} multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} /><small>{files.length ? `${files.length} file${files.length === 1 ? "" : "s"} will be retained with this intake.` : editing ? "Files already attached stay with the record; add more here if needed." : "Attach the source email/PDF, maps, photos, or other supporting documents."}</small></label></div>
          {editing ? <IntakeImages intakeId={editing.id} /> : null}
        </div>
        <div className="intake-checklist" aria-live="polite"><strong>{missing.length ? `${missing.length} items remaining before submission` : "Complete intake ready for submission"}</strong>{missing.length ? <ul>{missing.map((item) => <li key={item}>{item}</li>)}</ul> : <div className="is-complete">All required operational facts are present. OCC review starts after submission.</div>}</div>
        <div className="intake-form-actions">
          <span className="muted">{resubmitting ? "Saving returns this record to Pending OCC review." : editing ? "Saving keeps this record in Pending OCC review." : "Submitted records start in Pending OCC review."}</span>
          <span>
            {editing ? <button className="btn-sm" disabled={busy} onClick={resetForm}>Cancel update</button> : null}{" "}
            <button className="btn-primary" disabled={busy || missing.length > 0} onClick={() => void submit()}>{savedIntakeId ? "Retry supporting-file upload" : resubmitting ? "Save and resubmit for review" : editing ? "Save changes" : "Submit complete Detour Intake"}</button>
          </span>
        </div>
      </div>

      <div className="occ-switch" style={{ marginTop: 18 }}>
        {QUEUE_TABS.map((item) => <button key={item.key} className={tab === item.key ? "active" : ""} onClick={() => setTab(item.key)}>{item.label} <span className="chip">{counts[item.key]}</span></button>)}
      </div>
      {visible.length === 0 ? <p className="muted">{tab === "pending_review" ? "No intake reports waiting on OCC." : tab === "needs_information" ? "No intake reports waiting on more information." : "No decided intake reports yet."}</p> : (
        <div className="table-wrap"><table className="data">
          <thead><tr><th>Situation</th><th>Window</th><th>Affected service</th><th>{tab === "decided" ? "Decision" : tab === "needs_information" ? "Information needed" : "Next path"}</th><th>Actions</th></tr></thead>
          <tbody>{visible.map((row) => <tr key={row.id}>
            <td><strong>{row.description}</strong><br /><span className="td-subtle">{row.detection_source} · {row.location || "Location not recorded"}</span><br /><span className="td-subtle">{row.action_instructions || "Instructions missing"}</span>{tab === "pending_review" && row.decision_notes ? <><br /><span className="td-subtle">Resubmitted after: {row.decision_notes}</span></> : null}{row.likely_duplicates?.length ? <><br /><span className="warn-note">⚠ {row.likely_duplicates.length} likely duplicate{row.likely_duplicates.length === 1 ? "" : "s"} — review before deciding</span></> : null}</td>
            <td>{row.proposed_start_date || "—"} → {row.proposed_end_date || "open"}</td>
            <td>{row.service_impact === "mobility" ? row.service_area || "Mobility area missing" : row.segments.length ? row.segments.map((segment) => segment.routes).join("; ") : "Route segments missing"}</td>
            <td>{tab === "pending_review"
              ? (MODES.find((mode) => mode.value === row.proposed_fulfillment_mode)?.label || "Not selected")
              : <><strong>{STATUS_LABELS[row.status]}</strong>{row.decision_notes ? <><br /><span className="td-subtle">{row.decision_notes}</span></> : null}<br /><span className="td-subtle">{row.reviewed_by || "—"}{row.reviewed_at ? ` · ${dateTimeLabel(row.reviewed_at)}` : ""}</span>{row.status === "accepted" && row.promoted_detour_id ? <><br /><span className="td-subtle">Detour {row.promoted_detour_id}</span></> : null}{row.status === "duplicate" && (row.duplicate_of_detour_id || row.duplicate_of_intake_id) ? <><br /><span className="td-subtle">Duplicate of {row.duplicate_of_detour_id || row.duplicate_of_intake_id}</span></> : null}</>}</td>
            <td>{tab === "pending_review" ? <>
              <button className="btn-sm" disabled={busy} onClick={() => openReview(row, "accept")}>Accept &amp; continue</button>{" "}
              <button className="btn-sm" disabled={busy} onClick={() => startEdit(row)}>Edit</button>{" "}
              <button className="btn-sm" disabled={busy} onClick={() => openReview(row, "needs_information")}>Needs information</button>{" "}
              <button className="btn-sm" disabled={busy} onClick={() => openReview(row, "duplicate")}>Duplicate</button>{" "}
              <button className="btn-sm" disabled={busy} onClick={() => openReview(row, "rejected")}>Reject</button>
            </> : tab === "needs_information" ? <>
              <button className="btn-sm" disabled={busy} onClick={() => startEdit(row)}>Update &amp; resubmit</button>{" "}
              <button className="btn-sm" disabled={busy} onClick={() => openReview(row, "withdrawn")}>Withdraw</button>{" "}
              <button className="btn-sm" disabled={busy} onClick={() => openReview(row, "duplicate")}>Duplicate</button>{" "}
              <button className="btn-sm" disabled={busy} onClick={() => openReview(row, "rejected")}>Reject</button>
            </> : <span className="td-subtle">Decided records are read-only.</span>}</td>
          </tr>)}</tbody>
        </table></div>
      )}
    </div>
    {reviewing ? <div className="modal-overlay" role="presentation"><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="detour-review-title"><div className="modal-card-header"><div><span className="eyebrow">Review Detour Intake</span><h2 id="detour-review-title">{reviewing.row.description}</h2></div><button className="btn-icon" aria-label="Close review" onClick={() => setReviewing(null)}>×</button></div><p className="muted">{reviewing.row.location || "Location not recorded"} · {reviewing.row.proposed_start_date || "No start date"} {reviewing.row.proposed_start_time || ""} → {reviewing.row.proposed_end_date || "open"} {reviewing.row.proposed_end_time || ""} · {reviewing.row.time_window_status || "pending"}</p><div className="intake-checklist"><strong>Operational details</strong><ul><li>{reviewing.row.affected_stops_and_stations || "No affected stops or stations recorded."}</li><li>{reviewing.row.operational_impacts || "No additional operational impacts recorded."}</li><li>{reviewing.row.confirmation_contact || "No confirmation contact recorded."}</li></ul></div><IntakeImages intakeId={reviewing.row.id} />{reviewing.row.geometry_json ? <DetourMap value={reviewing.row.geometry_json} onChange={() => undefined} readOnly height={240} /> : null}<LikelyDuplicates row={reviewing.row} onPick={(match) => { setReviewing({ row: reviewing.row, action: "duplicate" }); setDuplicateTarget(match.id); setDuplicateKind(match.kind); }} />{reviewing.action === "accept" ? <div className="event-next-action"><div><span className="event-next-action-label">Acceptance boundary</span><strong>Make this same record authoritative</strong><p>Acceptance assigns the next fulfillment step. It does not enter Avail or publish communications.</p></div></div> : <>{reviewing.action === "duplicate" ? <label className="modal-field">Existing {duplicateKind === "intake" ? "intake" : "Detour"} ID<input value={duplicateTarget} onChange={(e) => { setDuplicateTarget(e.target.value); setDuplicateKind("detour"); }} placeholder="Pick a likely duplicate above, or paste the GUID of the existing Detour" autoFocus /></label> : null}<label className="modal-field">{reviewing.action === "needs_information" ? "Information still needed" : reviewing.action === "duplicate" ? "Why is this a duplicate?" : reviewing.action === "withdrawn" ? "Why is this report being withdrawn?" : "Rejection reason"}<textarea value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} placeholder="Record the reason for this decision" autoFocus={reviewing.action !== "duplicate"} /></label></>}<div className="modal-actions"><button className="btn-sm" onClick={() => setReviewing(null)}>Cancel</button><button className="btn-primary" disabled={busy || (reviewing.action !== "accept" && !reviewNotes.trim()) || (reviewing.action === "duplicate" && !duplicateTarget.trim())} onClick={() => void submitReview()}>{reviewing.action === "accept" ? "Accept record" : reviewing.action === "needs_information" ? "Return for information" : reviewing.action === "duplicate" ? "Mark duplicate" : reviewing.action === "withdrawn" ? "Withdraw record" : "Reject record"}</button></div></section></div> : null}
  </section>;
}

// The reviewer's duplicate warning. Lists what overlapped and why, with
// the shared route numbers or place words, and lets the reviewer mark the
// intake duplicate of one directly instead of finding and pasting its GUID.
function LikelyDuplicates({ row, onPick }: { row: DetourIntake; onPick: (match: DetourLikelyDuplicate) => void }) {
  const matches = row.likely_duplicates ?? [];
  if (matches.length === 0) return <p className="muted">No likely duplicates found among open Detours and intake.</p>;
  return <div className="intake-checklist" role="region" aria-label="Likely duplicates">
    <strong>⚠ {matches.length} likely duplicate{matches.length === 1 ? "" : "s"}</strong>
    <p className="td-subtle">Same {matches.some((m) => m.reasons.includes("geometry")) ? "place on the map" : matches.some((m) => m.reasons.includes("routes")) ? "routes" : "location"} in an overlapping window. This is a warning for review; nothing is merged or rejected automatically.</p>
    <ul>{matches.map((match) => <li key={`${match.kind}-${match.id}`}>
      <strong>{match.label}</strong> <span className="td-subtle">({match.kind === "detour" ? "Detour" : "Intake"} · {match.status.replace(/_/g, " ")} · {match.start_date || "open"} → {match.end_date || "open"})</span>
      <br /><span className="td-subtle">Shares {match.reasons.map((r) => r === "geometry" ? "map location" : r === "routes" ? "routes" : "location").join(" and ")}: {match.shared.join(", ")}</span>
      {" "}<button type="button" className="btn-sm" onClick={() => onPick(match)}>Mark duplicate of this</button>
    </li>)}</ul>
  </div>;
}

function IntakeImages({ intakeId }: { intakeId: string }) {
  const [images, setImages] = useState<DetourImage[] | null>(null);
  useEffect(() => { void api.getDetourIntakeImages(intakeId).then(({ images }) => setImages(images)).catch(() => setImages([])); }, [intakeId]);
  if (images === null) return <p className="muted">Loading supporting files…</p>;
  if (images.length === 0) return <p className="muted">No supporting files attached.</p>;
  return <div className="intake-checklist"><strong>Supporting files</strong><ul>{images.map((image) => <li key={image.id}>{image.read_url ? <a href={image.read_url} target="_blank" rel="noreferrer">{isImageAttachment(image) ? <img src={image.read_url} alt="" style={{ height: 28, width: 28, objectFit: "cover", borderRadius: 4, verticalAlign: "middle", marginRight: 6 }} /> : null}{image.file_name}</a> : image.file_name}</li>)}</ul></div>;
}
