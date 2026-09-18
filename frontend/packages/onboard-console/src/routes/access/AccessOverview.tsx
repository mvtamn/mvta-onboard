import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../config.js";
import { useAccess as useMyAccess } from "../../auth/AccessContext.js";
import { AddAccessLink, GrantChip, Icon, Loading, PageHead, SetupNotice } from "./AccessUi.js";
import { displayTime, errorMessage, isPrivilegedRole, relativeTime, useAccess } from "./accessData.js";
import { actionLabel, outcomeNeedsLook } from "./auditVocabulary.js";
import { ExportInventoryButton } from "./ExportInventoryButton.js";

// The landing page of Access & Identity: what needs a decision, gathered from
// the pages it lives on, and a picture of who holds what.
export function AccessOverview() {
  const { people, requests, roles, findings, notReady, audit, loading, busy, setBusy, setError, setNotice, load, principalName } = useAccess();
  const { can } = useMyAccess();
  const canManage = can("access-identity.manage");
  const [imported, setImported] = useState<string | null>(null);

  if (loading && people.length === 0 && !notReady) {
    return <><PageHead title="Overview" description="Who can do what in OnBoard, and what needs a decision." /><Loading label="Loading Access & Identity…" /></>;
  }

  const guests = people.filter((person) => person.kind === "guest").length;
  const withoutRoles = people.filter((person) => person.roles.length === 0).length;
  const pending = requests.filter((request) => request.status === "pending");
  const soonest = pending.map((request) => request.approvalExpiresAt).sort()[0];
  const live = roles.filter((role) => !role.archived);
  const recent = [...audit].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).slice(0, 6);

  // The one-time catch-up: today's Entra app-role assignments become OnBoard
  // grants. Pressing it twice is safe - a person who already holds the role is
  // counted as skipped rather than granted it again.
  async function importFromEntra() {
    setBusy(true);
    try {
      const inventory = await api.getAccessPrincipals();
      const principals = inventory.principals ?? [];
      const people = principals.filter((principal) => principal.principal_type === "user");
      const assignments = people.flatMap((principal) => principal.assignments.map((assignment) => ({
        object_id: principal.id,
        name: principal.display_name,
        email: principal.sign_in_name,
        app_role: assignment.role,
        via: assignment.source === "group" ? `group ${assignment.source_name}` : "direct assignment",
      })));
      if (assignments.length === 0) {
        // Finding nothing is a claim about Entra, and it was made without
        // evidence: the first attempt at this on dev said "nothing to import"
        // while Entra held 24 assignments across 7 people, and nothing on the
        // page or in the API log said which half had gone wrong. Each way of
        // finding nothing now names itself.
        const groups = principals.filter((principal) => principal.principal_type === "group").length;
        setImported(
          principals.length === 0
            ? "Entra returned nothing at all. The app roles it was asked about may not be the ones now registered - check ONBOARD_ACCESS_CONFIG_JSON against the application's app-role ids."
            : people.length === 0
              ? `Entra returned ${groups} ${groups === 1 ? "group" : "groups"} and no people, so no group's members could be read. That is a directory read permission, not a missing assignment.`
              : `Entra returned ${people.length} ${people.length === 1 ? "person" : "people"}, none holding an app role OnBoard recognises.`,
        );
        return;
      }
      const outcome = await api.importAccessFromEntra(assignments);
      const summary = `${assignments.length} read from Entra · ${outcome.people} ${outcome.people === 1 ? "person" : "people"}, ${outcome.granted} ${outcome.granted === 1 ? "grant" : "grants"}, ${outcome.skipped} skipped`
        + (outcome.unknownRoles.length ? `. No OnBoard role matches ${outcome.unknownRoles.join(", ")}, so those were left out.` : ".");
      setImported(summary);
      setNotice(`Imported from Entra: ${summary}`);
      setError(null);
      await load();
    } catch (importError) {
      setError(errorMessage(importError, "The Entra assignments could not be imported."));
    } finally {
      setBusy(false);
    }
  }

  return <>
    <PageHead
      title="Overview"
      description="What a person may do in OnBoard is decided by the roles they hold here. Entra decides who may sign in, and nothing else: OnBoard never stores passwords or disables accounts."
      actions={<><ExportInventoryButton /><AddAccessLink /></>}
    />
    {notReady ? <SetupNotice message={notReady} /> : null}

    <div className="am-stats">
      <Link className="am-stat" to="/admin/access/people"><span><Icon name="users" size={13} />People &amp; guests</span><strong>{people.length}</strong><small>{guests} {guests === 1 ? "guest" : "guests"} · {withoutRoles} holding no role</small></Link>
      <Link className="am-stat" to="/admin/access/roles"><span><Icon name="layers" size={13} />Roles</span><strong>{live.length}</strong><small>{live.filter((role) => role.members === 0).length} held by nobody</small></Link>
      <Link className="am-stat" to="/admin/access/approvals"><span><Icon name="approve" size={13} />Waiting for a decision</span><strong>{pending.length}</strong><small>{soonest ? `The first expires ${relativeTime(soonest)}` : "Nothing is waiting"}</small></Link>
    </div>

    <section className="am-card" aria-labelledby="am-todo-title">
      <div className="am-card-head"><h3 id="am-todo-title">Needs a decision</h3></div>
      <ul className="am-todo">
        {pending.length ? <li><span className="am-todo-ic"><Icon name="approve" size={17} /></span><div className="am-todo-text"><b>{pending.length} privileged {pending.length === 1 ? "request is" : "requests are"} waiting for approval</b><small>{soonest ? `The first one expires ${relativeTime(soonest)}. ` : ""}A request can’t be decided by the person who made it.</small></div><Link className="am-btn sm" to="/admin/access/approvals">Review approvals<Icon name="chevron" size={13} /></Link></li> : null}
        {withoutRoles ? <li><span className="am-todo-ic info"><Icon name="warn" size={17} /></span><div className="am-todo-text"><b>{withoutRoles} {withoutRoles === 1 ? "person holds" : "people hold"} no role</b><small>They can sign in and see the No access page. Grant a role, or leave them if that is intended.</small></div><Link className="am-btn sm" to="/admin/access/people?show=nothing">Show them<Icon name="chevron" size={13} /></Link></li> : null}
        {findings?.length ? <li><span className="am-todo-ic bad"><Icon name="pulse" size={17} /></span><div className="am-todo-text"><b>{findings.length} access health {findings.length === 1 ? "finding" : "findings"}</b><small>{findings[0]!.headline}</small></div><Link className="am-btn sm" to="/admin/access/health">Open Access health<Icon name="chevron" size={13} /></Link></li> : null}
        {!pending.length && !withoutRoles && !findings?.length
          ? <li><span className="am-todo-ic info"><Icon name="check" size={17} /></span><div className="am-todo-text"><b>Nothing needs a decision</b><small>{findings ? "Access health was clean when last checked." : "Access health looks at OnBoard’s grants when you open it."}</small></div>{findings ? null : <Link className="am-btn sm" to="/admin/access/health">Check access health<Icon name="chevron" size={13} /></Link>}</li>
          : null}
      </ul>
    </section>

    {canManage ? <section className="am-card" aria-labelledby="am-import-title">
      <div className="am-card-head"><h3 id="am-import-title">Import from Entra</h3><span>One-time catch-up</span></div>
      <p className="am-callout"><Icon name="info" /><span>
        Before roles moved into OnBoard, access was Entra app-role assignments. This reads those assignments and writes the matching OnBoard grants, so people who already had access keep it without signing in again and being granted by hand.
        It is safe to press twice: somebody who already holds the role is counted as skipped, never granted it twice. Entra assignments are not changed.
      </span></p>
      <div className="am-toolbar">
        <button type="button" className="am-btn" disabled={busy || !!notReady} onClick={() => void importFromEntra()}><Icon name="download" />Import from Entra</button>
        {imported ? <span className="am-toolbar-meta" role="status">{imported}</span> : null}
      </div>
    </section> : null}

    <div className="am-two">
      <section className="am-card" aria-labelledby="am-levels-title">
        <div className="am-card-head"><h3 id="am-levels-title">Roles</h3><Link className="am-link" to="/admin/access/roles">Edit roles</Link></div>
        <div className="am-table-wrap flush">
          <table className="am-table">
            <thead><tr><th>Role</th><th>What it allows</th><th className="num">People</th></tr></thead>
            <tbody>{live.length === 0
              ? <tr><td colSpan={3}><p className="am-empty">{notReady ? "Roles are not set up in this environment yet." : "No roles are defined yet."}</p></td></tr>
              : live.map((role) => <tr key={role.key}>
                <td><GrantChip name={role.name} privileged={isPrivilegedRole(role)} /></td>
                <td>{role.allActions
                  ? <span>Everything outside Access &amp; Identity</span>
                  : role.summary.length
                    ? <ul className="am-lines">{role.summary.slice(0, 3).map((line) => <li key={line}>{line}</li>)}{role.summary.length > 3 ? <li className="am-muted">and {role.summary.length - 3} more</li> : null}</ul>
                    : <span className="am-muted">Nothing yet</span>}</td>
                <td className="num">{role.members}</td>
              </tr>)}</tbody>
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
