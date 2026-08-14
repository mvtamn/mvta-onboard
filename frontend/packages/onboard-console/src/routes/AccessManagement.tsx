import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  type AccessAssignmentSource,
  type OnBoardAccessAuditEntry,
  type OnBoardAccessAssignment,
  type OnBoardAccessChangeRecord,
  type OnBoardAccessMetadata,
  type OnBoardAccessPrincipal,
  type OnBoardAccessRole,
  type OnBoardAccessReconciliationReport,
  type OnBoardDirectoryChange,
  type OnBoardSignInInformation,
} from "@mvta/shared";
import { api } from "../config.js";
import { useAuth } from "../auth/AuthContext.js";

const HUMAN_ROLES: OnBoardAccessRole[] = [
  "OCC.Viewer",
  "OCC.Publisher",
  "OCC.Admin",
  "OCC.Compliance",
  "OCC.ComplianceManager",
  "OCC.Detour",
  "OCC.AccessAdmin",
];

type Tab = "access" | "onboarding" | "approvals" | "reconciliation" | "audit";

function displayTime(value: string | null): string {
  if (!value) return "Unavailable";
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

function idempotencyKey(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
}

export function spreadsheetSafeText(value: unknown): string {
  const text = String(value ?? "");
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

export function AccessManagement() {
  const { account } = useAuth();
  const [tab, setTab] = useState<Tab>("access");
  const [principals, setPrincipals] = useState<OnBoardAccessPrincipal[]>([]);
  const [pending, setPending] = useState<OnBoardAccessChangeRecord[]>([]);
  const [expirations, setExpirations] = useState<OnBoardAccessMetadata[]>([]);
  const [audit, setAudit] = useState<OnBoardAccessAuditEntry[]>([]);
  const [environment, setEnvironment] = useState("");
  const [accessAdminFallback, setAccessAdminFallback] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [principalType, setPrincipalType] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [guestFilter, setGuestFilter] = useState("all");
  const [expiryFilter, setExpiryFilter] = useState("all");
  const [reconciliationFilter, setReconciliationFilter] = useState("all");
  const [signIns, setSignIns] = useState<{ principal: OnBoardAccessPrincipal; data: OnBoardSignInInformation } | null>(null);
  const [signInsLoading, setSignInsLoading] = useState(false);
  const [reconciliation, setReconciliation] = useState<OnBoardAccessReconciliationReport | null>(null);
  const [selectedRepairs, setSelectedRepairs] = useState<number[]>([]);
  const [repairPreview, setRepairPreview] = useState<Awaited<ReturnType<typeof api.previewAccessChanges>> | null>(null);
  const [revokeDraft, setRevokeDraft] = useState<{
    principal: OnBoardAccessPrincipal;
    assignment: OnBoardAccessAssignment;
    reason: string;
    preview: Awaited<ReturnType<typeof api.previewAccessChanges>> | null;
  } | null>(null);

  const [onboardingMode, setOnboardingMode] = useState<"directory" | "guest">("directory");
  const [directoryQuery, setDirectoryQuery] = useState("");
  const [candidates, setCandidates] = useState<OnBoardAccessPrincipal[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<OnBoardAccessRole[]>(["OCC.Viewer"]);
  const [source, setSource] = useState<AccessAssignmentSource>("group");
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [sponsor, setSponsor] = useState("");
  const [organization, setOrganization] = useState("");
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof api.previewAccessChanges>> | null>(null);
  const [results, setResults] = useState<Awaited<ReturnType<typeof api.submitAccessChanges>> | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [access, changes, expiry, auditLog] = await Promise.all([
        api.getAccessPrincipals(),
        api.getPendingAccessChanges(),
        api.getAccessExpirations(),
        api.getAccessAudit(),
      ]);
      setPrincipals(access.principals);
      setEnvironment(access.environment);
      setAccessAdminFallback(access.access_admin_fallback);
      setPending(changes.changes);
      setExpirations(expiry.expirations);
      setAudit(auditLog.audit);
      setError(null);
    } catch (loadError) {
      setError(errorMessage(loadError, "Access Management could not be loaded."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    if (tab !== "reconciliation" || reconciliation) return;
    setBusy(true);
    api.getAccessReconciliation()
      .then((report) => { setReconciliation(report); setError(null); })
      .catch((reconcileError) => setError(errorMessage(reconcileError, "Access reconciliation failed.")))
      .finally(() => setBusy(false));
  }, [reconciliation, tab]);

  const visiblePrincipals = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return principals.filter((principal) =>
      (principalType === "all" || principal.principal_type === principalType)
      && (roleFilter === "all" || principal.effective_roles.includes(roleFilter as OnBoardAccessRole))
      && (sourceFilter === "all" || principal.assignments.some((assignment) => assignment.source === sourceFilter))
      && (guestFilter === "all" || (guestFilter === "guest") === !!principal.guest_state)
      && (expiryFilter === "all" || (expiryFilter === "expiring") === principal.assignments.some((assignment) => !!assignment.expires_at))
      && (reconciliationFilter === "all" || (reconciliationFilter === "missing") === (principal.directory_status === "missing"))
      && (!query
        || principal.display_name.toLowerCase().includes(query)
        || principal.sign_in_name?.toLowerCase().includes(query)
        || principal.id.toLowerCase().includes(query)
        || principal.effective_roles.some((role) => role.toLowerCase().includes(query))),
    );
  }, [expiryFilter, filter, guestFilter, principalType, principals, reconciliationFilter, roleFilter, sourceFilter]);

  async function showSignIns(principal: OnBoardAccessPrincipal) {
    setSignInsLoading(true);
    setError(null);
    try {
      setSignIns({ principal, data: await api.getAccessSignIns(principal.id) });
    } catch (signInError) {
      setError(errorMessage(signInError, "Sign-in evidence is unavailable."));
    } finally {
      setSignInsLoading(false);
    }
  }

  async function searchDirectory() {
    if (directoryQuery.trim().length < 2) {
      setError("Enter at least two characters to search Entra ID.");
      return;
    }
    setBusy(true);
    try {
      const response = await api.searchAccessDirectory(directoryQuery.trim());
      setCandidates(response.candidates);
      setSelectedIds([]);
      setPreview(null);
      setError(null);
    } catch (searchError) {
      setError(errorMessage(searchError, "Directory search failed."));
    } finally {
      setBusy(false);
    }
  }

  function plannedChanges(): OnBoardDirectoryChange[] {
    if (onboardingMode === "guest") {
      return selectedRoles.map((role) => ({
        action: "invite_guest",
        principal_id: guestEmail.trim(),
        principal_type: "user",
        role,
        source: "group",
        reason: reason.trim(),
        sponsor: sponsor.trim(),
        organization: organization.trim(),
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      }));
    }
    return candidates
      .filter((candidate) => selectedIds.includes(candidate.id))
      .flatMap((candidate) => selectedRoles.map((role): OnBoardDirectoryChange => ({
        action: "grant",
        principal_id: candidate.id,
        principal_type: candidate.principal_type,
        role,
        source: candidate.principal_type === "group" ? "direct" : source,
        reason: reason.trim(),
        ...(expiresAt ? { expires_at: new Date(expiresAt).toISOString() } : {}),
      })));
  }

  async function previewChanges() {
    const changes = plannedChanges();
    if (changes.length === 0) {
      setError(onboardingMode === "guest" ? "Enter a guest and select at least one role." : "Select at least one directory principal and role.");
      return;
    }
    setBusy(true);
    try {
      setPreview(await api.previewAccessChanges(changes));
      setResults(null);
      setError(null);
    } catch (previewError) {
      setError(errorMessage(previewError, "The onboarding preview failed."));
    } finally {
      setBusy(false);
    }
  }

  async function submitChanges() {
    if (!preview?.valid) return;
    setBusy(true);
    try {
      const submitted = await api.submitAccessChanges(plannedChanges(), idempotencyKey("onboard"));
      setResults(submitted);
      setNotice("Directory Onboarding submitted. Review each item outcome below.");
      setPreview(null);
      await load();
    } catch (submitError) {
      setError(errorMessage(submitError, "Directory Onboarding failed."));
    } finally {
      setBusy(false);
    }
  }

  async function decide(change: OnBoardAccessChangeRecord, decision: "approved" | "rejected") {
    setBusy(true);
    try {
      await api.decideAccessChange(change.id, decision, idempotencyKey(`access-${decision}`));
      setNotice(`Privileged access change ${decision}.`);
      await load();
    } catch (decisionError) {
      setError(errorMessage(decisionError, "The privileged decision failed."));
    } finally {
      setBusy(false);
    }
  }

  async function cancelChange(change: OnBoardAccessChangeRecord) {
    const cancellationReason = window.prompt("Why is this privileged access request no longer needed?");
    if (!cancellationReason?.trim()) return;
    setBusy(true);
    try {
      await api.cancelAccessChange(change.id, cancellationReason.trim());
      setNotice("Privileged access request cancelled.");
      await load();
    } catch (cancelError) {
      setError(errorMessage(cancelError, "The privileged request could not be cancelled."));
    } finally {
      setBusy(false);
    }
  }

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

  function repairChanges(): OnBoardDirectoryChange[] {
    return (reconciliation?.findings ?? [])
      .filter((_finding, index) => selectedRepairs.includes(index))
      .flatMap((finding) => finding.repair_change ? [finding.repair_change] : []);
  }

  async function previewRepairs() {
    const changes = repairChanges();
    if (changes.length === 0) {
      setError("Select at least one repairable reconciliation finding.");
      return;
    }
    setBusy(true);
    try {
      setRepairPreview(await api.previewAccessChanges(changes));
      setError(null);
    } catch (repairError) {
      setError(errorMessage(repairError, "The reconciliation repair preview failed."));
    } finally {
      setBusy(false);
    }
  }

  async function confirmRepairs() {
    if (!repairPreview?.valid) return;
    setBusy(true);
    try {
      await api.submitAccessChanges(repairChanges(), idempotencyKey("reconcile"));
      setNotice("Selected reconciliation repairs were submitted; privileged repairs may await approval.");
      setRepairPreview(null);
      setSelectedRepairs([]);
      setReconciliation(await api.getAccessReconciliation());
      await load();
    } catch (repairError) {
      setError(errorMessage(repairError, "Reconciliation repair failed."));
    } finally {
      setBusy(false);
    }
  }

  function revocationChange(): OnBoardDirectoryChange | null {
    if (!revokeDraft) return null;
    return {
      action: "revoke",
      principal_id: revokeDraft.principal.id,
      principal_type: revokeDraft.principal.principal_type,
      role: revokeDraft.assignment.role,
      source: revokeDraft.assignment.source,
      source_id: revokeDraft.assignment.source_id,
      reason: revokeDraft.reason.trim(),
    };
  }

  async function previewRevocation() {
    const change = revocationChange();
    if (!change?.reason) {
      setError("A revocation reason is required.");
      return;
    }
    setBusy(true);
    try {
      const nextPreview = await api.previewAccessChanges([change]);
      setRevokeDraft((draft) => draft ? { ...draft, preview: nextPreview } : null);
      setError(null);
    } catch (revokeError) {
      setError(errorMessage(revokeError, "The revocation preview failed."));
    } finally {
      setBusy(false);
    }
  }

  async function confirmRevocation() {
    const change = revocationChange();
    if (!change || !revokeDraft?.preview?.valid) return;
    setBusy(true);
    try {
      const response = await api.submitAccessChanges([change], idempotencyKey("revoke"));
      setNotice(response.results[0]?.disposition === "pending_approval"
        ? "Privileged revocation is awaiting a second Access Administrator."
        : "Access revocation submitted.");
      setRevokeDraft(null);
      await load();
    } catch (revokeError) {
      setError(errorMessage(revokeError, "Access could not be revoked."));
    } finally {
      setBusy(false);
    }
  }

  async function exportInventory() {
    const quote = (value: unknown) => `"${spreadsheetSafeText(value).replaceAll('"', '""')}"`;
    setBusy(true);
    try {
      const exportData = await api.exportAccessInventory();
      const rows = exportData.rows.map((row) => [
        row.display_name, row.sign_in_name, row.principal_type, row.account_enabled,
        row.guest_state, row.effective_roles.join("; "), row.role, row.source, row.source_name, row.sponsor,
        row.organization, row.expires_at, row.reconciliation_status, exportData.environment,
      ]);
      const csv = [
        ["Name", "Sign-in name", "Principal type", "Account enabled", "Guest state", "Effective roles", "Role", "Source", "Source name", "Sponsor", "Organization", "Expiry", "Reconciliation", "Environment"],
        ...rows,
      ].map((row) => row.map(quote).join(",")).join("\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `onboard-access-${exportData.environment}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice("Safe access inventory exported and recorded in the administrative audit.");
    } catch (exportError) {
      setError(errorMessage(exportError, "Access inventory export failed."));
    } finally {
      setBusy(false);
    }
  }

  const roleChoices = onboardingMode === "directory"
    && selectedIds.length > 0
    && candidates.filter((candidate) => selectedIds.includes(candidate.id)).every((candidate) => candidate.principal_type === "service_principal")
    ? ["System.Ingestion" as const]
    : HUMAN_ROLES;

  return <section className="access-management">
    <div className="panel-header access-management-header">
      <span>Admin — Access Management</span>
      <span className="env-badge">{environment || "Loading environment"}</span>
    </div>
    <div className="panel-body">
      <p className="panel-desc">
        Manage access specifically to MVTA OnBoard. Microsoft Entra ID remains the identity source of truth; this module never stores passwords or disables tenant accounts.
      </p>
      {accessAdminFallback ? <p className="warning-text" role="status">Temporary bootstrap mode is active: `OCC.Admin` can operate Access Management until `OCC.AccessAdmin` is provisioned. Remove this fallback after verification.</p> : null}
      <div className="access-tabs" role="tablist" aria-label="Access Management sections">
        {([
          ["access", "Effective access"],
          ["onboarding", "Directory Onboarding"],
          ["approvals", `Approvals (${pending.length})`],
          ["reconciliation", "Reconciliation"],
          ["audit", "Administrative audit"],
        ] as Array<[Tab, string]>).map(([value, label]) => <button
          key={value}
          role="tab"
          aria-selected={tab === value}
          className={tab === value ? "active" : ""}
          onClick={() => setTab(value)}
        >{label}</button>)}
      </div>
      {error ? <p className="error-text" role="alert">{error}</p> : null}
      {notice ? <p className="ok-text" role="status">{notice}</p> : null}
      {loading ? <p className="muted">Loading Access Management…</p> : null}

      {!loading && tab === "access" ? <>
        <div className="access-toolbar">
          <input className="f" aria-label="Search effective access" placeholder="Search name, sign-in name, or role" value={filter} onChange={(event) => setFilter(event.target.value)} />
          <select className="f" aria-label="Filter principal type" value={principalType} onChange={(event) => setPrincipalType(event.target.value)}>
            <option value="all">All principal types</option><option value="user">People</option><option value="group">Groups</option><option value="service_principal">Workloads</option>
          </select>
          <select className="f" aria-label="Filter role" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}><option value="all">All roles</option>{[...HUMAN_ROLES, "System.Ingestion" as const].map((role) => <option key={role} value={role}>{role}</option>)}</select>
          <select className="f" aria-label="Filter assignment source" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}><option value="all">All sources</option><option value="group">Group-derived</option><option value="direct">Direct</option></select>
          <select className="f" aria-label="Filter guest status" value={guestFilter} onChange={(event) => setGuestFilter(event.target.value)}><option value="all">Members and guests</option><option value="guest">Guests</option><option value="member">Members</option></select>
          <select className="f" aria-label="Filter expiry" value={expiryFilter} onChange={(event) => setExpiryFilter(event.target.value)}><option value="all">Any expiry</option><option value="expiring">Has expiry</option><option value="permanent">No expiry</option></select>
          <select className="f" aria-label="Filter reconciliation state" value={reconciliationFilter} onChange={(event) => setReconciliationFilter(event.target.value)}><option value="all">Any reconciliation state</option><option value="missing">Missing objects</option><option value="current">Current objects</option></select>
          <button className="btn-sm" disabled={busy} onClick={() => void exportInventory()}>Export safe inventory</button>
        </div>
        <div className="table-scroll"><table className="data">
          <thead><tr><th>Principal</th><th>Type</th><th>Effective roles and sources</th><th>Status</th><th>Expiry</th><th>Actions</th></tr></thead>
          <tbody>{visiblePrincipals.length === 0 ? <tr><td colSpan={6}>No access principals match the selected filters.</td></tr> : visiblePrincipals.map((principal) => <tr key={principal.id}>
            <td><b>{principal.display_name}</b><br /><span className="td-dim">{principal.sign_in_name || principal.id}</span></td>
            <td>{principal.principal_type === "service_principal" ? "Workload" : principal.principal_type === "group" ? "Group" : principal.guest_state ? "Guest" : "Member"}</td>
            <td>{principal.assignments.length ? principal.assignments.map((assignment) => <div key={`${assignment.role}-${assignment.source}-${assignment.source_id}`} className="access-source">
              <b>{assignment.role}</b> <span className="td-dim">{assignment.source === "group" ? `via ${assignment.source_name}` : assignment.is_exception ? "direct exception" : "direct assignment"}</span>{" "}
              <button className="btn-link" aria-label={`Revoke ${assignment.role} access`} onClick={() => { setRevokeDraft({ principal, assignment, reason: "", preview: null }); setError(null); }}>Revoke</button>
            </div>) : "No effective roles"}</td>
            <td>{principal.directory_status === "missing" ? "Missing directory object" : principal.account_enabled === false ? "Disabled in Entra" : principal.guest_state || "Enabled"}</td>
            <td>{principal.assignments.map((assignment) => assignment.expires_at ? displayTime(assignment.expires_at) : null).filter(Boolean).join(", ") || "No recorded expiry"}</td>
            <td>{principal.principal_type === "user" ? <button className="btn-sm" disabled={signInsLoading} onClick={() => void showSignIns(principal)}>View sign-ins</button> : "—"}</td>
          </tr>)}</tbody>
        </table></div>
        {revokeDraft ? <section className="access-preview" aria-label={`Revoke ${revokeDraft.assignment.role} from ${revokeDraft.principal.display_name}`}>
          <button className="btn-sm access-close" onClick={() => setRevokeDraft(null)}>Cancel</button>
          <h3>Preview access revocation</h3>
          <p><b>{revokeDraft.principal.display_name}</b> · {revokeDraft.assignment.role} · {revokeDraft.assignment.source === "group" ? `remove from ${revokeDraft.assignment.source_name}` : "remove direct assignment"}</p>
          <p className="muted">Other assignment sources remain effective. Revoking a group principal affects that group’s direct members.</p>
          <p className="muted">Authorization may continue until the caller’s current token is refreshed or revalidated. OnBoard does not perform tenant-wide session revocation.</p>
          <label>Revocation reason<textarea className="f" aria-label="Revocation reason" value={revokeDraft.reason} onChange={(event) => setRevokeDraft((draft) => draft ? { ...draft, reason: event.target.value, preview: null } : null)} /></label>
          <div className="access-toolbar"><button className="btn-sm" disabled={busy} onClick={() => void previewRevocation()}>Preview revocation</button>{revokeDraft.preview?.valid ? <button className="btn-primary" disabled={busy} onClick={() => void confirmRevocation()}>Confirm revocation</button> : null}</div>
          {revokeDraft.preview ? <p role="status">{revokeDraft.preview.items[0]?.disposition === "approval_required" ? "This privileged change requires a second Access Administrator." : revokeDraft.preview.valid ? "This change applies immediately after confirmation." : revokeDraft.preview.items[0]?.errors.join(" ")}</p> : null}
        </section> : null}
        {signIns ? <aside className="access-signins" aria-label={`Sign-in evidence for ${signIns.principal.display_name}`}>
          <button className="btn-sm access-close" onClick={() => setSignIns(null)}>Close</button>
          <h2>{signIns.principal.display_name}</h2>
          <h3>Directory-wide sign-in summary</h3>
          <p className="muted">These timestamps cover the person’s Entra account and are not necessarily OnBoard sign-ins.</p>
          <dl className="access-definition-list">
            <div><dt>Last successful sign-in</dt><dd>{displayTime(signIns.data.directory_summary?.last_successful_at ?? null)}</dd></div>
            <div><dt>Last interactive attempt</dt><dd>{displayTime(signIns.data.directory_summary?.last_interactive_attempt_at ?? null)}</dd></div>
            <div><dt>Last noninteractive sign-in</dt><dd>{displayTime(signIns.data.directory_summary?.last_noninteractive_at ?? null)}</dd></div>
          </dl>
          <h3>OnBoard-specific sign-in events</h3>
          <p className="muted">Queried on demand from Entra at {displayTime(signIns.data.onboard_events.queried_at)}. Detailed events are not copied into OnBoard.</p>
          {signIns.data.onboard_events.events.length ? <ul>{signIns.data.onboard_events.events.map((event) => <li key={`${event.occurred_at}-${event.correlation_id}`}>
            {displayTime(event.occurred_at)} · <span>{event.successful ? "Successful" : "Failed"} · {event.client_app || "Unknown client"}</span>
          </li>)}</ul> : <p>No OnBoard events are available within the tenant retention window.</p>}
        </aside> : null}
        <section className="access-expiry-card">
          <h3>Due access expiry</h3>
          <p>{expirations.length} assignment{expirations.length === 1 ? "" : "s"} due. Expiry removes OnBoard access only; it does not disable the Entra identity.</p>
          <button className="btn-sm" disabled={busy || expirations.length === 0} onClick={() => void applyExpirations()}>Apply due expiries</button>
        </section>
      </> : null}

      {!loading && tab === "onboarding" ? <section>
        <div className="access-mode">
          <label><input type="radio" checked={onboardingMode === "directory"} onChange={() => { setOnboardingMode("directory"); setPreview(null); }} /> Existing Entra users and groups</label>
          <label><input type="radio" checked={onboardingMode === "guest"} onChange={() => { setOnboardingMode("guest"); setPreview(null); }} /> Sponsored B2B guest</label>
        </div>
        {onboardingMode === "directory" ? <>
          <div className="access-toolbar"><input className="f" aria-label="Search Entra directory" value={directoryQuery} onChange={(event) => setDirectoryQuery(event.target.value)} /><button className="btn-sm" disabled={busy} onClick={() => void searchDirectory()}>Search Entra</button></div>
          {candidates.length ? <fieldset><legend>Directory results</legend>{candidates.map((candidate) => <label className="access-candidate" key={candidate.id}>
            <input type="checkbox" checked={selectedIds.includes(candidate.id)} onChange={(event) => { setSelectedIds((ids) => event.target.checked ? [...ids, candidate.id] : ids.filter((id) => id !== candidate.id)); setPreview(null); }} />
            <span><b>{candidate.display_name}</b> · {candidate.sign_in_name || candidate.principal_type} · {candidate.account_enabled === false ? "Disabled" : candidate.guest_state || "Enabled"}</span>
          </label>)}</fieldset> : null}
        </> : <div className="field-grid">
          <label>Guest email<input className="f" type="email" value={guestEmail} onChange={(event) => { setGuestEmail(event.target.value); setPreview(null); }} /></label>
          <label>MVTA sponsor<input className="f" value={sponsor} onChange={(event) => { setSponsor(event.target.value); setPreview(null); }} /></label>
          <label>Employer / organization<input className="f" value={organization} onChange={(event) => { setOrganization(event.target.value); setPreview(null); }} /></label>
        </div>}
        <fieldset><legend>OnBoard roles</legend><div className="access-role-grid">{roleChoices.map((role) => <label key={role}><input type="checkbox" checked={selectedRoles.includes(role)} onChange={(event) => { setSelectedRoles((roles) => event.target.checked ? [...roles, role] : roles.filter((item) => item !== role)); setPreview(null); }} /> {role}</label>)}</div></fieldset>
        {onboardingMode === "directory" ? <label className="access-inline">Assignment source <select className="f" value={source} onChange={(event) => { setSource(event.target.value as AccessAssignmentSource); setPreview(null); }}><option value="group">Configured role group (recommended)</option><option value="direct">Audited direct exception</option></select></label> : null}
        <div className="field-grid">
          <label>Business reason<textarea className="f" value={reason} onChange={(event) => { setReason(event.target.value); setPreview(null); }} /></label>
          <label>Expiry {onboardingMode === "guest" ? "(required)" : "(optional)"}<input className="f" type="datetime-local" value={expiresAt} onChange={(event) => { setExpiresAt(event.target.value); setPreview(null); }} /></label>
        </div>
        <button className="btn-sm" disabled={busy} onClick={() => void previewChanges()}>Preview Directory Onboarding</button>
        {preview ? <section className="access-preview" aria-label="Directory Onboarding preview">
          <h3>Dry-run result</h3>
          <ul>{preview.items.map((item) => <li key={item.index}>Item {item.index + 1}: {item.disposition}{item.errors.length ? ` — ${item.errors.join(" ")}` : ""}</li>)}</ul>
          <button className="btn-primary" disabled={busy || !preview.valid} onClick={() => void submitChanges()}>Confirm changes</button>
        </section> : null}
        {results ? <section aria-label="Directory Onboarding outcomes"><h3>Per-item outcomes</h3><ul>{results.results.map((result) => <li key={result.index}>Item {result.index + 1}: {result.disposition}{result.message ? ` — ${result.message}` : ""}</li>)}</ul></section> : null}
      </section> : null}

      {!loading && tab === "approvals" ? <section>
        <p className="panel-desc">`OCC.Admin` and `OCC.AccessAdmin` grants and revocations require a different, freshly authenticated Access Administrator.</p>
        {pending.length ? <div className="table-scroll"><table className="data"><thead><tr><th>Requested change</th><th>Requester</th><th>Reason</th><th>Actions</th></tr></thead><tbody>{pending.map((change) => <tr key={change.id}>
          <td>{change.change.action} {change.change.role} · {change.change.principal_id}<br /><span className="td-dim">{change.environment} · requested {displayTime(change.requested_at)} · expires {displayTime(change.approval_expires_at ?? null)}</span></td>
          <td>{change.requested_by_name}</td><td>{change.change.reason}</td>
          <td><button className="btn-sm" disabled={busy} onClick={() => void decide(change, "approved")}>Approve</button> <button className="btn-sm" disabled={busy} onClick={() => void decide(change, "rejected")}>Reject</button>{change.requested_by_name.toLowerCase() === account?.username.toLowerCase() ? <> <button className="btn-sm" disabled={busy} onClick={() => void cancelChange(change)}>Cancel request</button></> : null}</td>
        </tr>)}</tbody></table></div> : <p>No privileged changes await approval.</p>}
      </section> : null}

      {!loading && tab === "reconciliation" ? <section>
        <div className="access-toolbar">
          <p className="panel-desc">Compare the canonical role model and configured role groups with current Entra assignments. Repairs are always previewed and explicitly confirmed.</p>
          <button className="btn-sm" disabled={busy} onClick={() => { setReconciliation(null); setRepairPreview(null); }}>Refresh from Entra</button>
        </div>
        {!reconciliation ? <p className="muted">Reading current Entra access…</p> : reconciliation.findings.length === 0 ? <p>No access drift was found at {displayTime(reconciliation.observed_at)}.</p> : <>
          <ul className="access-findings">{reconciliation.findings.map((finding, index) => <li key={`${finding.code}-${finding.principal_id ?? "global"}-${finding.role ?? index}`}>
            {finding.repair_change ? <input aria-label={`Select repair: ${finding.message}`} type="checkbox" checked={selectedRepairs.includes(index)} onChange={(event) => { setSelectedRepairs((selected) => event.target.checked ? [...selected, index] : selected.filter((item) => item !== index)); setRepairPreview(null); }} /> : null}
            <b>{finding.severity.toUpperCase()}</b> · {finding.message}
          </li>)}</ul>
          <button className="btn-sm" disabled={busy} onClick={() => void previewRepairs()}>Preview selected repairs</button>
          {repairPreview ? <section className="access-preview" aria-label="Reconciliation repair preview"><h3>Repair dry run</h3><ul>{repairPreview.items.map((item) => <li key={item.index}>Item {item.index + 1}: {item.disposition}{item.errors.length ? ` — ${item.errors.join(" ")}` : ""}</li>)}</ul><button className="btn-primary" disabled={!repairPreview.valid || busy} onClick={() => void confirmRepairs()}>Confirm selected repairs</button></section> : null}
        </>}
      </section> : null}

      {!loading && tab === "audit" ? <section>
        <p className="panel-desc">Append-only administrative activity. Detailed sign-in event payloads are deliberately absent.</p>
        <div className="table-scroll"><table className="data"><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Outcome</th><th>Reason</th></tr></thead><tbody>{audit.map((entry, index) => <tr key={entry.id ?? `${entry.occurred_at}-${index}`}>
          <td>{displayTime(entry.occurred_at)}</td><td>{entry.actor_name}</td><td>{entry.action}</td><td>{entry.target_id || "—"}</td><td>{entry.outcome}</td><td>{entry.reason || "—"}</td>
        </tr>)}</tbody></table></div>
      </section> : null}
    </div>
  </section>;
}
