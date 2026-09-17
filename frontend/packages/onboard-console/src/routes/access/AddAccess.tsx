import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { AccessAssignmentSource, OnBoardAccessPrincipal, OnBoardAccessRole, OnBoardDirectoryChange } from "@mvta/shared";
import { api } from "../../config.js";
import { roleLabel } from "../../auth/roles.js";
import { Avatar, Icon, PageHead, Pill, type Tone } from "./AccessUi.js";
import { HUMAN_ROLES, changeLabel, errorMessage, idempotencyKey, isPrivileged, principalAccountStatus, resultLabel, useAccess, type PreviewResult, type SubmitResult } from "./accessData.js";

const PREVIEW_TONE: Record<string, [Tone, string]> = {
  immediate: ["ok", "Applies on submit"],
  approval_required: ["warn", "Needs a second approver"],
  already_satisfied: ["mute", "Already has it"],
  invalid: ["bad", "Can’t be submitted"],
};

// Add access is four numbered steps - who, which level, how, and why - with a
// running summary beside them. Nothing is sent until the summary has been
// checked by the server and then submitted; editing any step clears the check.
export function AddAccess() {
  const { busy, setBusy, setError, setNotice, load } = useAccess();
  const [mode, setMode] = useState<"directory" | "guest">("directory");
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<OnBoardAccessPrincipal[] | null>(null);
  const [selected, setSelected] = useState<OnBoardAccessPrincipal[]>([]);
  const [roles, setRoles] = useState<OnBoardAccessRole[]>([]);
  const [source, setSource] = useState<AccessAssignmentSource>("group");
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [sponsor, setSponsor] = useState("");
  const [organization, setOrganization] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [results, setResults] = useState<{ changes: OnBoardDirectoryChange[]; data: SubmitResult } | null>(null);

  // Any edit invalidates a check that was made against the old inputs.
  const edit = <T,>(setter: (value: T) => void) => (value: T) => { setter(value); setPreview(null); setResults(null); };

  const workloadsOnly = mode === "directory" && selected.length > 0 && selected.every((item) => item.principal_type === "service_principal");
  const groupsOnly = mode === "directory" && selected.length > 0 && selected.every((item) => item.principal_type === "group");
  const roleChoices: OnBoardAccessRole[] = workloadsOnly ? ["System.Ingestion"] : HUMAN_ROLES;
  const chosenRoles = roles.filter((role) => roleChoices.includes(role));

  function plannedChanges(): OnBoardDirectoryChange[] {
    if (mode === "guest") {
      return chosenRoles.map((role) => ({
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
    return selected.flatMap((candidate) => chosenRoles.map((role): OnBoardDirectoryChange => ({
      action: "grant",
      principal_id: candidate.id,
      principal_type: candidate.principal_type,
      role,
      source: candidate.principal_type === "group" ? "direct" : source,
      reason: reason.trim(),
      ...(expiresAt ? { expires_at: new Date(expiresAt).toISOString() } : {}),
    })));
  }

  const changes = plannedChanges();
  const nameOf = (change: OnBoardDirectoryChange) => mode === "guest" ? change.principal_id : selected.find((item) => item.id === change.principal_id)?.display_name ?? change.principal_id;

  async function search(event: FormEvent) {
    event.preventDefault();
    if (query.trim().length < 2) {
      setError("Enter at least two characters to search Entra ID.");
      return;
    }
    setBusy(true);
    try {
      setCandidates((await api.searchAccessDirectory(query.trim())).candidates);
      setError(null);
    } catch (searchError) {
      setError(errorMessage(searchError, "Directory search failed."));
    } finally {
      setBusy(false);
    }
  }

  function toggleCandidate(candidate: OnBoardAccessPrincipal, on: boolean) {
    edit(setSelected)(on ? [...selected, candidate] : selected.filter((item) => item.id !== candidate.id));
  }

  async function check() {
    if (changes.length === 0) {
      setError(mode === "guest" ? "Enter a guest and select at least one access level." : "Select at least one person, group or workload and an access level.");
      return;
    }
    setBusy(true);
    try {
      setPreview(await api.previewAccessChanges(changes));
      setResults(null);
      setError(null);
    } catch (previewError) {
      setError(errorMessage(previewError, "The access request could not be checked."));
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!preview?.valid) return;
    setBusy(true);
    try {
      const submitted = await api.submitAccessChanges(changes, idempotencyKey("onboard"));
      setResults({ changes, data: submitted });
      setNotice("Access request submitted. Each change’s outcome is listed in the summary.");
      setPreview(null);
      await load(true);
    } catch (submitError) {
      setError(errorMessage(submitError, "The access request could not be submitted."));
    } finally {
      setBusy(false);
    }
  }

  const whoDone = mode === "guest" ? !!guestEmail.trim() && !!sponsor.trim() : selected.length > 0;
  const expiryRequired = mode === "guest";

  return <>
    <PageHead
      title="Add access"
      description="Give existing Entra users, groups or workloads access, or invite a sponsored guest. Nothing changes until you submit, and every change is checked first."
      actions={<Link className="am-btn ghost" to="/admin/access/people">Cancel</Link>}
    />
    <div className="am-flow">
      <div className="am-steps">
        <section className="am-step" aria-labelledby="am-step-who">
          <div className="am-step-head"><span className={`am-step-n${whoDone ? " done" : ""}`}>{whoDone ? <Icon name="check" size={13} /> : "1"}</span><div><h3 id="am-step-who">Who needs access</h3><p>{mode === "guest" ? "A guest from another organization, sponsored by someone at MVTA." : selected.length ? `${selected.length} selected` : "Search Entra for people, groups or workloads."}</p></div></div>
          <div className="am-step-body">
            <div className="am-seg am-start" role="group" aria-label="Who needs access">
              <button type="button" aria-pressed={mode === "directory"} onClick={() => edit(setMode)("directory")}>Existing Entra users and groups</button>
              <button type="button" aria-pressed={mode === "guest"} onClick={() => edit(setMode)("guest")}>Sponsored B2B guest</button>
            </div>
            {mode === "directory" ? <>
              <form className="am-search-row" onSubmit={(event) => void search(event)}>
                <label className="am-search"><Icon name="search" size={15} /><input type="search" aria-label="Search Entra directory" placeholder="Name, email or group name" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
                <button type="submit" className="am-btn" disabled={busy}>Search Entra</button>
              </form>
              {candidates ? candidates.length ? <fieldset className="am-cands">
                <legend className="am-sr-only">Directory results</legend>
                {candidates.map((candidate) => {
                  const on = selected.some((item) => item.id === candidate.id);
                  const status = principalAccountStatus(candidate);
                  return <label key={candidate.id} className={`am-cand${on ? " is-on" : ""}`}>
                    <input type="checkbox" checked={on} onChange={(event) => toggleCandidate(candidate, event.target.checked)} />
                    <span className="am-who">
                      <Avatar name={candidate.display_name} kind={candidate.principal_type === "group" ? "group" : candidate.principal_type === "service_principal" ? "workload" : candidate.guest_state ? "guest" : "person"} />
                      <span><b>{candidate.display_name}</b><small>{candidate.sign_in_name || (candidate.principal_type === "group" ? "Security group" : candidate.principal_type === "service_principal" ? "Workload" : candidate.id)}</small></span>
                    </span>
                    <Pill tone={status.tone}>{status.label}</Pill>
                  </label>;
                })}
              </fieldset> : <p className="am-fine">No matches in Entra.</p> : null}
              {selected.length ? <div className="am-tokens"><span className="am-fine">Selected</span>{selected.map((item) => <span key={item.id} className="am-token">{item.display_name}<button type="button" aria-label={`Remove ${item.display_name}`} onClick={() => toggleCandidate(item, false)}><Icon name="close" size={11} /></button></span>)}</div> : null}
            </> : <div className="am-fields three">
              <label className="am-field">Guest email<input className="am-input" type="email" value={guestEmail} onChange={(event) => edit(setGuestEmail)(event.target.value)} /></label>
              <label className="am-field">MVTA sponsor<input className="am-input" value={sponsor} onChange={(event) => edit(setSponsor)(event.target.value)} /></label>
              <label className="am-field">Employer / organization<input className="am-input" value={organization} onChange={(event) => edit(setOrganization)(event.target.value)} /></label>
            </div>}
          </div>
        </section>

        <section className="am-step" role="group" aria-labelledby="am-step-level">
          <div className="am-step-head"><span className={`am-step-n${chosenRoles.length ? " done" : ""}`}>{chosenRoles.length ? <Icon name="check" size={13} /> : "2"}</span><div><h3 id="am-step-level">Access level</h3><p>{workloadsOnly ? "Workloads can only hold Automated System Ingestion." : "Choose the least access that does the job."}</p></div></div>
          <div className="am-step-body">
            <div className="am-roles">{roleChoices.map((role) => <label key={role} className="am-rolecard" title={role}>
              <input type="checkbox" checked={roles.includes(role)} onChange={(event) => edit(setRoles)(event.target.checked ? [...roles, role] : roles.filter((item) => item !== role))} />
              <span><b>{roleLabel(role)}{isPrivileged(role) ? <Pill tone="warn" icon="lock">Needs approval</Pill> : null}</b></span>
            </label>)}</div>
            {chosenRoles.includes("OCC.AccessAdmin") ? <p className="am-callout attn"><Icon name="warn" /><span>Access Administrator can manage everyone’s OnBoard access. Grant it only to designated access managers.</span></p> : null}
          </div>
        </section>

        {mode === "directory" && !groupsOnly && !workloadsOnly ? <section className="am-step" role="radiogroup" aria-labelledby="am-step-how">
          <div className="am-step-head"><span className="am-step-n done"><Icon name="check" size={13} /></span><div><h3 id="am-step-how">How to grant it</h3><p>Groups are the default; a direct assignment is recorded as an exception.</p></div></div>
          <div className="am-step-body">
            <div className="am-choice">
              <label className="am-radio"><input type="radio" name="am-source" checked={source === "group"} onChange={() => edit(setSource)("group")} /><span><b>Add to the security group</b><small>Recommended. They join the group configured for the access level.</small></span></label>
              <label className="am-radio"><input type="radio" name="am-source" checked={source === "direct"} onChange={() => edit(setSource)("direct")} /><span><b>Assign directly</b><small>An audited exception, flagged in Access health until removed.</small></span></label>
            </div>
          </div>
        </section> : null}

        <section className="am-step" aria-labelledby="am-step-why">
          <div className="am-step-head"><span className={`am-step-n${reason.trim() ? " done" : ""}`}>{reason.trim() ? <Icon name="check" size={13} /> : mode === "directory" && !groupsOnly && !workloadsOnly ? "4" : "3"}</span><div><h3 id="am-step-why">Reason and expiry</h3></div></div>
          <div className="am-step-body">
            <div className="am-fields">
              <label className="am-field">Business reason<textarea className="am-input" value={reason} onChange={(event) => edit(setReason)(event.target.value)} /><span className="am-hint">Recorded in the activity log.</span></label>
              <label className="am-field">Expiry {expiryRequired ? "(required)" : "(optional)"}<input className="am-input" type="datetime-local" value={expiresAt} onChange={(event) => edit(setExpiresAt)(event.target.value)} /><span className="am-hint">{expiryRequired ? "Guests always need an end date." : "Leave empty for access that doesn’t end."}</span></label>
            </div>
          </div>
        </section>
      </div>

      <aside className="am-summary" aria-label="Review changes">
        <div className="am-summary-head">
          <span className="am-eyebrow">REVIEW</span>
          <h3>{changes.length === 0 ? "No changes yet" : `${changes.length} ${changes.length === 1 ? "change" : "changes"}`}</h3>
          <small>{results ? "Submitted" : preview ? "Checked against Entra" : changes.length ? "Not checked yet" : "Pick who and which access level."}</small>
        </div>
        {changes.length || results ? <ul className="am-plan">
          {results
            ? results.data.results.map((result) => <li key={result.index}><b>{changeLabel(results.changes[result.index])} — {result.message || result.errors?.join(" ") || resultLabel(result.disposition)}</b><span className="am-fine">{nameOf(results.changes[result.index]!)}</span></li>)
            : changes.map((change, index) => {
              const item = preview?.items.find((entry) => entry.index === index);
              const [tone, label] = item ? PREVIEW_TONE[item.disposition] ?? ["mute", item.disposition] : [null, null];
              return <li key={`${change.principal_id}-${change.role}`}>
                <b>{changeLabel(change)} to {nameOf(change)}</b>
                {item && tone ? <Pill tone={tone}>{label}</Pill> : null}
                {item?.errors.length ? <span className="am-fine">{item.errors.join(" ")}</span> : null}
              </li>;
            })}
        </ul> : null}
        <div className="am-summary-foot">
          {preview?.valid
            ? <button type="button" className="am-btn primary" disabled={busy} onClick={() => void submit()}>Submit {changes.length === 1 ? "change" : `${changes.length} changes`}</button>
            : <button type="button" className="am-btn primary" disabled={busy || changes.length === 0} onClick={() => void check()}>Check changes</button>}
          {preview && !preview.valid ? <p className="am-fine" role="status">Fix the items marked above, then check again.</p> : null}
          {results ? <Link className="am-btn ghost sm" to="/admin/access/people">Back to People &amp; guests</Link> : <p className="am-fine am-center">Editing any step clears the check.</p>}
        </div>
      </aside>
    </div>
  </>;
}
