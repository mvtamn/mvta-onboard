import { useEffect, useState } from "react";
import type { AssessmentPeriod, ExcusableDelayClaim, SystemOutageWindow } from "@mvta/shared";
import { api } from "../../../config.js";
import { useAuth } from "../../../auth/AuthContext.js";
import { useAppDialog } from "../../../components/AppDialog.js";
import { Empty } from "./assessmentFormat.js";

const SYSTEMS = ["Avail_CAD_AVL", "ITMS", "MDT", "Spare", "Other"] as const;
const when = (value: string | null) => value ? new Date(value).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

// Relief inputs for the selected month: excusable-delay claims (filed here,
// decided by the Issuing Authority, linked from an occurrence in the log) and
// system outage windows (logged when noticed, ended when over). Both change
// the Assessable Input before tiering (ADR 0012); a decision on a shared
// month reopens its validation.
export function Relief({ period, onChanged }: { period: AssessmentPeriod | undefined; onChanged: () => void }) {
  const { roles } = useAuth(); const { prompt } = useAppDialog();
  const manager = roles.includes("OCC.ComplianceManager") || roles.includes("OCC.Admin");
  const [claims, setClaims] = useState<ExcusableDelayClaim[]>([]);
  const [outages, setOutages] = useState<SystemOutageWindow[]>([]);
  const [claim, setClaim] = useState({ event: "", started: "", notice: "", doc: "" });
  const [outage, setOutage] = useState({ system: "Avail_CAD_AVL", started: "", note: "" });
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!period) { setClaims([]); setOutages([]); return; }
    let active = true;
    Promise.all([api.getExcusableDelayClaims(period.contractor_id, period.service_month), api.getSystemOutages(period.service_month)])
      .then(([c, o]) => { if (active) { setClaims(c.claims); setOutages(o.outages); } })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : "Unable to load relief"); });
    return () => { active = false; };
  }, [period, tick]);
  const run = async (action: () => Promise<unknown>) => { setError(""); try { await action(); setTick(t => t + 1); onChanged(); } catch (e) { setError(e instanceof Error ? e.message : "Action failed"); } };
  const decide = async (c: ExcusableDelayClaim, status: "approved" | "denied") => { const note = await prompt({ title: status === "approved" ? "Approve claim" : "Deny claim", label: "Decision note", confirmLabel: status === "approved" ? "Approve" : "Deny", multiline: true, required: true }); if (note) void run(() => api.decideExcusableDelayClaim(c.id, status, note)); };
  if (!period) return <Empty>Select an Assessment Period to manage relief for its month.</Empty>;
  return <section className="assessment-relief">
    <div className="assessment-section-head"><div><h3>Relief</h3><p>Excusable-delay claims and system outage windows for {period.service_month.slice(0, 4)}-{period.service_month.slice(4)}. Relief removes an occurrence from the assessable inputs before tiering; raw and excluded counts are both kept.</p></div></div>
    {error && <div className="assessment-error">{error}</div>}
    <h4>Excusable-delay claims</h4>
    {claims.length ? claims.map(c => <div className="assessment-card" key={c.id}>
      <strong>{c.event_description}</strong>
      <p>Event {when(c.event_started_at)} · notice {when(c.notice_received_at)}{c.late_notice ? <span className="assessment-tier tier2"> Late notice (over 24 hours)</span> : null}{c.documentation_note ? ` · ${c.documentation_note}` : ""}</p>
      <span className={`assessment-tier ${c.status === "approved" ? "meets" : c.status === "denied" ? "tier2" : "warning"}`}>{c.status}</span>{c.decision_note ? <small> {c.decided_by}: {c.decision_note}</small> : null}
      {c.status === "submitted" && manager && <div><button onClick={() => void decide(c, "approved")}>Approve</button> <button onClick={() => void decide(c, "denied")}>Deny</button></div>}
    </div>) : <Empty>No excusable-delay claims for this month.</Empty>}
    <div className="assessment-cap-form">
      <label><span>Event</span><textarea aria-label="Event" value={claim.event} onChange={e => setClaim(v => ({ ...v, event: e.target.value }))} /></label>
      <label><span>Documentation</span><textarea aria-label="Documentation" value={claim.doc} onChange={e => setClaim(v => ({ ...v, doc: e.target.value }))} /></label>
      <label><span>Event started</span><input type="datetime-local" aria-label="Event started" value={claim.started} onChange={e => setClaim(v => ({ ...v, started: e.target.value }))} /></label>
      <label><span>Notice received</span><input type="datetime-local" aria-label="Notice received" value={claim.notice} onChange={e => setClaim(v => ({ ...v, notice: e.target.value }))} /></label>
      <div><button className="btn-primary" disabled={!claim.event.trim() || !claim.started || !claim.notice} onClick={() => void run(async () => { await api.createExcusableDelayClaim({ contractor_id: period.contractor_id, service_month: period.service_month, event_description: claim.event.trim(), event_started_at: new Date(claim.started).toISOString(), notice_received_at: new Date(claim.notice).toISOString(), documentation_note: claim.doc.trim() || undefined }); setClaim({ event: "", started: "", notice: "", doc: "" }); })}>File claim</button></div>
    </div>
    <h4>System outage windows</h4>
    {outages.length ? outages.map(o => <div className="assessment-card" key={o.id}>
      <strong>{o.system.replace(/_/g, " ")}</strong>
      <p>{when(o.started_at)} – {o.ended_at ? when(o.ended_at) : <b>still open</b>} · {o.scope_note} <small>({o.logged_by})</small></p>
      {!o.ended_at && <button onClick={() => void run(() => api.endSystemOutage(o.id, new Date().toISOString()))}>End window</button>}
    </div>) : <Empty>No outage windows touch this month.</Empty>}
    <div className="assessment-cap-form">
      <label><span>System</span><select aria-label="System" value={outage.system} onChange={e => setOutage(v => ({ ...v, system: e.target.value }))}>{SYSTEMS.map(s => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</select></label>
      <label><span>Started</span><input type="datetime-local" aria-label="Outage started" value={outage.started} onChange={e => setOutage(v => ({ ...v, started: e.target.value }))} /></label>
      <label><span>Scope</span><textarea aria-label="Scope" value={outage.note} onChange={e => setOutage(v => ({ ...v, note: e.target.value }))} /></label>
      <div><button className="btn-primary" disabled={!outage.started || !outage.note.trim()} onClick={() => void run(async () => { await api.createSystemOutage({ system: outage.system, started_at: new Date(outage.started).toISOString(), scope_note: outage.note.trim() }); setOutage({ system: "Avail_CAD_AVL", started: "", note: "" }); })}>Log outage</button></div>
    </div>
  </section>;
}
