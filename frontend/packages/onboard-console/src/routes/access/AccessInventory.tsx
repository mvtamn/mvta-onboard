import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { AccessHeldGrant, AccessPersonView, OnBoardAccessPrincipal, OnBoardSignInInformation } from "@mvta/shared";
import { api } from "../../config.js";
import { roleLabel } from "../../auth/roles.js";
import { useAccess as useMyAccess } from "../../auth/AccessContext.js";
import { AddAccessLink, Avatar, GrantChip, Icon, Loading, PageHead, Pill, RoleChip, SetupNotice } from "./AccessUi.js";
import { displayDate, displayTime, errorMessage, isPrivilegedRole, personLabel, principalAccountStatus, relativeTime, useAccess } from "./accessData.js";
import { ExportInventoryButton } from "./ExportInventoryButton.js";
import { RemoveAccessDialog } from "./RemoveAccessDialog.js";

type Removal = { person: AccessPersonView; grant: AccessHeldGrant; privileged: boolean };

const QUICK_FILTERS = [
  ["nothing", "Holds no role"],
  ["expiry", "Has an expiry"],
  ["never", "Never signed in"],
] as const;
type QuickFilter = (typeof QUICK_FILTERS)[number][0];

function matchesQuery(person: AccessPersonView, query: string): boolean {
  if (!query) return true;
  return [personLabel(person), person.email ?? "", person.objectId, ...person.roles.map((grant) => grant.roleName)]
    .some((value) => value.toLowerCase().includes(query));
}

function soonestExpiry(person: AccessPersonView): string | null {
  return person.roles.map((grant) => grant.expiresAt).filter((value): value is string => !!value).sort()[0] ?? null;
}

function ExpiryCell({ person }: { person: AccessPersonView }) {
  const expiry = soonestExpiry(person);
  if (!expiry) return <span className="am-muted">No expiry</span>;
  const days = (new Date(expiry).getTime() - Date.now()) / 86_400_000;
  if (days < 0) return <Pill tone="bad">Expired {displayDate(expiry)}</Pill>;
  if (days <= 14) return <Pill tone="warn">{displayDate(expiry)}</Pill>;
  return <span>{displayDate(expiry)}</span>;
}

