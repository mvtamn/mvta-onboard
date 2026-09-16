import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { OnBoardAccessAssignment, OnBoardAccessPrincipal, OnBoardSignInInformation } from "@mvta/shared";
import { api } from "../../config.js";
import { roleLabel } from "../../auth/roles.js";
import { AddAccessLink, Avatar, Icon, Loading, PageHead, Pill, RoleChip } from "./AccessUi.js";
import { HUMAN_ROLES, displayDate, displayTime, errorMessage, needsAttention, principalAccountStatus, useAccess } from "./accessData.js";
import { ExportInventoryButton } from "./ExportInventoryButton.js";
import { RemoveAccessDialog } from "./RemoveAccessDialog.js";

type Removal = { principal: OnBoardAccessPrincipal; assignment: OnBoardAccessAssignment };

const QUICK_FILTERS = [
  ["direct", "Direct access"],
  ["expiry", "Has expiry"],
  ["attention", "Needs attention"],
  ["missing", "Missing in Entra"],
] as const;
type QuickFilter = (typeof QUICK_FILTERS)[number][0];

function sourceText(assignment: OnBoardAccessAssignment): string {
  if (assignment.source === "group") return `via ${assignment.source_name}`;
  return assignment.is_exception ? "direct exception" : "direct assignment";
}

function matchesQuery(principal: OnBoardAccessPrincipal, query: string): boolean {
  if (!query) return true;
  return principal.display_name.toLowerCase().includes(query)
    || !!principal.sign_in_name?.toLowerCase().includes(query)
    || principal.id.toLowerCase().includes(query)
    || principal.effective_roles.some((role) => role.toLowerCase().includes(query) || roleLabel(role).toLowerCase().includes(query));
}

function soonestExpiry(principal: OnBoardAccessPrincipal): string | null {
  return principal.assignments.map((assignment) => assignment.expires_at).filter((value): value is string => !!value).sort()[0] ?? null;
}

function ExpiryCell({ principal }: { principal: OnBoardAccessPrincipal }) {
  const expiry = soonestExpiry(principal);
  if (principal.assignments.some((assignment) => assignment.lifecycle_status === "expiry_failed")) return <Pill tone="bad" icon="warn">Expiry failed</Pill>;
  if (!expiry) return <span className="am-muted">No expiry</span>;
  const days = (new Date(expiry).getTime() - Date.now()) / 86_400_000;
  if (days < 0) return <Pill tone="bad">Expired {displayDate(expiry)}</Pill>;
  if (days <= 14) return <Pill tone="warn">{displayDate(expiry)}</Pill>;
  return <span>{displayDate(expiry)}</span>;
}

// People & guests: the list, and beside it whoever is selected.
export function AccessPeople() {
  const { principals, loading } = useAccess();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("all");
  const [kind, setKind] = useState<"all" | "member" | "guest">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const show = (params.get("show") ?? "") as QuickFilter | "";

  const people = useMemo(() => principals.filter((principal) => principal.principal_type === "user"), [principals]);
  const visible = useMemo(() => {
    const text = query.trim().toLowerCase();
    return people.filter((principal) =>
      matchesQuery(principal, text)
      && (role === "all" || principal.effective_roles.includes(role as never))
      && (kind === "all" || (kind === "guest") === !!principal.guest_state)
      && (show !== "direct" || principal.assignments.some((assignment) => assignment.source === "direct"))
      && (show !== "expiry" || principal.assignments.some((assignment) => !!assignment.expires_at))
      && (show !== "attention" || needsAttention(principal))
      && (show !== "missing" || principal.directory_status === "missing"));
  }, [kind, people, query, role, show]);
  const selected = people.find((principal) => principal.id === selectedId) ?? null;

  function setShow(value: QuickFilter) {
    const next = new URLSearchParams(params);
    if (show === value) next.delete("show"); else next.set("show", value);
    setParams(next, { replace: true });
  }

  return <>
    <PageHead
      title="People & guests"
      description="Everyone with OnBoard access and where it comes from. Select a person to see their access and sign-in activity."
      actions={<><ExportInventoryButton /><AddAccessLink /></>}
    />
    <div className="am-toolbar">
      <label className="am-search"><Icon name="search" size={15} /><input type="search" aria-label="Search people" placeholder="Name, sign-in name or access level" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <select className="am-select" aria-label="Filter access level" value={role} onChange={(event) => setRole(event.target.value)}>
        <option value="all">All access levels</option>
        {HUMAN_ROLES.map((item) => <option key={item} value={item}>{roleLabel(item)}</option>)}
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
          <thead><tr><th>Person</th><th>OnBoard access</th>{selected ? null : <><th>Account</th><th>Expires</th></>}</tr></thead>
          <tbody>{visible.length === 0 ? <tr><td colSpan={selected ? 2 : 4}><p className="am-empty">No people or guests match these filters.</p></td></tr> : visible.map((principal) => {
            const status = principalAccountStatus(principal);
            return <tr key={principal.id} className={principal.id === selectedId ? "is-selected" : undefined}>
              <td><div className="am-who">
                <Avatar name={principal.display_name} kind={principal.directory_status === "missing" ? "missing" : principal.guest_state ? "guest" : "person"} />
                <div><button type="button" className="am-name" aria-expanded={principal.id === selectedId} onClick={() => setSelectedId(principal.id === selectedId ? null : principal.id)}>{principal.display_name}</button><small>{principal.sign_in_name || principal.id}</small></div>
              </div></td>
              <td>{principal.assignments.length ? <div className="am-stack">{principal.assignments.map((assignment) => <span key={`${assignment.role}-${assignment.source}-${assignment.source_id}`} className="am-stack" title={sourceText(assignment)}>
                <RoleChip role={assignment.role} />{assignment.source === "direct" ? <Pill tone="warn">Direct</Pill> : null}
              </span>)}</div> : <span className="am-muted">No access</span>}</td>
              {selected ? null : <><td><Pill tone={status.tone}>{status.label}</Pill></td><td><ExpiryCell principal={principal} /></td></>}
            </tr>;
          })}</tbody>
        </table>
      </div>
      {selected ? <PersonDetail key={selected.id} principal={selected} onClose={() => setSelectedId(null)} onRemove={(assignment) => setRemoval({ principal: selected, assignment })} /> : null}
    </div>}
    {removal ? <RemoveAccessDialog principal={removal.principal} assignment={removal.assignment} onClose={() => setRemoval(null)} /> : null}
  </>;
}

