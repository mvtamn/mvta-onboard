import { useEffect, useState } from "react";
import type { AssessmentAuditEntry, AssessmentPeriod } from "@mvta/shared";
import { api } from "../../../config.js";
import { Empty } from "./assessmentFormat.js";

const ACTION_LABEL: Record<string, string> = {
  computed: "Computed", reviewed: "Reviewed", validation_shared: "Validation Draft shared", finalized: "Finalized",
  draft_generated: "Validation Draft generated", issuance_proof_prepared: "Issuance Proof prepared", issuance_proof_voided: "Issuance Proof voided",
  issued: "Final Assessment issued", reopened: "Reopened", correction_started: "Correction started", stale_due_to_prior_period_reopen: "Stale: an earlier month was reopened",
  exception_authorized: "Exception authorized", evidence_added: "Evidence added", dispute_filed: "Dispute filed", dispute_decided: "Dispute decided",
};
const when = (value: string) => new Date(value).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

// The period's trail, newest first. The JSON the handlers recorded is shown
// as written; this page does not interpret it.
export function History({ period }: { period: AssessmentPeriod | undefined }) {
  const [entries, setEntries] = useState<AssessmentAuditEntry[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!period) { setEntries([]); return; }
    let active = true;
    api.getAssessmentAudit(period.id).then(result => { if (active) setEntries(result.entries); }).catch(e => { if (active) setError(e instanceof Error ? e.message : "Unable to load history"); });
    return () => { active = false; };
  }, [period]);
  if (!period) return <Empty>Select an Assessment Period to see its history.</Empty>;
  if (error) return <div className="assessment-error">{error}</div>;
  if (!entries.length) return <Empty>Nothing has been recorded for this Assessment Period yet.</Empty>;
  return <section><div className="assessment-section-head"><div><h3>History</h3><p>Every recorded act on this Assessment Period, its items, its artifacts, and disputes on them.</p></div></div><div className="assessment-table-wrap"><table className="data"><thead><tr><th>When</th><th>What</th><th>Who</th><th>Detail</th></tr></thead><tbody>{entries.map(entry => <tr key={entry.id}><td>{when(entry.created_at)}</td><td>{ACTION_LABEL[entry.action] ?? entry.action}<small>{entry.entity_type}</small></td><td>{entry.actor}</td><td>{entry.note && <div>{entry.note}</div>}{entry.before_json && <details><summary>Before</summary><code>{entry.before_json}</code></details>}{entry.after_json && <details><summary>After</summary><code>{entry.after_json}</code></details>}</td></tr>)}</tbody></table></div></section>;
}
