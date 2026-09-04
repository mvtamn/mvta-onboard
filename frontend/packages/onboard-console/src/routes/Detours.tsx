import { Fragment, useEffect, useState } from "react";
import {
  ApiError,
  DETOUR_STATUS_LABELS,
  DETOUR_LIFECYCLE_LABELS,
  DETOUR_SEVERITY_LABELS,
  type Detour,
  type DetourStatus,
  type DetourSeverity,
  type DetourReasonCode,
  type CreateDetourInput,
  type DetourSegmentInput,
  type DetourImage,
} from "@mvta/shared";
import { useAuth } from "../auth/AuthContext.js";
import { api } from "../config.js";
import { resizeImageFile } from "../lib/imageResize.js";
import { detourMatchesSearch } from "../lib/detourSearch.js";
import { useAppDialog } from "../components/AppDialog.js";
import { DetourOperationalRecord } from "../components/DetourOperationalRecord.js";
import { DetourWorkflowHistorySection } from "../components/DetourWorkflowHistorySection.js";
import { dateLabel, dateTimeLabel, toDateInputValue } from "../lib/detourDates.js";

const STATUS_TABS: { key: DetourStatus | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: DETOUR_STATUS_LABELS.active },
  { key: "upcoming", label: DETOUR_STATUS_LABELS.upcoming },
  { key: "monitor", label: DETOUR_STATUS_LABELS.monitor },
  { key: "recently_finished", label: DETOUR_STATUS_LABELS.recently_finished },
  { key: "expired", label: DETOUR_STATUS_LABELS.expired },
];

const STATUS_PILL: Record<DetourStatus, string> = {
  active: "pill-success",
  upcoming: "pill-accent",
  monitor: "pill-warning",
  recently_finished: "pill-muted",
  expired: "pill-muted",
};

// An internal number is issued once and never reassigned - it may already be
// sitting in a sent notification email - so a detour rescheduled into another
// year keeps its original number and gets flagged here instead of silently
// reading as the wrong year. Mirrors hasDetourNumberYearMismatch() in
// functions-restapi/src/lib/detourNumbering.ts; kept as a small local copy
// rather than a shared module since it is four lines and needs no refetch.
function numberYearMismatch(internalNumber: string | null | undefined, startDate: string | null): boolean {
  if (!internalNumber || !startDate) return false;
  const issued = /^MVTA-DET-(\d{4})-\d{4,}$/.exec(internalNumber);
  if (!issued) return false;
  return issued[1] !== startDate.slice(0, 4);
}

