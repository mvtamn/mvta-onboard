import { Link } from "react-router-dom";
import { api } from "../../config.js";
import { AddAccessLink, Icon, Loading, PageHead, RoleChip } from "./AccessUi.js";
import { HUMAN_ROLES, displayTime, errorMessage, idempotencyKey, relativeTime, useAccess } from "./accessData.js";
import { actionLabel, outcomeNeedsLook } from "./auditVocabulary.js";
import { ExportInventoryButton } from "./ExportInventoryButton.js";

// The landing page of Access & Identity: what needs a decision, gathered from
// the pages it lives on, and a picture of who has what.
export function AccessOverview() {
  const { principals, pending, expirations, audit, loading, busy, setBusy, setError, setNotice, load, reconciliation, principalName } = useAccess();

  if (loading && principals.length === 0) return <><PageHead title="Overview" description="Who can reach OnBoard, how they got that access, and what needs a decision." /><Loading label="Loading Access Management…" /></>;

  const people = principals.filter((principal) => principal.principal_type === "user");
  const groups = principals.filter((principal) => principal.principal_type === "group");
  const workloads = principals.filter((principal) => principal.principal_type === "service_principal");
  const guests = people.filter((principal) => !!principal.guest_state).length;
  const direct = people.filter((principal) => principal.assignments.some((assignment) => assignment.source === "direct")).length;
  const unavailable = people.filter((principal) => principal.directory_status === "missing" || principal.account_enabled === false).length;
  const misassignedWorkloads = workloads.filter((principal) => principal.assignments.some((assignment) => assignment.role !== "System.Ingestion")).length;
  const soonest = pending.map((change) => change.approval_expires_at).filter((value): value is string => !!value).sort()[0];
  const findings = reconciliation?.findings ?? [];

  async function applyExpirations() {
    setBusy(true);
    try {
      const response = await api.applyAccessExpirations(idempotencyKey("expiry"));
      setNotice(`Processed ${response.results.length} due access ${response.results.length === 1 ? "expiry" : "expiries"}.`);
      await load();
    } catch (expiryError) {
      setError(errorMessage(expiryError, "Due access could not be removed."));
    } finally {
      setBusy(false);
    }
  }

  const recent = [...audit].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).slice(0, 6);

  return <>
    <PageHead
      title="Overview"
      description="Who can reach OnBoard, how they got that access, and what needs a decision. Microsoft Entra ID stays the source of truth: OnBoard never stores passwords or disables accounts."
      actions={<><ExportInventoryButton /><AddAccessLink /></>}
    />

    <div className="am-stats">
      <Link className="am-stat" to="/admin/access/people"><span><Icon name="users" size={13} />People &amp; guests</span><strong>{people.length}</strong><small>{guests} {guests === 1 ? "guest" : "guests"} · {direct} with direct access</small></Link>
      <Link className="am-stat" to="/admin/access/groups"><span><Icon name="layers" size={13} />Access groups</span><strong>{groups.length}</strong><small>Security groups assigned to OnBoard</small></Link>
      <Link className="am-stat" to="/admin/access/workloads"><span><Icon name="cpu" size={13} />Workloads</span><strong>{workloads.length}</strong><small>{misassignedWorkloads ? `${misassignedWorkloads} holding a person’s role` : "All hold only system access"}</small></Link>
    </div>

    <section className="am-card" aria-labelledby="am-todo-title">
      <div className="am-card-head"><h3 id="am-todo-title">Needs a decision</h3></div>
      <ul className="am-todo">
        {pending.length ? <li><span className="am-todo-ic"><Icon name="approve" size={17} /></span><div className="am-todo-text"><b>{pending.length} privileged {pending.length === 1 ? "request is" : "requests are"} waiting for approval</b><small>{soonest ? `The first one expires ${relativeTime(soonest)}. ` : ""}A request can’t be approved by the person who made it.</small></div><Link className="am-btn sm" to="/admin/access/approvals">Review approvals<Icon name="chevron" size={13} /></Link></li> : null}
        {expirations.length ? <li><span className="am-todo-ic"><Icon name="clock" size={17} /></span><div className="am-todo-text"><b>{expirations.length} {expirations.length === 1 ? "assignment is" : "assignments are"} due to expire</b><small>Removing them ends OnBoard access only; the Entra accounts stay enabled.</small></div><button type="button" className="am-btn sm" disabled={busy} onClick={() => void applyExpirations()}>Remove due access</button></li> : null}
        {findings.length ? <li><span className="am-todo-ic bad"><Icon name="pulse" size={17} /></span><div className="am-todo-text"><b>{findings.length} access health {findings.length === 1 ? "finding" : "findings"}</b><small>Checked against Entra {displayTime(reconciliation!.observed_at)}</small></div><Link className="am-btn sm" to="/admin/access/health">Open Access health<Icon name="chevron" size={13} /></Link></li> : null}
        {unavailable ? <li><span className="am-todo-ic bad"><Icon name="warn" size={17} /></span><div className="am-todo-text"><b>{unavailable} {unavailable === 1 ? "person has" : "people have"} access but a disabled or missing account</b><small>Their OnBoard access outlives the account it was granted to.</small></div><Link className="am-btn sm" to="/admin/access/people?show=attention">Show them<Icon name="chevron" size={13} /></Link></li> : null}
        {direct ? <li><span className="am-todo-ic info"><Icon name="info" size={17} /></span><div className="am-todo-text"><b>{direct} {direct === 1 ? "person holds" : "people hold"} direct access</b><small>Direct assignments are audited exceptions. Group access is the default.</small></div><Link className="am-btn sm" to="/admin/access/people?show=direct">Show them<Icon name="chevron" size={13} /></Link></li> : null}
        {!pending.length && !expirations.length && !findings.length && !unavailable && !direct
          ? <li><span className="am-todo-ic info"><Icon name="check" size={17} /></span><div className="am-todo-text"><b>Nothing needs a decision</b><small>{reconciliation ? "Access health was clean when last checked." : "Access health compares OnBoard with Entra when you open it."}</small></div>{reconciliation ? null : <Link className="am-btn sm" to="/admin/access/health">Check access health<Icon name="chevron" size={13} /></Link>}</li>
          : null}
      </ul>
    </section>

    <div className="am-two">
      <section className="am-card" aria-labelledby="am-levels-title">
        <div className="am-card-head"><h3 id="am-levels-title">Access levels</h3><span>Who holds each, and through which groups</span></div>
        <div className="am-table-wrap flush">
          <table className="am-table">
            <thead><tr><th>Access level</th><th>Granted through</th><th className="num">People</th></tr></thead>
            <tbody>{HUMAN_ROLES.map((role) => {
              const via = groups.filter((group) => group.assignments.some((assignment) => assignment.role === role));
              const holders = people.filter((person) => person.effective_roles.includes(role)).length;
              return <tr key={role}>
                <td><RoleChip role={role} /></td>
                <td>{via.length ? via.map((group) => <span key={group.id} className="am-mono am-block">{group.display_name}</span>) : <span className="am-muted">No group assigned</span>}</td>
                <td className="num">{holders}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </section>
      <section className="am-card" aria-labelledby="am-recent-title">
        <div className="am-card-head"><h3 id="am-recent-title">Recent activity</h3><Link className="am-link" to="/admin/access/activity">Activity log</Link></div>
        {recent.length ? <ul className="am-feed">{recent.map((entry, index) => <li key={entry.id ?? `${entry.occurred_at}-${index}`}>
          <span className={`am-dot${outcomeNeedsLook(entry.outcome) ? " bad" : ""}`} />
          <span><b>{entry.actor_name}</b> · {actionLabel(entry.action)}{entry.target_id ? ` · ${principalName(entry.target_id)}` : ""}</span>
          <small>{displayTime(entry.occurred_at)}</small>
        </li>)}</ul> : <p className="am-empty">No administrative activity yet.</p>}
      </section>
    </div>
  </>;
}