// People & guests: everyone OnBoard knows, what each of them holds, and beside
// it whoever is selected. A person appears here once they have signed in - a
// grant names a person, not a group, and OnBoard learns the person from the
// sign-in - so the list is what OnBoard's own records say, not a Graph sweep.
export function AccessPeople() {
  const { people, roles, notReady, loading } = useAccess();
  const { can } = useMyAccess();
  const canManage = can("access-identity.manage");
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("all");
  const [kind, setKind] = useState<"all" | "member" | "guest">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const show = (params.get("show") ?? "") as QuickFilter | "";

  const visible = useMemo(() => {
    const text = query.trim().toLowerCase();
    return people.filter((person) =>
      matchesQuery(person, text)
      && (role === "all" || person.roles.some((grant) => grant.roleKey === role))
      && (kind === "all" || person.kind === kind)
      && (show !== "nothing" || person.roles.length === 0)
      && (show !== "expiry" || person.roles.some((grant) => !!grant.expiresAt))
      && (show !== "never" || !person.lastSeenAt));
  }, [kind, people, query, role, show]);
  const selected = people.find((person) => person.personId === selectedId) ?? null;
  const privilegedRole = (roleKey: string) => {
    const known = roles.find((item) => item.key === roleKey);
    return !!known && isPrivilegedRole(known);
  };

  function setShow(value: QuickFilter) {
    const next = new URLSearchParams(params);
    if (show === value) next.delete("show"); else next.set("show", value);
    setParams(next, { replace: true });
  }

  return <>
    <PageHead
      title="People & guests"
      description="Everyone OnBoard knows, and the roles they hold. Somebody appears here after their first sign-in; what they may do is decided by their OnBoard roles, not by Entra."
      actions={<><ExportInventoryButton /><AddAccessLink /></>}
    />
    {notReady ? <SetupNotice message={notReady} /> : null}
    <div className="am-toolbar">
      <label className="am-search"><Icon name="search" size={15} /><input type="search" aria-label="Search people" placeholder="Name, email or role" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <select className="am-select" aria-label="Filter role" value={role} onChange={(event) => setRole(event.target.value)}>
        <option value="all">All roles</option>
        {roles.filter((item) => !item.archived).map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}
      </select>
      <div className="am-seg" role="group" aria-label="Account type">
        {([["all", "All"], ["member", "Members"], ["guest", "Guests"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={kind === value} onClick={() => setKind(value)}>{label}</button>)}
      </div>
    </div>
    <div className="am-toolbar">
      {QUICK_FILTERS.map(([value, label]) => <button key={value} type="button" className="am-chip" aria-pressed={show === value} onClick={() => setShow(value)}>{show === value ? <Icon name="check" size={12} /> : null}{label}</button>)}
      <span className="am-toolbar-meta" role="status">Showing {visible.length} of {people.length}</span>
    </div>
    {loading && people.length === 0 ? <Loading label="Loading people…" /> : <div className={selected ? "am-split" : undefined}>
      <div className="am-table-wrap">
        <table className="am-table">
          <thead><tr><th>Person</th><th>OnBoard roles</th>{selected ? null : <><th>Last signed in</th><th>Expires</th></>}</tr></thead>
          <tbody>{visible.length === 0 ? <tr><td colSpan={selected ? 2 : 4}><p className="am-empty">{people.length ? "No people or guests match these filters." : "Nobody has signed in to OnBoard yet."}</p></td></tr> : visible.map((person) => {
            const name = personLabel(person);
            return <tr key={person.personId} className={person.personId === selectedId ? "is-selected" : undefined}>
              <td><div className="am-who">
                <Avatar name={name} kind={person.kind === "guest" ? "guest" : "person"} />
                <div><button type="button" className="am-name" aria-expanded={person.personId === selectedId} onClick={() => setSelectedId(person.personId === selectedId ? null : person.personId)}>{name}</button><small>{person.email || person.objectId}</small></div>
              </div></td>
              <td>{person.roles.length
                ? <div className="am-stack">{person.roles.map((grant) => <GrantChip key={grant.grantId} name={grant.roleName} privileged={privilegedRole(grant.roleKey)} />)}</div>
                : <span className="am-muted">No roles</span>}</td>
              {selected ? null : <>
                <td>{person.lastSeenAt ? <span title={displayTime(person.lastSeenAt)}>{relativeTime(person.lastSeenAt)}</span> : <span className="am-muted">Never</span>}</td>
                <td><ExpiryCell person={person} /></td>
              </>}
            </tr>;
          })}</tbody>
        </table>
      </div>
      {selected ? <PersonDetail
        key={selected.personId}
        person={selected}
        canManage={canManage}
        onClose={() => setSelectedId(null)}
        onRemove={(grant) => setRemoval({ person: selected, grant, privileged: privilegedRole(grant.roleKey) })}
      /> : null}
    </div>}
    {removal ? <RemoveAccessDialog person={removal.person} grant={removal.grant} privileged={removal.privileged} onClose={() => setRemoval(null)} /> : null}
  </>;
}

function PersonDetail({ person, canManage, onClose, onRemove }: {
  person: AccessPersonView;
  canManage: boolean;
  onClose: () => void;
  onRemove: (grant: AccessHeldGrant) => void;
}) {
  const [signIns, setSignIns] = useState<OnBoardSignInInformation | null>(null);
  const [signInsLoading, setSignInsLoading] = useState(false);
  const [signInsError, setSignInsError] = useState<string | null>(null);
  const name = personLabel(person);

  // Sign-ins are read from Entra on request and every read is audited, so
  // selecting a person does not fetch them.
  async function loadSignIns() {
    setSignInsLoading(true);
    setSignInsError(null);
    try {
      setSignIns(await api.getAccessSignIns(person.objectId));
    } catch (error) {
      setSignInsError(errorMessage(error, "Sign-in evidence is unavailable."));
    } finally {
      setSignInsLoading(false);
    }
  }

  return <aside className="am-detail" aria-label={`Access for ${name}`}>
    <div className="am-detail-top">
      <div className="am-detail-id">
        <Avatar name={name} kind={person.kind === "guest" ? "guest" : "person"} size="lg" />
        <div className="am-grow"><h3>{name}</h3><small>{person.email || person.objectId}</small></div>
        <button type="button" className="btn-icon" aria-label="Close details" onClick={onClose}>×</button>
      </div>
      <div className="am-stack">
        <Pill tone={person.kind === "guest" ? "info" : "mute"}>{person.kind === "guest" ? "Guest" : "Member"}</Pill>
        <Pill tone={person.status === "active" ? "ok" : "mute"}>{person.status === "active" ? "Active" : person.status}</Pill>
        <ExpiryCell person={person} />
      </div>
    </div>
    <section className="am-detail-sec">
      <h4>Access summary</h4>
      {person.summary.length
        ? <ul className="am-lines">{person.summary.map((line) => <li key={line}>{line}</li>)}</ul>
        : <p className="am-fine">Holds no role, so OnBoard shows them the No access page.</p>}
    </section>
    <section className="am-detail-sec">
      <h4>Roles held</h4>
      {person.roles.length ? person.roles.map((grant) => <div key={grant.grantId} className="am-assign">
        <div>
          <GrantChip name={grant.roleName} />
          <small>
            Granted {displayDate(grant.grantedAt)}{grant.grantedBy ? ` by ${grant.grantedBy}` : ""}
            {grant.approvedBy ? ` · approved by ${grant.approvedBy}` : ""}
            {grant.expiresAt ? ` · expires ${displayDate(grant.expiresAt)}` : ""}
          </small>
        </div>
        {canManage ? <button type="button" className="am-btn sm" aria-label={`Remove access: ${grant.roleName} for ${name}`} onClick={() => onRemove(grant)}>Remove</button> : null}
      </div>) : <p className="am-fine">No roles granted.</p>}
    </section>
    {person.kind === "guest" ? <section className="am-detail-sec">
      <h4>Guest</h4>
      <dl className="am-facts">
        <div><dt>Sponsor</dt><dd>{person.sponsorName || "Not recorded"}</dd></div>
        <div><dt>Organization</dt><dd>{person.organization || "Not recorded"}</dd></div>
        <div><dt>Why</dt><dd>{person.justification || "Not recorded"}</dd></div>
      </dl>
      <p className="am-fine">The invitation itself is an Entra guest invitation. OnBoard records the sponsor and what they are here for.</p>
    </section> : null}
    <section className="am-detail-sec">
      <h4>Sign-ins{signIns ? <button type="button" className="am-btn ghost sm" disabled={signInsLoading} onClick={() => void loadSignIns()}><Icon name="refresh" size={13} />Refresh</button> : null}</h4>
      <p className="am-fine">Last seen by OnBoard {person.lastSeenAt ? displayTime(person.lastSeenAt) : "never"}.{person.importedFrom ? ` Imported from ${person.importedFrom}.` : ""}</p>
      {!signIns ? <>
        <button type="button" className="am-btn sm" disabled={signInsLoading} onClick={() => void loadSignIns()}>{signInsLoading ? "Reading from Entra…" : "View sign-ins"}</button>
        <p className="am-fine">Read from Entra when asked, not stored in OnBoard. Each view is recorded in the activity log.</p>
      </> : <>
        <h5 className="am-fine"><b>Directory-wide sign-in summary</b> · any app, not necessarily OnBoard</h5>
        <dl className="am-facts">
          <div><dt>Last successful</dt><dd>{displayTime(signIns.directory_summary?.last_successful_at)}</dd></div>
          <div><dt>Last interactive attempt</dt><dd>{displayTime(signIns.directory_summary?.last_interactive_attempt_at)}</dd></div>
          <div><dt>Last non-interactive</dt><dd>{displayTime(signIns.directory_summary?.last_noninteractive_at)}</dd></div>
        </dl>
        <h5 className="am-fine"><b>OnBoard-specific sign-in events</b></h5>
        {signIns.onboard_events.events.length ? <ul className="am-events">{signIns.onboard_events.events.map((event) => <li key={`${event.occurred_at}-${event.correlation_id}`}>
          <span className={`am-dot${event.successful ? "" : " bad"}`} /><span className="am-grow">{displayTime(event.occurred_at)}</span><span>{event.successful ? "Successful" : "Failed"} · {event.client_app || "Unknown client"}</span>
        </li>)}</ul> : <p className="am-fine">No OnBoard sign-ins within the tenant’s retention window.</p>}
        <p className="am-fine">Read from Entra {displayTime(signIns.onboard_events.queried_at)}. Detailed events are not copied into OnBoard.</p>
      </>}
      {signInsError ? <p className="am-check bad" role="alert">{signInsError}</p> : null}
    </section>
  </aside>;
}

// Access groups and Workloads are what Entra has, in two readings: a security
// group assigned to the enterprise application, or a workload identity that
// calls OnBoard unattended. Since ADR-0032 neither decides what a person may
// do - a group assignment only gates sign-in - so these pages read, and the
// grants that matter are made in People & guests.
export function AccessPrincipalTable({ kind }: { kind: "groups" | "workloads" }) {
  const { principals, loading } = useAccess();
  const [query, setQuery] = useState("");
  const isGroups = kind === "groups";
  const type = isGroups ? "group" : "service_principal";
  const text = query.trim().toLowerCase();
  const matches = (principal: OnBoardAccessPrincipal) => !text
    || principal.display_name.toLowerCase().includes(text)
    || !!principal.sign_in_name?.toLowerCase().includes(text)
    || principal.id.toLowerCase().includes(text)
    || principal.effective_roles.some((role) => role.toLowerCase().includes(text) || roleLabel(role).toLowerCase().includes(text));
  const rows = principals.filter((principal) => principal.principal_type === type && matches(principal));
  const total = principals.filter((principal) => principal.principal_type === type).length;

  return <>
    <PageHead
      title={isGroups ? "Access groups" : "Workloads"}
      description={isGroups
        ? "Security groups assigned to the OnBoard enterprise application in Entra. These decide who may sign in; what a person may do once inside is the roles they hold in People & guests."
        : "Apps and services that call OnBoard without a person signed in. A workload holds Automated System Ingestion as an Entra app role, which is the one role OnBoard still reads from a token."}
      actions={<ExportInventoryButton />}
    />
    <div className="am-toolbar">
      <label className="am-search"><Icon name="search" size={15} /><input type="search" aria-label={isGroups ? "Search groups" : "Search workloads"} placeholder={isGroups ? "Group or assignment" : "Workload or assignment"} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <span className="am-toolbar-meta" role="status">{rows.length === total ? `${total} ${isGroups ? (total === 1 ? "group" : "groups") : (total === 1 ? "workload" : "workloads")}` : `Showing ${rows.length} of ${total}`}</span>
    </div>
    {loading && total === 0 ? <Loading label="Loading…" /> : <div className="am-table-wrap">
      <table className="am-table">
        <thead><tr>
          <th>{isGroups ? "Access group" : "Workload"}</th>
          <th>Entra app role</th>
          {isGroups ? null : <th>Health</th>}
          <th>Account</th>
        </tr></thead>
        <tbody>{rows.length === 0 ? <tr><td colSpan={4}><p className="am-empty">{isGroups ? "No access groups match." : "No workloads match."}</p></td></tr> : rows.map((principal) => {
          const status = principalAccountStatus(principal);
          const humanRoles = principal.assignments.filter((assignment) => assignment.role !== "System.Ingestion");
          return <tr key={principal.id}>
            <td><div className="am-who"><Avatar name={principal.display_name} kind={isGroups ? "group" : "workload"} /><div><b>{principal.display_name}</b><small>{principal.sign_in_name || principal.id}</small></div></div></td>
            <td>{principal.assignments.length ? <div className="am-stack">{principal.assignments.map((assignment) => <RoleChip key={`${assignment.role}-${assignment.source_id}`} role={assignment.role} />)}</div> : <span className="am-muted">No app role</span>}</td>
            {isGroups ? null : <td>{humanRoles.length ? <Pill tone="bad" icon="warn">Holds a person’s app role</Pill> : <Pill tone="ok">OK</Pill>}</td>}
            <td><Pill tone={status.tone}>{status.label}</Pill></td>
          </tr>;
        })}</tbody>
      </table>
    </div>}
    <p className="am-callout"><Icon name="info" /><span>{isGroups
      ? <><b>Sign-in only.</b> Being in one of these groups lets somebody reach OnBoard; it grants nothing inside it. Change these assignments in the Entra admin center.</>
      : <>Automated System Ingestion stays an Entra app role: a workload identity has no person record, so a token claim is the right carrier for it.</>}</span></p>
  </>;
}

export const AccessGroups = () => <AccessPrincipalTable kind="groups" />;
export const AccessWorkloads = () => <AccessPrincipalTable kind="workloads" />;