function PersonDetail({ principal, onClose, onRemove }: { principal: OnBoardAccessPrincipal; onClose: () => void; onRemove: (assignment: OnBoardAccessAssignment) => void }) {
  const [signIns, setSignIns] = useState<OnBoardSignInInformation | null>(null);
  const [signInsLoading, setSignInsLoading] = useState(false);
  const [signInsError, setSignInsError] = useState<string | null>(null);
  const status = principalAccountStatus(principal);

  // Sign-ins are read from Entra on request and every read is audited, so
  // selecting a person does not fetch them.
  async function loadSignIns() {
    setSignInsLoading(true);
    setSignInsError(null);
    try {
      setSignIns(await api.getAccessSignIns(principal.id));
    } catch (error) {
      setSignInsError(errorMessage(error, "Sign-in evidence is unavailable."));
    } finally {
      setSignInsLoading(false);
    }
  }

  return <aside className="am-detail" aria-label={`Access for ${principal.display_name}`}>
    <div className="am-detail-top">
      <div className="am-detail-id">
        <Avatar name={principal.display_name} kind={principal.directory_status === "missing" ? "missing" : principal.guest_state ? "guest" : "person"} size="lg" />
        <div className="am-grow"><h3>{principal.display_name}</h3><small>{principal.sign_in_name || principal.id}</small></div>
        <button type="button" className="btn-icon" aria-label="Close details" onClick={onClose}>×</button>
      </div>
      <div className="am-stack"><Pill tone={status.tone}>{status.label}</Pill>{principal.guest_state ? null : <Pill tone="mute">Member</Pill>}<ExpiryCell principal={principal} /></div>
    </div>
    <section className="am-detail-sec">
      <h4>OnBoard access</h4>
      {principal.assignments.length ? principal.assignments.map((assignment) => <div key={`${assignment.role}-${assignment.source}-${assignment.source_id}`} className="am-assign">
        <div>
          <RoleChip role={assignment.role} />
          <small>{sourceText(assignment)}{assignment.expires_at ? ` · expires ${displayDate(assignment.expires_at)}` : ""}{assignment.sponsor ? ` · sponsor ${assignment.sponsor}` : ""}</small>
        </div>
        <button type="button" className="am-btn sm" aria-label={`Remove access: ${roleLabel(assignment.role)} for ${principal.display_name}`} onClick={() => onRemove(assignment)}>Remove</button>
      </div>) : <p className="am-fine">No effective roles.</p>}
    </section>
    <section className="am-detail-sec">
      <h4>Sign-ins{signIns ? <button type="button" className="am-btn ghost sm" disabled={signInsLoading} onClick={() => void loadSignIns()}><Icon name="refresh" size={13} />Refresh</button> : null}</h4>
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

// Access groups and Workloads are one table in two readings: a security group
// that grants a level, or a workload identity that calls OnBoard unattended.
export function AccessPrincipalTable({ kind }: { kind: "groups" | "workloads" }) {
  const { principals, loading } = useAccess();
  const [query, setQuery] = useState("");
  const [removal, setRemoval] = useState<Removal | null>(null);
  const isGroups = kind === "groups";
  const type = isGroups ? "group" : "service_principal";
  const rows = principals.filter((principal) => principal.principal_type === type && matchesQuery(principal, query.trim().toLowerCase()));
  const total = principals.filter((principal) => principal.principal_type === type).length;
  const membersWithAccess = (groupId: string) => principals.filter((principal) => principal.principal_type === "user" && principal.assignments.some((assignment) => assignment.source_id === groupId)).length;
  const action = isGroups ? "Remove group assignment" : "Remove workload access";

  return <>
    <PageHead
      title={isGroups ? "Access groups" : "Workloads"}
      description={isGroups
        ? "Each access level is granted through an Entra security group. Removing a group’s assignment changes that group’s OnBoard access; its members stay in the group."
        : "Apps and services that call OnBoard without a person signed in. A workload should hold only Automated System Ingestion; its access is managed apart from people and groups."}
      actions={<ExportInventoryButton />}
    />
    <div className="am-toolbar">
      <label className="am-search"><Icon name="search" size={15} /><input type="search" aria-label={isGroups ? "Search groups" : "Search workloads"} placeholder={isGroups ? "Group or access level" : "Workload or access level"} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <span className="am-toolbar-meta" role="status">{rows.length === total ? `${total} ${isGroups ? (total === 1 ? "group" : "groups") : (total === 1 ? "workload" : "workloads")}` : `Showing ${rows.length} of ${total}`}</span>
    </div>
    {loading && total === 0 ? <Loading label="Loading…" /> : <div className="am-table-wrap">
      <table className="am-table">
        <thead><tr>
          <th>{isGroups ? "Access group" : "Workload"}</th>
          <th>Assigned OnBoard access</th>
          {isGroups ? <th className="num">Members with access</th> : <th>Health</th>}
          <th>Account</th>
        </tr></thead>
        <tbody>{rows.length === 0 ? <tr><td colSpan={4}><p className="am-empty">{isGroups ? "No access groups match." : "No workloads match."}</p></td></tr> : rows.map((principal) => {
          const status = principalAccountStatus(principal);
          const humanRoles = principal.assignments.filter((assignment) => assignment.role !== "System.Ingestion");
          return <tr key={principal.id}>
            <td><div className="am-who"><Avatar name={principal.display_name} kind={isGroups ? "group" : "workload"} /><div><b>{principal.display_name}</b><small>{principal.sign_in_name || principal.id}</small></div></div></td>
            <td>{principal.assignments.length ? <div className="am-grants">{principal.assignments.map((assignment) => <div key={`${assignment.role}-${assignment.source}-${assignment.source_id}`} className="am-grant">
              <RoleChip role={assignment.role} />
              {assignment.expires_at ? <span className="am-fine">until {displayDate(assignment.expires_at)}</span> : null}
              <button type="button" className="am-link" aria-label={`${action}: ${roleLabel(assignment.role)} for ${principal.display_name}`} onClick={() => setRemoval({ principal, assignment })}>Remove</button>
            </div>)}</div> : <span className="am-muted">No effective roles</span>}</td>
            {isGroups
              ? <td className="num">{membersWithAccess(principal.id)}</td>
              : <td>{humanRoles.length ? <Pill tone="bad" icon="warn">Holds a person’s role</Pill> : <Pill tone="ok">OK</Pill>}</td>}
            <td><Pill tone={status.tone}>{status.label}</Pill></td>
          </tr>;
        })}</tbody>
      </table>
    </div>}
    <p className="am-callout"><Icon name="info" /><span>{isGroups
      ? <><b>Why groups first.</b> Granting access through a group keeps Entra the one place to see who has what. Direct assignment to a person is still possible from Add access, and is recorded as an exception.</>
      : <>To give a workload access, use Add access and select the workload; only Automated System Ingestion is offered for it.</>}</span></p>
    {removal ? <RemoveAccessDialog principal={removal.principal} assignment={removal.assignment} onClose={() => setRemoval(null)} /> : null}
  </>;
}

export const AccessGroups = () => <AccessPrincipalTable kind="groups" />;
export const AccessWorkloads = () => <AccessPrincipalTable kind="workloads" />;
