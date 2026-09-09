import { useEffect, useState } from "react";
import type { AssessmentCap, AssessmentCapStatus, AssessmentPeriod, PeriodKpiAssessment } from "@mvta/shared";
import { api } from "../../../config.js";
import { useAuth } from "../../../auth/AuthContext.js";
import { useAppDialog } from "../../../components/AppDialog.js";
import { Empty, formatDate } from "./assessmentFormat.js";

// The six things a submitted plan must state (design §5), asked for on one
// form rather than six prompts.
const SUBMISSION: Array<{ field: string; label: string }> = [
  { field: "root_cause", label: "Root cause" }, { field: "corrective_actions", label: "Corrective actions" }, { field: "responsible_parties", label: "Responsible parties" },
  { field: "timeline_note", label: "Timeline" }, { field: "monitoring_plan", label: "Monitoring plan" }, { field: "closure_criteria", label: "Closure criteria" },
];
// What each status can become, and who may take it there. Mirrors
// lib/assessment/capTransitions on the server, which is the rule.
const NEXT: Record<string, Array<{ to: string; label: string; manager: boolean; note?: boolean }>> = {
  required: [{ to: "submitted", label: "Record submission", manager: false }],
  submitted: [{ to: "approved", label: "Approve", manager: true }, { to: "required", label: "Return", manager: true }],
  approved: [{ to: "in_progress", label: "Start", manager: true }],
  in_progress: [{ to: "closed", label: "Close", manager: true, note: true }, { to: "failed", label: "Fail", manager: true, note: true }],
};

export function Caps({ rows, period }: { rows: PeriodKpiAssessment[]; period: AssessmentPeriod | undefined }) {
  const { roles } = useAuth(); const { prompt } = useAppDialog();
  const manager = roles.includes("OCC.ComplianceManager") || roles.includes("OCC.Admin");
  const [records, setRecords] = useState<AssessmentCap[]>([]);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const load = () => period ? api.getAssessmentCaps(period.id).then(result => setRecords(result.caps)) : Promise.resolve(setRecords([]));
  useEffect(() => { void load(); }, [period]); // eslint-disable-line react-hooks/exhaustive-deps
  const move = async (cap: AssessmentCap, to: string, fields: Record<string, string> = {}) => {
    setError("");
    try { await api.transitionAssessmentCap(cap.id, to as AssessmentCapStatus, fields); setSubmitting(null); setForm({}); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to update the plan"); }
  };
  const close = async (cap: AssessmentCap, to: string) => { const note = await prompt({ title: to === "closed" ? "Close the plan" : "Record the plan as failed", label: "Closure note", confirmLabel: to === "closed" ? "Close" : "Record failure", multiline: true, required: true }); if (note) void move(cap, to, { closure_note: note }); };
  const pending = rows.filter(r => r.cap_required || r.tier_label === "tier2");
  return <section><div className="assessment-section-head"><div><h3>Corrective Action Plans</h3><p>CAP Determinations remain independent of Monetary Adjustments and Penalty Waivers. A plan is due five business days after issuance and states root cause, corrective actions, responsible parties, timeline, monitoring plan, and closure criteria.</p></div></div>
    {error && <div className="assessment-error">{error}</div>}
    {records.map(cap => <div className="assessment-card" key={cap.id}>
      <strong>{cap.standard_name}</strong>
      <p>{cap.trigger_reason} · due {formatDate(cap.due_at)}{cap.submitted_at ? ` · submitted ${formatDate(cap.submitted_at)}` : ""}{cap.closed_at ? ` · ${cap.status} ${formatDate(cap.closed_at)}` : ""}</p>
      <span className={`assessment-tier ${cap.overdue ? "tier2" : cap.status === "closed" ? "meets" : "warning"}`}>{cap.overdue ? "Overdue" : cap.status.replace("_", " ")}</span>
      {cap.root_cause && <dl className="assessment-cap-fields">{SUBMISSION.map(s => <div key={s.field}><dt>{s.label}</dt><dd>{(cap as unknown as Record<string, string | null>)[s.field] ?? "—"}</dd></div>)}{cap.closure_note && <div><dt>Closure note</dt><dd>{cap.closure_note}</dd></div>}</dl>}
      {submitting === cap.id
        ? <div className="assessment-cap-form">{SUBMISSION.map(s => <label key={s.field}><span>{s.label}</span><textarea aria-label={s.label} value={form[s.field] ?? ""} onChange={e => setForm(f => ({ ...f, [s.field]: e.target.value }))} /></label>)}<div><button className="btn-primary" disabled={SUBMISSION.some(s => !(form[s.field] ?? "").trim())} onClick={() => void move(cap, "submitted", form)}>Submit plan</button> <button onClick={() => { setSubmitting(null); setForm({}); }}>Cancel</button></div></div>
        : <div>{(NEXT[cap.status] ?? []).filter(n => !n.manager || manager).map(n => <button key={n.to} onClick={() => n.to === "submitted" ? setSubmitting(cap.id) : n.note ? void close(cap, n.to) : void move(cap, n.to)}>{n.label}</button>)}</div>}
    </div>)}
    {!records.length && pending.map(row => <div className="assessment-card" key={row.id}><strong>{row.name}</strong><p>{row.cap_reason || `${row.tier_label} outcome requires CAP review.`}</p><span className="assessment-tier tier2">Pending issuance</span></div>)}
    {!records.length && !pending.length && <Empty>No CAP Determinations exist for the selected Assessment Period.</Empty>}
  </section>;
}
