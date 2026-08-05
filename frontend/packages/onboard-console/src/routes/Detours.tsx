import { Fragment, useEffect, useState } from "react";
import {
  ApiError,
  DETOUR_STATUS_LABELS,
  type Detour,
  type DetourStatus,
  type CreateDetourInput,
  type DetourSegmentInput,
  type DetourImage,
} from "@mvta/shared";
import { useAuth } from "../auth/AuthContext.js";
import { api } from "../config.js";
import { resizeImageFile } from "../lib/imageResize.js";

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

function dateLabel(value: string | null): string {
  if (!value) return "Open-ended";
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
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
  };
}

function detourToForm(d: Detour): DetourFormState {
  return {
    number: d.number ?? "",
    closure: d.closure,
    start_date: d.start_date ?? "",
    end_date: d.end_date ?? "",
    is_monitor_only: d.is_monitor_only,
    riders_directed: d.riders_directed ?? "",
    email_sent: d.email_sent,
    expired_email_sent: d.expired_email_sent,
    spare_emailed: d.spare_emailed,
    segments: d.segments.length > 0
      ? d.segments.map((s) => ({ routes: s.routes, directions: s.directions ?? "" }))
      : [{ ...EMPTY_SEGMENT }],
  };
}

// Detour & Closure module - replaces the hand-tracked mix of Avail (when
// buildable there), staff email, and an Excel tracker with one place.
// Status (Active/Upcoming/Monitor/Recently finished/Expired) is always
// server-computed (GET /detours) - never derived here, so the tabs can't
// drift from any other consumer of the same data. See
// detour-and-event-module-implementation-plan.md (Part B).
export function Detours() {
  const { roles } = useAuth();
  const canWrite = roles.some((r) => r === "OCC.Publisher" || r === "OCC.Admin");

  const [detours, setDetours] = useState<Detour[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusTab, setStatusTab] = useState<DetourStatus | "all">("active");
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
    if (!window.confirm(`Delete this detour record?\n\n"${d.closure}"`)) return;
    try {
      await api.deleteDetour(d.id);
      load();
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Delete failed.");
    }
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

  const visible = detours?.filter((d) => statusTab === "all" || d.status === statusTab) ?? [];

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

            <div style={{ marginTop: 14, display: "flex", gap: 16, flexWrap: "wrap" }}>
              <label><input type="checkbox" checked={form.is_monitor_only} onChange={(e) => setForm((f) => ({ ...f, is_monitor_only: e.target.checked }))} /> Monitor only (no confirmed closure yet)</label>
              <label><input type="checkbox" checked={form.email_sent} onChange={(e) => setForm((f) => ({ ...f, email_sent: e.target.checked }))} /> Email sent</label>
              <label><input type="checkbox" checked={form.expired_email_sent} onChange={(e) => setForm((f) => ({ ...f, expired_email_sent: e.target.checked }))} /> Expired email sent</label>
              <label><input type="checkbox" checked={form.spare_emailed} onChange={(e) => setForm((f) => ({ ...f, spare_emailed: e.target.checked }))} /> Spare emailed</label>
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
                      <td>{d.number || "—"}</td>
                      <td>{d.closure}</td>
                      <td className="td-dim">{dateLabel(d.start_date)} – {dateLabel(d.end_date)}</td>
                      <td><span className={`pill-sm ${STATUS_PILL[d.status]}`}>{DETOUR_STATUS_LABELS[d.status]}</span></td>
                      <td className="td-dim">{d.source === "avail" ? "Avail sync" : "Manual"}</td>
                      {canWrite ? (
                        <td onClick={(e) => e.stopPropagation()}>
                          <button className="btn-sm" onClick={() => openEditForm(d)}>Edit</button>
                          <button className="btn-sm danger" onClick={() => remove(d)}>Delete</button>
                        </td>
                      ) : null}
                    </tr>
                    {expandedId === d.id ? (
                      <tr key={`${d.id}-detail`}>
                        <td colSpan={canWrite ? 6 : 5}>
                          <div className="subcard" style={{ margin: "4px 0" }}>
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
                            <p className="td-dim" style={{ marginTop: 8 }}>
                              Email sent: {d.email_sent ? "Yes" : "No"} · Expired email sent: {d.expired_email_sent ? "Yes" : "No"} · Spare emailed: {d.spare_emailed ? "Yes" : "No"}
                            </p>
                            <p className="td-dim">Created by {d.created_by} · Updated by {d.updated_by ?? "—"}</p>
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