// <input type="datetime-local"> speaks local wall-clock with no zone, while
// reported_at/approved_at come back as UTC ISO strings. These two convert
// in both directions through local time so a value round-trips to the same
// wall-clock reading it was entered as.
function toDateTimeLocalInput(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const EMPTY_SEGMENT: DetourSegmentInput = { routes: "", directions: "" };

interface DetourFormState {
  number: string;
  closure: string;
  start_date: string;
  end_date: string;
  is_monitor_only: boolean;
  riders_directed: string;
  email_sent: boolean;
  expired_email_sent: boolean;
  spare_emailed: boolean;
  segments: DetourSegmentInput[];
  // Reporting fields - Part B6.
  reason_code: string;
  severity: string;
  reported_by: string;
  reported_at: string;
  approved_by: string;
  approved_at: string;
  radio_notified: boolean;
  dispatch_board_notified: boolean;
  social_media_notified: boolean;
  resolution_notes: string;
}

const BLANK_FORM: DetourFormState = {
  number: "",
  closure: "",
  start_date: "",
  end_date: "",
  is_monitor_only: false,
  riders_directed: "",
  email_sent: false,
  expired_email_sent: false,
  spare_emailed: false,
  segments: [{ ...EMPTY_SEGMENT }],
  reason_code: "",
  severity: "",
  reported_by: "",
  reported_at: "",
  approved_by: "",
  approved_at: "",
  radio_notified: false,
  dispatch_board_notified: false,
  social_media_notified: false,
  resolution_notes: "",
};

function formToInput(f: DetourFormState): CreateDetourInput {
  return {
    number: f.number.trim() || null,
    closure: f.closure.trim(),
    start_date: f.start_date || null,
    end_date: f.end_date || null,
    is_monitor_only: f.is_monitor_only,
    riders_directed: f.riders_directed.trim() || null,
    email_sent: f.email_sent,
    expired_email_sent: f.expired_email_sent,
    spare_emailed: f.spare_emailed,
    segments: f.segments.filter((s) => s.routes.trim() !== ""),
    reason_code: f.reason_code || null,
    severity: (f.severity as DetourSeverity) || null,
    reported_by: f.reported_by.trim() || null,
    reported_at: f.reported_at || null,
    approved_by: f.approved_by.trim() || null,
    approved_at: f.approved_at || null,
    radio_notified: f.radio_notified,
    dispatch_board_notified: f.dispatch_board_notified,
    social_media_notified: f.social_media_notified,
    resolution_notes: f.resolution_notes.trim() || null,
  };
}

function detourToForm(d: Detour): DetourFormState {
  return {
    number: d.number ?? "",
    closure: d.closure,
    // <input type="date"> accepts YYYY-MM-DD and nothing else - handed an
    // ISO timestamp it renders BLANK, and saving would then clear the
    // dates on a detour that had them.
    start_date: toDateInputValue(d.start_date),
    end_date: toDateInputValue(d.end_date),
    is_monitor_only: d.is_monitor_only,
    riders_directed: d.riders_directed ?? "",
    email_sent: d.email_sent,
    expired_email_sent: d.expired_email_sent,
    spare_emailed: d.spare_emailed,
    segments: d.segments.length > 0
      ? d.segments.map((s) => ({ routes: s.routes, directions: s.directions ?? "" }))
      : [{ ...EMPTY_SEGMENT }],
    reason_code: d.reason_code ?? "",
    severity: d.severity ?? "",
    reported_by: d.reported_by ?? "",
    reported_at: toDateTimeLocalInput(d.reported_at),
    approved_by: d.approved_by ?? "",
    approved_at: toDateTimeLocalInput(d.approved_at),
    radio_notified: d.radio_notified ?? false,
    dispatch_board_notified: d.dispatch_board_notified ?? false,
    social_media_notified: d.social_media_notified ?? false,
    resolution_notes: d.resolution_notes ?? "",
  };
}

// "Clone as new detour" (Part B6). A single real notice routinely bundles
// two separately-dated sub-closures - the Aug 2026 ramp notice covered the
// Cliff Rd and Diffley Rd ramps on different dates - which is two Detours
// rows sharing everything except their dates. This copies the shared
// context and deliberately drops what must not be inherited: dates (the
// whole point of the clone), the notification flags and approval (nothing
// has been sent or signed off for the new one), and resolution notes.
function detourToCloneForm(d: Detour): DetourFormState {
  return {
    ...detourToForm(d),
    start_date: "",
    end_date: "",
    email_sent: false,
    expired_email_sent: false,
    spare_emailed: false,
    radio_notified: false,
    dispatch_board_notified: false,
    social_media_notified: false,
    approved_by: "",
    approved_at: "",
    resolution_notes: "",
  };
}

// Detour & Closure module - replaces the hand-tracked mix of Avail (when
// buildable there), staff email, and an Excel tracker with one place.
// Status (Active/Upcoming/Monitor/Recently finished/Expired) is always
// server-computed (GET /detours) - never derived here, so the tabs can't
// drift from any other consumer of the same data. See
// detour-and-event-module-implementation-plan.md (Part B).
export function Detours() {
  const { confirm, prompt } = useAppDialog();
  const { roles } = useAuth();
  // Mirrors DETOUR_WRITE_ROLES / DETOUR_DELETE_ROLES in auth.ts. OCC.Detour
  // can create, edit and attach, but not delete - the server enforces the
  // real boundary; this only decides which controls are worth showing.
  const canWrite = roles.some((r) => r === "OCC.Publisher" || r === "OCC.Admin" || r === "OCC.Detour");
  const canDelete = roles.some((r) => r === "OCC.Publisher" || r === "OCC.Admin");

  const [detours, setDetours] = useState<Detour[] | null>(null);
  const [reasonCodes, setReasonCodes] = useState<DetourReasonCode[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusTab, setStatusTab] = useState<DetourStatus | "all">("active");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<DetourFormState>(BLANK_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function load() {
    api
      .getDetours()
      .then((d) => {
        setDetours(d.detours);
        setLoadError(null);
      })
      .catch((err) => {
        setDetours(null);
        setLoadError(
          err instanceof ApiError ? `Could not load detours: ${err.message}` : "Could not reach the detour service.",
        );
      });
  }

  useEffect(load, []);

  // Reason codes come back empty (not an error) until migration-025 has run,
  // which is exactly the signal reportingReady below keys off. A failure
  // here is deliberately not surfaced as a page-level error - the detour
  // list itself still works without the category vocabulary.
  useEffect(() => {
    api
      .getDetourReasonCodes(true)
      .then((r) => setReasonCodes(r.reason_codes))
      .catch(() => setReasonCodes([]));
  }, []);

  // Whether the B6 columns actually exist in this environment's database.
  // Two independent signals, because either can be absent on its own: a
  // seeded reason-code list, or a detour row carrying the reason_code key
  // (GET /detours omits the key entirely pre-migration rather than nulling
  // it). Showing the fields when the columns are missing would silently
  // discard whatever staff typed into them.
  const reportingReady =
    reasonCodes.length > 0 || (detours?.some((d) => "reason_code" in d) ?? false);

  function openNewForm() {
    setEditingId(null);
    setForm(BLANK_FORM);
    setFormError(null);
    setShowForm(true);
  }

  function openEditForm(d: Detour) {
    setEditingId(d.id);
    setForm(detourToForm(d));
    setFormError(null);
    setShowForm(true);
  }

  // Opens the new-detour form pre-filled from an existing row. editingId
  // stays null, so Save creates rather than overwriting the original.
  function openCloneForm(d: Detour) {
    setEditingId(null);
    setForm(detourToCloneForm(d));
    setFormError(null);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save() {
    if (!form.closure.trim()) {
      setFormError("Closure description is required.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const input = formToInput(form);
      if (editingId) {
        await api.updateDetour(editingId, input);
      } else {
        await api.createDetour(input);
      }
      setShowForm(false);
      load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(d: Detour) {
    if (!await confirm({ title: "Delete this detour record?", description: `“${d.closure}” will be permanently deleted.`, confirmLabel: "Delete detour", danger: true })) return;
    try {
      await api.deleteDetour(d.id);
      load();
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Delete failed.");
    }
  }

  async function recordAvailEntry(d: Detour) {
    const result = await prompt({ title: "Record Avail result", description: "Enter entered, conflict, or not_entered.", label: "Avail result", defaultValue: d.avail_entry_result ?? "entered", confirmLabel: "Continue", required: true });
    if (result !== "entered" && result !== "conflict" && result !== "not_entered") return;
    const externalId = result === "entered"
      ? await prompt({ title: "Record Avail Detour ID", label: "Avail Detour ID", defaultValue: d.external_detour_id ?? "", confirmLabel: "Continue", required: true })
      : null;
    if (result === "entered" && !externalId?.trim()) return;
    const detail = await prompt({ title: "Add entry details", label: "Details", placeholder: "Optional entry or conflict details", confirmLabel: "Save result", multiline: true }) || null;
    try {
      await api.recordAvailEntry(d.id, {
        result,
        external_detour_id: externalId?.trim() || null,
        detail,
      });
      load();
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Could not record the Avail entry.");
    }
  }

  async function useManualFallback(d: Detour) {
    const reason = await prompt({ title: "Use manual fulfillment", label: "Reason", placeholder: "Why is this detour being fulfilled manually instead of in Avail?", confirmLabel: "Use manual fulfillment", multiline: true, required: true });
    if (!reason?.trim()) return;
    try {
      await api.changeDetourFulfillment(d.id, { fulfillment_mode: "fixed_route_manual", reason: reason.trim() });
      load();
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Could not change fulfillment path");
    }
  }

  async function completeReview(d: Detour) {
    const notes = await prompt({ title: "Mark OCC re-review complete", description: d.review_reason ?? undefined, label: "Review notes", placeholder: "Optional - what was checked or changed", confirmLabel: "Review complete", multiline: true });
    if (notes === null) return;
    try { await api.completeDetourReview(d.id, notes.trim() || null); load(); }
    catch (err) { setLoadError(err instanceof ApiError ? err.message : "Could not complete the review"); }
  }

  async function closeDetour(d: Detour) {
    const reason = await prompt({ title: "Close detour", label: "Closure reason", placeholder: "Why is this detour being closed?", confirmLabel: "Close detour", multiline: true, required: true });
    if (!reason?.trim()) return;
    try { await api.closeDetour(d.id, reason.trim()); load(); }
    catch (err) { setLoadError(err instanceof ApiError ? err.message : "Could not close detour"); }
  }

  function updateSegment(i: number, field: keyof DetourSegmentInput, value: string) {
    setForm((f) => {
      const segments = f.segments.slice();
      segments[i] = { ...segments[i], [field]: value };
      return { ...f, segments };
    });
  }

  function addSegmentRow() {
    setForm((f) => ({ ...f, segments: [...f.segments, { ...EMPTY_SEGMENT }] }));
  }

  function removeSegmentRow(i: number) {
    setForm((f) => ({ ...f, segments: f.segments.filter((_, idx) => idx !== i) }));
  }

  const visible =
    detours?.filter(
      (d) =>
        (statusTab === "all" || d.status === statusTab) &&
        detourMatchesSearch(d, search, reasonCodes),
    ) ?? [];

  return (
    <>
      <div className="panel-header">Detours &amp; Closures</div>
      <div className="panel-body">
        <p className="panel-desc" style={{ marginBottom: 10 }}>
          Every closure/detour in one place, whether or not it's built as a real Avail detour -
          replaces the hand-tracked mix of Avail, staff email, and an Excel tracker.
        </p>

        <div className="occ-switch">
          {STATUS_TABS.map((t) => (
            <button key={t.key} className={statusTab === t.key ? "active" : ""} onClick={() => setStatusTab(t.key)}>
              {t.label}
            </button>
          ))}
          {canWrite && (
            <button className="btn-post" style={{ marginLeft: "auto" }} onClick={openNewForm}>
              + New Detour
            </button>
          )}
        </div>

        <div style={{ margin: "10px 0" }}>
          <input
            className="f"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search closure, routes, number, riders directed…"
            style={{ maxWidth: 420 }}
          />
        </div>

        {loadError ? <p className="error-text">{loadError}</p> : null}

        {showForm && (
          <div className="subcard" style={{ marginBottom: 16 }}>
            <h2 style={{ marginTop: 0 }}>{editingId ? "Edit detour" : "New detour"}</h2>
            {formError ? <p className="error-text">{formError}</p> : null}
            <div className="field-grid">
              <div>
                <p className="field-label">Number <span className="hint">(free text)</span></p>
                <input className="f" value={form.number} onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))} placeholder="e.g. 951, Operator Message" />
              </div>
              <div>
                <p className="field-label">Start date</p>
                <input className="f" type="date" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} />
              </div>
              <div>
                <p className="field-label">End date <span className="hint">(blank = open-ended)</span></p>
                <input className="f" type="date" value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} />
              </div>
            </div>
            <div className="field-grid single">
              <div>
                <p className="field-label">Closure / location description</p>
                <input className="f" value={form.closure} onChange={(e) => setForm((f) => ({ ...f, closure: e.target.value }))} placeholder="e.g. 5th St closed between Main and 3rd" />
              </div>
            </div>
            <div className="field-grid single">
              <div>
                <p className="field-label">Riders directed <span className="hint">(for stop closures)</span></p>
                <input className="f" value={form.riders_directed} onChange={(e) => setForm((f) => ({ ...f, riders_directed: e.target.value }))} placeholder="e.g. Use the stop at 6th St instead" />
              </div>
            </div>

            <p className="field-label" style={{ marginTop: 10 }}>Route segments</p>
            {form.segments.map((seg, i) => (
              <div className="field-grid two" key={i} style={{ marginBottom: 6 }}>
                <input className="f" value={seg.routes} onChange={(e) => updateSegment(i, "routes", e.target.value)} placeholder="Routes, e.g. 460 SB, 465 SB" />
                <span style={{ display: "flex", gap: 6 }}>
                  <input className="f" value={seg.directions ?? ""} onChange={(e) => updateSegment(i, "directions", e.target.value)} placeholder="Turn-by-turn directions" style={{ flex: 1 }} />
                  {form.segments.length > 1 && (
                    <button className="btn-sm" onClick={() => removeSegmentRow(i)}>Remove</button>
                  )}
                </span>
              </div>
            ))}
            <button className="btn-sm" onClick={addSegmentRow}>+ Add segment</button>

            {reportingReady && (
              <>
                <p className="field-label" style={{ marginTop: 14 }}>Reporting</p>
                <div className="field-grid">
                  <div>
                    <p className="field-label">Reason category</p>
                    <select className="f" value={form.reason_code} onChange={(e) => setForm((f) => ({ ...f, reason_code: e.target.value }))}>
                      <option value="">— Not categorized —</option>
                      {reasonCodes.map((rc) => (
                        <option key={rc.id} value={rc.code}>{rc.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <p className="field-label">Severity</p>
                    <select className="f" value={form.severity} onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))}>
                      <option value="">— Not assessed —</option>
                      {(Object.keys(DETOUR_SEVERITY_LABELS) as DetourSeverity[]).map((s) => (
                        <option key={s} value={s}>{DETOUR_SEVERITY_LABELS[s]}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="field-grid">
                  <div>
                    <p className="field-label">Reported by</p>
                    <input className="f" value={form.reported_by} onChange={(e) => setForm((f) => ({ ...f, reported_by: e.target.value }))} placeholder="Who first reported it" />
                  </div>
                  <div>
                    <p className="field-label">Reported at</p>
                    <input className="f" type="datetime-local" value={form.reported_at} onChange={(e) => setForm((f) => ({ ...f, reported_at: e.target.value }))} />
                  </div>
                </div>
                <div className="field-grid">
                  <div>
                    <p className="field-label">Approved by</p>
                    <input className="f" value={form.approved_by} onChange={(e) => setForm((f) => ({ ...f, approved_by: e.target.value }))} placeholder="Sign-off, if applicable" />
                  </div>
                  <div>
                    <p className="field-label">Approved at</p>
                    <input className="f" type="datetime-local" value={form.approved_at} onChange={(e) => setForm((f) => ({ ...f, approved_at: e.target.value }))} />
                  </div>
                </div>
                <div className="field-grid single">
                  <div>
                    <p className="field-label">Resolution notes <span className="hint">(filled in around expiry)</span></p>
                    <textarea className="f" rows={2} value={form.resolution_notes} onChange={(e) => setForm((f) => ({ ...f, resolution_notes: e.target.value }))} placeholder="How it wrapped up, anything worth knowing next time" />
                  </div>
                </div>
              </>
            )}

            <p className="field-label" style={{ marginTop: 14 }}>Notified</p>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <label><input type="checkbox" checked={form.is_monitor_only} onChange={(e) => setForm((f) => ({ ...f, is_monitor_only: e.target.checked }))} /> Monitor only (no confirmed closure yet)</label>
              <label><input type="checkbox" checked={form.email_sent} onChange={(e) => setForm((f) => ({ ...f, email_sent: e.target.checked }))} /> Email sent</label>
              <label><input type="checkbox" checked={form.expired_email_sent} onChange={(e) => setForm((f) => ({ ...f, expired_email_sent: e.target.checked }))} /> Expired email sent</label>
              <label><input type="checkbox" checked={form.spare_emailed} onChange={(e) => setForm((f) => ({ ...f, spare_emailed: e.target.checked }))} /> Spare emailed</label>
              {reportingReady && (
                <>
                  <label><input type="checkbox" checked={form.radio_notified} onChange={(e) => setForm((f) => ({ ...f, radio_notified: e.target.checked }))} /> Radio notified</label>
                  <label><input type="checkbox" checked={form.dispatch_board_notified} onChange={(e) => setForm((f) => ({ ...f, dispatch_board_notified: e.target.checked }))} /> Dispatch board notified</label>
                  <label><input type="checkbox" checked={form.social_media_notified} onChange={(e) => setForm((f) => ({ ...f, social_media_notified: e.target.checked }))} /> Social media notified</label>
                </>
              )}
            </div>

            <div style={{ marginTop: 14 }}>
              <button className="btn-post" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</button>
              <button className="btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </div>
        )}

        {detours === null && !loadError ? <p className="muted">Loading…</p> : null}
        {detours !== null && visible.length === 0 ? (
          <div className="subcard empty-note" style={{ textAlign: "center", padding: "30px 20px" }}>
            No detours in this view.
          </div>
        ) : null}

        {visible.length > 0 && (
          <div className="subcard" style={{ overflow: "hidden" }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Closure</th>
                  <th>Dates</th>
                  <th>Status</th>
                  <th>Source</th>
                  {canWrite ? <th>Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {visible.map((d) => (
                  <Fragment key={d.id}>
                    <tr style={{ cursor: "pointer" }} onClick={() => setExpandedId(expandedId === d.id ? null : d.id)}>
                      <td>
                        {d.number || "—"}
                        {d.internal_number ? (
                          <div className="td-dim" style={{ fontSize: "0.85em" }}>{d.internal_number}</div>
                        ) : null}
                      </td>
                      <td>{d.closure}</td>
                      <td className="td-dim">{dateLabel(d.start_date)} – {dateLabel(d.end_date)}</td>
                      <td><span className={`pill-sm ${STATUS_PILL[d.status]}`}>{DETOUR_STATUS_LABELS[d.status]}</span></td>
                      <td className="td-dim">{d.source === "avail" ? "Avail feed" : d.external_detour_id ? "OnBoard · Avail linked" : "OnBoard manual"}</td>
                      {canWrite ? (
                        <td onClick={(e) => e.stopPropagation()}>
                          <button className="btn-sm" onClick={() => openEditForm(d)}>Edit</button>
                          <button
                            className="btn-sm"
                            title="Start a new detour pre-filled from this one, with blank dates"
                            onClick={() => openCloneForm(d)}
                          >
                            Clone
                          </button>
                          {canDelete ? (
                            <button className="btn-sm danger" onClick={() => remove(d)}>Delete</button>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                    {expandedId === d.id ? (
                      <tr key={`${d.id}-detail`}>
                        <td colSpan={canWrite ? 6 : 5}>
                          <div className="subcard" style={{ margin: "4px 0" }}>
                            {d.internal_number ? (
                              <p><b>Internal ref:</b> {d.internal_number}</p>
                            ) : null}
                            {d.lifecycle_state ? (
                              <p><b>Workflow:</b> {DETOUR_LIFECYCLE_LABELS[d.lifecycle_state]}</p>
                            ) : null}
                            {d.readiness ? (
                              <p><b>Next step:</b> {d.readiness === "ready_for_avail_entry" ? "Enter this detour in Avail" : d.readiness === "avail_conflict" ? "Resolve the Avail conflict" : d.readiness === "ready_for_manual_operations" ? "Ready for manual operations" : d.readiness === "needs_occ_review" ? "Needs OCC review" : "Closed"}</p>
                            ) : null}
                            {d.communication_status ? <p><b>Communications:</b> {d.communication_status.replace("_", " ")}</p> : null}
                            {d.review_status === "needs_review" ? (
                              <p className="warn-note">
                                <b>Needs OCC re-review:</b> {d.review_reason}
                                {canWrite ? <> <button className="btn-sm" onClick={() => completeReview(d)}>Mark review complete</button></> : null}
                              </p>
                            ) : null}
                            {canWrite && d.lifecycle_state !== "closed" ? <p><button className="btn-sm" onClick={() => closeDetour(d)}>Close detour</button></p> : null}
                            <DetourOperationalRecord detour={d} />
                            {d.fulfillment_mode === "avail" && d.avail_entry_result ? (
                              <p><b>Avail entry:</b> {d.avail_entry_result.replace("_", " ")}
                                {d.external_detour_id ? ` · ID ${d.external_detour_id}` : ""}
                                {d.avail_entry_confirmed_by ? ` · ${d.avail_entry_confirmed_by}` : ""}
                              </p>
                            ) : null}
                            {canWrite && d.fulfillment_mode === "avail" &&
                              (d.lifecycle_state === "awaiting_fulfillment" || d.lifecycle_state === "fulfillment_failed") ? (
                              <p><button className="btn-sm" onClick={() => recordAvailEntry(d)}>Record human Avail entry</button></p>
                            ) : null}
                            {canWrite && d.fulfillment_mode === "avail" && d.lifecycle_state === "fulfillment_failed" ? (
                              <p><button className="btn-sm" onClick={() => useManualFallback(d)}>Use fixed-route manual exception</button></p>
                            ) : null}
                            <DetourCommunicationsSection detourId={d.id} canWrite={canWrite} />
                            {numberYearMismatch(d.internal_number, d.start_date) ? (
                              <p className="warn-note">
                                This detour's internal reference was issued for{" "}
                                {d.internal_number?.slice(9, 13)}, but its start date is now in{" "}
                                {d.start_date?.slice(0, 4)}. The reference is kept as issued — it may
                                already appear in a sent notification — so quote it as-is.
                              </p>
                            ) : null}
                            {d.riders_directed ? <p><b>Riders directed:</b> {d.riders_directed}</p> : null}
                            {d.segments.length === 0 ? (
                              <p className="muted">No route segments recorded.</p>
                            ) : (
                              <table className="data">
                                <thead><tr><th>Routes</th><th>Directions</th></tr></thead>
                                <tbody>
                                  {d.segments.map((s) => (
                                    <tr key={s.id}><td>{s.routes}</td><td className="td-dim">{s.directions || "—"}</td></tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                            {reportingReady ? (
                              <>
                                <p className="td-dim" style={{ marginTop: 8 }}>
                                  <b>Reason:</b>{" "}
                                  {d.reason_code
                                    ? reasonCodes.find((rc) => rc.code === d.reason_code)?.label ?? d.reason_code
                                    : "—"}
                                  {" · "}
                                  <b>Severity:</b> {d.severity ? DETOUR_SEVERITY_LABELS[d.severity] : "—"}
                                </p>
                                {/* Only rendered once something is actually
                                    recorded - a row of bare dashes told the
                                    reader nothing and buried the created-by
                                    line under it. */}
                                {d.reported_by || d.reported_at ? (
                                  <p className="td-dim">
                                    Reported by {d.reported_by || "—"}
                                    {d.reported_at ? ` · ${dateTimeLabel(d.reported_at)}` : ""}
                                  </p>
                                ) : null}
                                {d.approved_by || d.approved_at ? (
                                  <p className="td-dim">
                                    Approved by {d.approved_by || "—"}
                                    {d.approved_at ? ` · ${dateTimeLabel(d.approved_at)}` : ""}
                                  </p>
                                ) : null}
                                {d.resolution_notes ? <p><b>Resolution:</b> {d.resolution_notes}</p> : null}
                              </>
                            ) : null}
                            <p className="td-dim" style={{ marginTop: 8 }}>
                              Email sent: {d.email_sent ? "Yes" : "No"} · Expired email sent: {d.expired_email_sent ? "Yes" : "No"} · Spare emailed: {d.spare_emailed ? "Yes" : "No"}
                              {reportingReady ? (
                                <>
                                  {" · "}Radio: {d.radio_notified ? "Yes" : "No"} · Dispatch board:{" "}
                                  {d.dispatch_board_notified ? "Yes" : "No"} · Social media:{" "}
                                  {d.social_media_notified ? "Yes" : "No"}
                                </>
                              ) : null}
                            </p>
                            {/* Avail-synced detours are created by the sync,
                                not a person - saying so is more useful than
                                showing staff a service identity and letting
                                them wonder who that is. */}
                            <p className="td-dim">
                              Created by {d.source === "avail" ? "Avail sync" : d.created_by} on{" "}
                              {dateTimeLabel(d.created_at)}
                              {d.updated_by ? ` · Last edited by ${d.updated_by} on ${dateTimeLabel(d.updated_at)}` : ""}
                            </p>
                            {d.source === "avail" ? (
                              <p className="td-dim">
                                {d.last_edited_manually
                                  ? "Manually edited — the Avail sync will not overwrite this record."
                                  : "Kept in sync with Avail."}
                                {d.avail_last_seen_at
                                  ? ` Last seen in Avail: ${new Date(d.avail_last_seen_at).toLocaleString()}.`
                                  : ""}
                              </p>
                            ) : null}
                            <DetourImagesSection detourId={d.id} canWrite={canWrite} />
                            <DetourWorkflowHistorySection detourId={d.id} />
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function DetourCommunicationsSection({ detourId, canWrite }: { detourId: string; canWrite: boolean }) {
  const [communications, setCommunications] = useState<import("@mvta/shared").DetourCommunication[]>([]);
  const [audience, setAudience] = useState("Operations");
  const [channel, setChannel] = useState("email");
  const [recipients, setRecipients] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = () => api.getDetourCommunications(detourId).then((r) => setCommunications(r.communications)).catch(() => setError("Could not load communications"));
  useEffect(() => { void load(); }, [detourId]);
  async function save() {
    if (!content.trim()) return;
    try {
      await api.createDetourCommunication(detourId, { audience, channel, recipients: recipients || null, content });
      setContent(""); setRecipients(""); await load();
    } catch (err) { setError(err instanceof ApiError ? err.message : "Could not save communication"); }
  }
  async function publish(id: string) {
    try { await api.publishDetourCommunication(detourId, id); await load(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Could not publish communication"); }
  }
  return <div className="subcard" style={{ marginTop: "8px" }}>
    <b>Communications</b>{error ? <p className="error-text">{error}</p> : null}
    {communications.map((communication) => <p key={communication.id}>
      <b>{communication.audience} · {communication.channel}:</b> {communication.status}
      {communication.recipients ? ` · ${communication.recipients}` : ""}
      {canWrite && communication.status === "draft" ? <button className="btn-sm" onClick={() => publish(communication.id)}>Publish</button> : null}
    </p>)}
    {canWrite ? <div className="form-grid">
      <label>Audience<input value={audience} onChange={(e) => setAudience(e.target.value)} /></label>
      <label>Channel<input value={channel} onChange={(e) => setChannel(e.target.value)} /></label>
      <label>Recipients<input value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="Distribution list or team" /></label>
      <label>Message<textarea value={content} onChange={(e) => setContent(e.target.value)} /></label>
      <button className="btn-sm" onClick={save}>Save communication draft</button>
    </div> : null}
  </div>;
}

// Images upload directly to Blob Storage via a short-lived SAS URL -
// nothing ever passes through this API's own request body. Same write
// access tier as editing the detour itself (per the owner's decision).
// Client-side resize (imageResize.ts) happens before the SAS request, so a
// several-MB phone photo never gets uploaded at full size.
function DetourImagesSection({ detourId, canWrite }: { detourId: string; canWrite: boolean }) {
  const [images, setImages] = useState<DetourImage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  function load() {
    api
      .getDetourImages(detourId)
      .then((d) => setImages(d.images))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load images."));
  }

  useEffect(load, [detourId]);

  async function handleFiles(fileList: FileList) {
    setUploading(true);
    setError(null);
    try {
      for (const rawFile of Array.from(fileList)) {
        const file = await resizeImageFile(rawFile);
        const { upload_url, blob_path } = await api.getDetourImageUploadUrl(detourId, file.name, file.type);
        const putRes = await fetch(upload_url, {
          method: "PUT",
          headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": file.type },
          body: file,
        });
        if (!putRes.ok) throw new Error(`Upload to storage failed (${putRes.status})`);
        await api.createDetourImage(detourId, {
          blob_path,
          file_name: file.name,
          content_type: file.type,
          size_bytes: file.size,
        });
      }
      load();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Image upload failed.",
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <p className="field-label">Images</p>
      {error ? <p className="error-text">{error}</p> : null}
      {images === null && !error ? <p className="muted">Loading images…</p> : null}
      {images && images.length === 0 ? <p className="td-dim">No images attached.</p> : null}
      {images && images.length > 0 ? (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          {images.map((img) => (
            <div key={img.id} style={{ textAlign: "center" }}>
              {img.read_url ? (
                <img
                  src={img.read_url}
                  alt={img.caption ?? img.file_name}
                  title={img.caption ?? img.file_name}
                  style={{ width: 90, height: 90, objectFit: "cover", borderRadius: 6, cursor: "pointer", border: "1px solid var(--border)" }}
                  onClick={() => window.open(img.read_url!, "_blank", "noopener,noreferrer")}
                />
              ) : (
                <div className="td-dim" style={{ width: 90, height: 90, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--border)", borderRadius: 6 }}>
                  Not ready
                </div>
              )}
              <div className="td-dim" style={{ fontSize: 11, marginTop: 3, maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis" }}>
                {img.caption ?? img.file_name}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {canWrite ? (
        <label className="btn-sm" style={{ display: "inline-block", cursor: uploading ? "default" : "pointer" }}>
          {uploading ? "Uploading…" : "+ Attach images"}
          <input
            type="file"
            accept="image/*"
            multiple
            disabled={uploading}
            style={{ display: "none" }}
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />
        </label>
      ) : null}
    </div>
  );
}
