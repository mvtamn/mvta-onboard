import { useEffect, useMemo, useState, type ReactNode } from "react";
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
  fulfillment: DetourFulfillmentMode; audiences: string[]; channels: string[];
  evidenceNotes: string; evidenceReference: string; segments: DetourSegmentInput[];
  geometry: string | null;
}

const KNOWN_CHANNELS = ["email", "radio", "Teams", "dispatch board"];

function splitList(text: string): string[] {
  return text.split(/[;,]/).map((item) => item.trim()).filter(Boolean);
}

const BLANK_FORM: IntakeFormState = {
  source: "", description: "", location: "", start: "", end: "", startTime: "", endTime: "", windowStatus: "pending",
  affectedStops: "", operationalImpacts: "", confirmationContact: "", impact: "fixed_route", serviceArea: "", instructions: "",
  fulfillment: "avail", audiences: ["operators", "operations management"], channels: ["email", "radio"], evidenceNotes: "", evidenceReference: "", segments: [],
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
    audiences: [...(row.notification_audiences ?? [])], channels: [...(row.notification_channels ?? [])],
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
    notification_audiences: f.audiences,
    notification_channels: f.channels,
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

  // Every required fact, with the section it lives in, so the readiness
  // rail can show progress and link straight to what is missing.
  const requirements = useMemo(() => [
    { key: "source", label: "Detection source", section: "situation", done: Boolean(form.source.trim()) },
    { key: "description", label: "Closure description", section: "situation", done: Boolean(form.description.trim()) },
    ...(form.impact === "fixed_route"
      ? [{ key: "segments", label: form.segments.length ? `Route segments (${form.segments.length})` : "Route segments", section: "service", done: form.segments.some((seg) => seg.routes.trim()) }]
      : [{ key: "area", label: "Mobility service area", section: "service", done: Boolean(form.serviceArea.trim()) }]),
    { key: "instructions", label: "Action instructions", section: "instructions", done: Boolean(form.instructions.trim()) },
    { key: "audiences", label: "Required audiences", section: "instructions", done: form.audiences.length > 0 },
    { key: "channels", label: "Required channels", section: "instructions", done: form.channels.length > 0 },
  ], [form]);
  const missing = useMemo(() => requirements.filter((r) => !r.done), [requirements]);
  const doneCount = requirements.length - missing.length;
  // Validation styling appears only after a submit attempt, so a fresh form
  // is not a wall of red.
  const [showErrors, setShowErrors] = useState(false);
  const invalid = (key: string) => showErrors && missing.some((r) => r.key === key);
  const sectionStatus = (section: string) => {
    const inSection = requirements.filter((r) => r.section === section);
    if (inSection.length === 0) return { label: "Optional", cls: "pill-muted" };
    const left = inSection.filter((r) => !r.done).length;
    return left === 0 ? { label: "Complete", cls: "pill-success" } : { label: `${left} required left`, cls: "pill-warning" };
  };

  function resetForm() {
    setForm(BLANK_FORM); setEditing(null); setFiles([]); setSavedIntakeId(null); setShowErrors(false);
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
    if (missing.length) { setShowErrors(true); return; }
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
      <div className="intake-layout">
        <div className="intake-form">
          <div className="intake-intro">
            <div>
              <span className="eyebrow">{editing ? (resubmitting ? "UPDATE AND RESUBMIT" : "UPDATE DETOUR INTAKE") : "NEW DETOUR INTAKE"}</span>
              <h3>Capture the closure once, completely</h3>
              <p>OCC review, fulfillment, communications, and reporting all read from this record. Fields marked <span className="req" style={{ color: "var(--danger-text)" }}>*</span> must be present before submission; everything else can be added after OCC returns the report.</p>
              {resubmitting && editing ? <div className="intake-returned" style={{ marginTop: 10 }}><strong>Information OCC asked for</strong>{editing.decision_notes || "No specific request was recorded."}<br /><span className="td-subtle">Returned by {editing.reviewed_by || "OCC"}{editing.reviewed_at ? ` · ${dateTimeLabel(editing.reviewed_at)}` : ""}</span></div> : null}
            </div>
            <div className="intake-intro-actions">
              {editing ? <button type="button" className="btn-sm" disabled={busy} onClick={resetForm}>Cancel update</button> : <button type="button" className="btn-sm" disabled={busy} onClick={resetForm}>Clear form</button>}
            </div>
          </div>

          {/* 1 · Situation */}
          <section className="intake-section" id="intake-situation" aria-labelledby="intake-situation-title">
            <div className="intake-section-head">
              <span className="intake-section-num" aria-hidden="true">1</span>
              <div><h4 id="intake-situation-title">Situation</h4><p>What happened, where it applies, and the proposed operating window.</p></div>
              <span className={`pill-sm intake-section-status ${sectionStatus("situation").cls}`}>{sectionStatus("situation").label}</span>
            </div>
            <div className="intake-section-body">
              <label className={`intake-field ${invalid("source") ? "is-invalid" : ""}`}>
                <span className="intake-field-label"><span>Detection source <span className="req">*</span></span></span>
                <input value={form.source} onChange={(e) => set("source", e.target.value)} placeholder="Contractor, police, field crew, public…" required />
                <span className={`intake-help ${invalid("source") ? "is-error" : ""}`}>{invalid("source") ? <><IconAlert />Required before submission.</> : "Who reported it."}</span>
              </label>
              <label className="intake-field">
                <span className="intake-field-label"><span>Location</span></span>
                <span className="intake-input-icon"><IconPin /><input value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="Street, stop, facility, or landmark" /></span>
                <span className="intake-help">Where the closure is. Drawing it on the map below is the surest way to record it.</span>
              </label>
              <label className={`intake-field intake-field-wide ${invalid("description") ? "is-invalid" : ""}`}>
                <span className="intake-field-label"><span>Closure or detour description <span className="req">*</span></span></span>
                <textarea value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="What is closed or changing?" required maxLength={1000} />
                <span className={`intake-help ${invalid("description") ? "is-error" : ""}`}>{invalid("description") ? <><IconAlert />Required before submission.</> : <><span>Plain language. This becomes the Detour's closure text on every communication.</span><span>{form.description.length} / 1000</span></>}</span>
              </label>
              <div className="intake-window" role="group" aria-labelledby="intake-window-title">
                <div className="intake-window-head">
                  <span id="intake-window-title">Proposed operating window</span>
                  <div className="seg" role="group" aria-label="Window status">
                    {(["pending", "estimated", "confirmed"] as const).map((status) => <button key={status} type="button" aria-pressed={form.windowStatus === status} onClick={() => set("windowStatus", status)}>{status === "pending" ? "Pending" : status === "estimated" ? "Estimated" : "Confirmed"}</button>)}
                  </div>
                </div>
                <div className="intake-window-grid">
                  <label className="intake-field">Start date<input type="date" value={form.start} onChange={(e) => set("start", e.target.value)} /></label>
                  <label className="intake-field">Start time<input type="time" value={form.startTime} onChange={(e) => set("startTime", e.target.value)} /></label>
                  <label className="intake-field">End date<input type="date" value={form.end} onChange={(e) => set("end", e.target.value)} /></label>
                  <label className="intake-field">End time<input type="time" value={form.endTime} onChange={(e) => set("endTime", e.target.value)} /></label>
                </div>
                <span className="intake-help">Leave the end date blank for until-further-notice. A <b>Confirmed</b> window requires a start date and time.</span>
              </div>
            </div>
          </section>

          {/* 2 · Map */}
          <section className="intake-section" id="intake-map" aria-labelledby="intake-map-title">
            <div className="intake-section-head">
              <span className="intake-section-num" aria-hidden="true">2</span>
              <div><h4 id="intake-map-title">Map</h4><p>Draw the closure, then pull in the stops it touches and the routes that serve them. Optional; the drawing is carried onto the Detour at acceptance.</p></div>
              <span className="pill-sm intake-section-status pill-muted">Optional</span>
            </div>
            <div style={{ padding: "16px 18px" }}>
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
          </section>

          {/* 3 · Affected service */}
          <section className="intake-section" id="intake-service" aria-labelledby="intake-service-title">
            <div className="intake-section-head">
              <span className="intake-section-num" aria-hidden="true">3</span>
              <div><h4 id="intake-service-title">Affected service</h4><p>The service type decides which details are asked for and which fulfillment paths apply.</p></div>
              <span className={`pill-sm intake-section-status ${sectionStatus("service").cls}`}>{sectionStatus("service").label}</span>
            </div>
            <div className="intake-section-body">
              <div className="intake-field">
                <span className="intake-field-label"><span>Service impact <span className="req">*</span></span></span>
                <div className="choice-cards" role="group" aria-label="Service impact">
                  <button type="button" className="choice-card" aria-pressed={form.impact === "fixed_route"} onClick={() => setForm((current) => ({ ...current, impact: "fixed_route", fulfillment: "avail" }))}><IconBus /><span><strong>Fixed-route</strong><small>Scheduled routes and stops</small></span></button>
                  <button type="button" className="choice-card" aria-pressed={form.impact === "mobility"} onClick={() => setForm((current) => ({ ...current, impact: "mobility", fulfillment: "mobility_manual" }))}><IconVan /><span><strong>On-demand / mobility</strong><small>Service area or zone</small></span></button>
                </div>
              </div>
              <label className="intake-field">
                <span className="intake-field-label"><span>Proposed fulfillment <span className="req">*</span></span></span>
                <select value={form.fulfillment} onChange={(e) => set("fulfillment", e.target.value as DetourFulfillmentMode)}>{MODES.filter((mode) => form.impact === "mobility" ? mode.value === "mobility_manual" : mode.value !== "mobility_manual").map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}</select>
                <span className="intake-help">{selectedMode?.help}</span>
              </label>
              {form.impact === "mobility" ? (
                <label className={`intake-field intake-field-wide ${invalid("area") ? "is-invalid" : ""}`}>
                  <span className="intake-field-label"><span>Service area / zone <span className="req">*</span></span></span>
                  <input value={form.serviceArea} onChange={(e) => set("serviceArea", e.target.value)} placeholder="Mobility service area or zone" required />
                  <span className={`intake-help ${invalid("area") ? "is-error" : ""}`}>{invalid("area") ? <><IconAlert />Required for mobility service.</> : "The zone Mobility Operations will communicate to."}</span>
                </label>
              ) : (
                <div className={`intake-field intake-field-wide ${invalid("segments") ? "is-invalid" : ""}`}>
                  <span className="intake-field-label"><span>Impacted route segments <span className="req">*</span> <span className="hint">at least one</span></span>{form.segments.length ? <span className="hint">{form.segments.length} segment{form.segments.length === 1 ? "" : "s"}</span> : null}</span>
                  <div className="segment-table">
                    <div className="segment-table-head" aria-hidden="true"><span>Routes / stops</span><span>Directions or operating notes</span><span></span></div>
                    {form.segments.map((segment, index) => <div key={index} className="segment-row">
                      <input value={segment.routes} placeholder="e.g. 440 SB" aria-label={`Segment ${index + 1} routes`} onChange={(e) => set("segments", form.segments.map((item, i) => i === index ? { ...item, routes: e.target.value } : item))} />
                      <input value={segment.directions ?? ""} placeholder="Turn-by-turn or operating notes" aria-label={`Segment ${index + 1} directions`} onChange={(e) => set("segments", form.segments.map((item, i) => i === index ? { ...item, directions: e.target.value || null } : item))} />
                      <button type="button" className="btn-icon-sm" aria-label={`Remove segment ${index + 1}`} onClick={() => set("segments", form.segments.filter((_, i) => i !== index))}><IconX /></button>
                    </div>)}
                    <div className="segment-table-foot"><button type="button" className="btn-sm" onClick={() => set("segments", [...form.segments, { routes: "", directions: null }])}>+ Add segment</button></div>
                  </div>
                  <span className={`intake-help ${invalid("segments") ? "is-error" : ""}`}>{invalid("segments") ? <><IconAlert />Add at least one route segment.</> : "Stops picked on the map add their routes here automatically."}</span>
                </div>
              )}
              <div className="intake-field intake-field-wide">
                <span className="intake-field-label"><span>Affected stops and stations</span></span>
                <TokenInput
                  values={splitList(form.affectedStops)}
                  onChange={(values) => set("affectedStops", values.join("; "))}
                  placeholder="Add a stop, platform, or transfer point and press Enter"
                  render={(value) => { const m = /^(.*?)\s*\(#([^)]+)\)$/.exec(value); return m ? <>{m[1]} <small>#{m[2]}</small></> : value; }}
                />
                <span className="intake-help">Stops added from the map keep their GTFS id, which is how duplicate and conflict warnings recognise the same place.</span>
              </div>
            </div>
          </section>

          {/* 4 · Instructions and communications */}
          <section className="intake-section" id="intake-instructions" aria-labelledby="intake-instructions-title">
            <div className="intake-section-head">
              <span className="intake-section-num" aria-hidden="true">4</span>
              <div><h4 id="intake-instructions-title">Instructions and communications</h4><p>What the people carrying out the Detour must do, and who has to hear about it.</p></div>
              <span className={`pill-sm intake-section-status ${sectionStatus("instructions").cls}`}>{sectionStatus("instructions").label}</span>
            </div>
            <div className="intake-section-body">
              <label className={`intake-field intake-field-wide ${invalid("instructions") ? "is-invalid" : ""}`}>
                <span className="intake-field-label"><span>Action instructions <span className="req">*</span></span></span>
                <textarea value={form.instructions} onChange={(e) => set("instructions", e.target.value)} placeholder="What should operators, Operations, or enforcement do?" required />
                <span className={`intake-help ${invalid("instructions") ? "is-error" : ""}`}>{invalid("instructions") ? <><IconAlert />Required before submission. This is the text every audience receives.</> : "This is the text every audience receives."}</span>
              </label>
              <label className="intake-field intake-field-wide">
                <span className="intake-field-label"><span>Operational impacts</span></span>
                <textarea value={form.operationalImpacts} onChange={(e) => set("operationalImpacts", e.target.value)} placeholder="Layover, restroom, staging, accessibility, or other operating impacts" style={{ minHeight: 64 }} />
                <span className="intake-help">Layover, restroom, staging, accessibility, or other operating impacts.</span>
              </label>
              <label className="intake-field">
                <span className="intake-field-label"><span>Confirmation source or contact</span></span>
                <input value={form.confirmationContact} onChange={(e) => set("confirmationContact", e.target.value)} placeholder="Project contact, phone, or expected update" />
                <span className="intake-help">Who OCC can call to confirm the window.</span>
              </label>
              <div className={`intake-field ${invalid("audiences") ? "is-invalid" : ""}`}>
                <span className="intake-field-label"><span>Required audiences <span className="req">*</span></span></span>
                <TokenInput values={form.audiences} onChange={(values) => set("audiences", values)} placeholder="Add an audience and press Enter" trailing={form.impact === "fixed_route" ? <span className="token is-implied">Contractor · added on acceptance when configured</span> : null} />
                <span className={`intake-help ${invalid("audiences") ? "is-error" : ""}`}>{invalid("audiences") ? <><IconAlert />Name at least one audience.</> : "Each audience must have a published communication before the Detour reads as communicated."}</span>
              </div>
              <div className={`intake-field intake-field-wide ${invalid("channels") ? "is-invalid" : ""}`}>
                <span className="intake-field-label"><span>Required channels <span className="req">*</span></span></span>
                <ChannelChips values={form.channels} onChange={(values) => set("channels", values)} />
                <span className={`intake-help ${invalid("channels") ? "is-error" : ""}`}>{invalid("channels") ? <><IconAlert />Pick at least one channel.</> : "Email and Teams can be sent from OnBoard; radio and the dispatch board are recorded when done."}</span>
              </div>
            </div>
          </section>

          {/* 5 · Evidence */}
          <section className="intake-section" id="intake-evidence" aria-labelledby="intake-evidence-title">
            <div className="intake-section-head">
              <span className="intake-section-num" aria-hidden="true">5</span>
              <div><h4 id="intake-evidence-title">Evidence</h4><p>What the reviewer can check this report against.</p></div>
              <span className="pill-sm intake-section-status pill-muted">Optional</span>
            </div>
            <div className="intake-section-body">
              <label className="intake-field">
                <span className="intake-field-label"><span>Evidence notes</span></span>
                <textarea value={form.evidenceNotes} onChange={(e) => set("evidenceNotes", e.target.value)} placeholder="What documentation supports this report?" />
                <span className="intake-help">Notices, plans, calls, site visits.</span>
              </label>
              <label className="intake-field">
                <span className="intake-field-label"><span>Evidence reference</span></span>
                <input value={form.evidenceReference} onChange={(e) => set("evidenceReference", e.target.value)} placeholder="Case number or reference link" />
                <span className="intake-help">Case number or reference link.</span>
              </label>
              <div className="intake-field intake-field-wide">
                <span className="intake-field-label"><span>Supporting files</span></span>
                <label className="dropzone">
                  <IconUpload />
                  <span>Drop the source email, PDF, maps, or photos here, or <b>browse</b>. Images, PDF, Office, CSV, text · 25 MB each.</span>
                  <input type="file" accept={DETOUR_ATTACHMENT_ACCEPT} multiple style={{ display: "none" }} onChange={(e) => setFiles((current) => [...current, ...Array.from(e.target.files ?? [])])} />
                </label>
                {files.length ? <div className="file-tiles">{files.map((file, index) => <span key={`${file.name}-${index}`} className="file-tile"><span className="file-tile-kind">{fileKind(file.name)}</span><span><b>{file.name}</b><small>{sizeLabel(file.size)} · will upload on submit</small></span><button type="button" className="btn-icon-sm" aria-label={`Remove ${file.name}`} onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}><IconX /></button></span>)}</div> : null}
                {editing ? <IntakeImages intakeId={editing.id} /> : null}
                <span className="intake-help">{editing ? "Files already attached stay with the record; add more here if needed." : ""}</span>
              </div>
            </div>
          </section>
        </div>

        <aside className="intake-rail" aria-label="Readiness">
          <div className="intake-rail-card" aria-live="polite">
            <div className="readiness-head"><h4>Readiness</h4><span>{doneCount} of {requirements.length} required</span></div>
            <div className="readiness-bar" role="progressbar" aria-valuemin={0} aria-valuemax={requirements.length} aria-valuenow={doneCount}><div style={{ width: `${requirements.length ? Math.round((doneCount / requirements.length) * 100) : 0}%` }} /></div>
            <ul className="readiness-list">
              {requirements.map((r) => <li key={r.key} className={r.done ? "is-done" : ""}>{r.done ? <><IconCheck />{r.label}</> : <a href={`#intake-${r.section}`}><span className="readiness-dot" aria-hidden="true"></span>{r.label}</a>}</li>)}
            </ul>
            {missing.length === 0 ? <div className="intake-checklist" style={{ margin: 0 }}><div className="is-complete">All required operational facts are present. OCC review starts after submission.</div></div> : null}
            <button className="btn-primary" disabled={busy || (showErrors && missing.length > 0)} onClick={() => void submit()}>{savedIntakeId ? "Retry supporting-file upload" : resubmitting ? "Save and resubmit for review" : editing ? "Save changes" : "Submit complete Detour Intake"}</button>
            <span className="intake-rail-note">{resubmitting ? "Saving returns this record to Pending OCC review." : editing ? "Saving keeps this record in Pending OCC review." : "Submitted records start in Pending OCC review."}</span>
          </div>
          <div className="intake-rail-card">
            <h4 style={{ fontSize: 12 }}>What acceptance does</h4>
            <div className="intake-steps">
              <div><i>1</i><span>This same record becomes the authoritative Detour, with a new internal reference.</span></div>
              <div><i>2</i><span>The fulfillment path you proposed is assigned. Nothing is entered in Avail and nothing is published.</span></div>
              <div><i>3</i><span>Supporting files, the drawing, and the stops move with it.</span></div>
            </div>
          </div>
        </aside>
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
    <p className="td-subtle">Same {matches.some((m) => m.reasons.includes("geometry")) ? "place on the map" : matches.some((m) => m.reasons.includes("stops")) ? "stops" : matches.some((m) => m.reasons.includes("routes")) ? "routes" : "location"} in an overlapping window. This is a warning for review; nothing is merged or rejected automatically.</p>
    <ul>{matches.map((match) => <li key={`${match.kind}-${match.id}`}>
      <strong>{match.label}</strong> <span className="td-subtle">({match.kind === "detour" ? "Detour" : "Intake"} · {match.status.replace(/_/g, " ")} · {match.start_date || "open"} → {match.end_date || "open"})</span>
      <br /><span className="td-subtle">Shares {match.reasons.map((r) => r === "geometry" ? "map location" : r === "stops" ? "stops" : r === "routes" ? "routes" : "location").join(" and ")}: {match.shared.join(", ")}</span>
      {" "}<button type="button" className="btn-sm" onClick={() => onPick(match)}>Mark duplicate of this</button>
    </li>)}</ul>
  </div>;
}

// Chips for a fixed set of channels with an escape hatch for anything else.
// Selection is the console's tab-switch anatomy so it reads the same everywhere.
function ChannelChips({ values, onChange }: { values: string[]; onChange: (values: string[]) => void }) {
  const [other, setOther] = useState<string | null>(null);
  const has = (channel: string) => values.some((v) => v.toLowerCase() === channel.toLowerCase());
  const toggle = (channel: string) => onChange(has(channel) ? values.filter((v) => v.toLowerCase() !== channel.toLowerCase()) : [...values, channel]);
  const custom = values.filter((v) => !KNOWN_CHANNELS.some((k) => k.toLowerCase() === v.toLowerCase()));
  return <div className="chip-toggles" role="group" aria-label="Required channels">
    {KNOWN_CHANNELS.map((channel) => <button key={channel} type="button" className="chip-toggle" aria-pressed={has(channel)} onClick={() => toggle(channel)}>{channel === "email" ? "Email" : channel === "radio" ? "Radio" : channel}</button>)}
    {custom.map((channel) => <button key={channel} type="button" className="chip-toggle" aria-pressed="true" onClick={() => toggle(channel)}>{channel}</button>)}
    {other === null
      ? <button type="button" className="chip-toggle is-add" onClick={() => setOther("")}>+ Other</button>
      : <input autoFocus value={other} placeholder="Channel name, then Enter" aria-label="Other channel" style={{ maxWidth: 200 }} onChange={(e) => setOther(e.target.value)} onBlur={() => { if (other.trim()) toggle(other.trim()); setOther(null); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (other.trim()) toggle(other.trim()); setOther(null); } if (e.key === "Escape") setOther(null); }} />}
  </div>;
}

// Free-form list as removable tokens: Enter or comma adds, Backspace on an
// empty box removes the last. Replaces comma-separated text so each entry
// is one exact string (communication status matches on the audience string).
function TokenInput({ values, onChange, placeholder, render, trailing }: { values: string[]; onChange: (values: string[]) => void; placeholder: string; render?: (value: string) => ReactNode; trailing?: ReactNode }) {
  const [draft, setDraft] = useState("");
  const commit = () => { const next = draft.trim(); if (next && !values.some((v) => v.toLowerCase() === next.toLowerCase())) onChange([...values, next]); setDraft(""); };
  return <div className="token-input">
    {values.map((value) => <span key={value} className="token">{render ? render(value) : value}<button type="button" aria-label={`Remove ${value}`} onClick={() => onChange(values.filter((v) => v !== value))}><IconX size={12} /></button></span>)}
    {trailing}
    <input value={draft} placeholder={values.length ? "" : placeholder} aria-label={placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(); } if (e.key === "Backspace" && !draft && values.length) onChange(values.slice(0, -1)); }} />
  </div>;
}

function fileKind(name: string): string { const ext = /\.([a-z0-9]{1,5})$/i.exec(name)?.[1]; return ext ? ext.toUpperCase().slice(0, 4) : "FILE"; }
function sizeLabel(bytes: number): string { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }

const IconX = ({ size = 16 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>;
const IconCheck = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>;
const IconAlert = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>;
const IconPin = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 22s7-7 7-12a7 7 0 0 0-14 0c0 5 7 12 7 12z" /><circle cx="12" cy="10" r="2.5" /></svg>;
const IconBus = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="15" rx="2" /><path d="M4 11h16M8 18v2M16 18v2" /><circle cx="8" cy="14.5" r="1" /><circle cx="16" cy="14.5" r="1" /></svg>;
const IconVan = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 17h2l2-6h10l2 6h2" /><circle cx="7" cy="18" r="2" /><circle cx="17" cy="18" r="2" /><path d="M9 11V7h6v4" /></svg>;
const IconUpload = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V4M6 10l6-6 6 6M4 20h16" /></svg>;

function IntakeImages({ intakeId }: { intakeId: string }) {
  const [images, setImages] = useState<DetourImage[] | null>(null);
  useEffect(() => { void api.getDetourIntakeImages(intakeId).then(({ images }) => setImages(images)).catch(() => setImages([])); }, [intakeId]);
  if (images === null) return <p className="muted">Loading supporting files…</p>;
  if (images.length === 0) return <p className="muted">No supporting files attached.</p>;
  return <div className="intake-checklist"><strong>Supporting files</strong><ul>{images.map((image) => <li key={image.id}>{image.read_url ? <a href={image.read_url} target="_blank" rel="noreferrer">{isImageAttachment(image) ? <img src={image.read_url} alt="" style={{ height: 28, width: 28, objectFit: "cover", borderRadius: 4, verticalAlign: "middle", marginRight: 6 }} /> : null}{image.file_name}</a> : image.file_name}</li>)}</ul></div>;
}
