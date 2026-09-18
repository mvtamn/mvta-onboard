import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { AccessRoleView, OnBoardAccessPrincipal, OnBoardAccessRole, OnBoardDirectoryChange } from "@mvta/shared";
import { api } from "../../config.js";
import { roleLabel } from "../../auth/roles.js";
import { useAccess as useMyAccess } from "../../auth/AccessContext.js";
import { Avatar, GrantChip, Icon, PageHead, Pill, SetupNotice, type Tone } from "./AccessUi.js";
import {
  HUMAN_ROLES, changeLabel, errorMessage, idempotencyKey, isPrivilegedRole, personLabel,
  principalAccountStatus, resultLabel, useAccess, type PreviewResult, type SubmitResult,
} from "./accessData.js";

const PREVIEW_TONE: Record<string, [Tone, string]> = {
  immediate: ["ok", "Applies on submit"],
  approval_required: ["warn", "Needs a second approver"],
  already_satisfied: ["mute", "Already has it"],
  invalid: ["bad", "Can’t be submitted"],
};

// Two different acts share this page, and the difference is the point.
//
// Granting a role is OnBoard's own: Entra is asked only to find the person, and
// the grant is then written against the person OnBoard knows - which means the
// person has signed in at least once, because that is how OnBoard learns them.
//
// Inviting a guest is still Entra's: an invitation and the app-role assignment
// that lets them reach OnBoard at all. Their OnBoard role is granted here, in
// the other half of this page, once they have signed in.
export function AddAccess() {
  const { people, roles, notReady, busy, setBusy, setError, setNotice, load } = useAccess();
  const { can } = useMyAccess();
  const canManage = can("access-identity.manage");
  const [mode, setMode] = useState<"person" | "guest">("person");

  // Finding somebody in the directory - one of Entra's three remaining jobs.
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<OnBoardAccessPrincipal[] | null>(null);
  const [picked, setPicked] = useState<OnBoardAccessPrincipal | null>(null);
  const [roleKey, setRoleKey] = useState("");
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [granted, setGranted] = useState<string | null>(null);

  // The guest invitation, on the Entra flow it has always used.
  const [guestEmail, setGuestEmail] = useState("");
  const [sponsor, setSponsor] = useState("");
  const [organization, setOrganization] = useState("");
  const [guestRole, setGuestRole] = useState<OnBoardAccessRole>("OCC.Viewer");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [results, setResults] = useState<{ changes: OnBoardDirectoryChange[]; data: SubmitResult } | null>(null);

  // Any edit invalidates a check, or a result, made against the old inputs.
  const edit = <T,>(setter: (value: T) => void) => (value: T) => { setter(value); setPreview(null); setResults(null); setGranted(null); };

  const choosable = roles.filter((role) => !role.archived);
  const chosen = choosable.find((role) => role.key === roleKey) ?? null;
  // OnBoard knows a person by their Entra object id, learned at sign-in.
  const known = picked ? people.find((person) => person.objectId === picked.id) ?? null : null;
  const holdsChosen = !!chosen && !!known && known.roles.some((grant) => grant.roleKey === chosen.key);

  const guestChanges: OnBoardDirectoryChange[] = guestEmail.trim() ? [{
    action: "invite_guest",
    principal_id: guestEmail.trim(),
    principal_type: "user",
    role: guestRole,
    source: "group",
    reason: reason.trim(),
    sponsor: sponsor.trim(),
    organization: organization.trim(),
    ...(expiresAt ? { expires_at: new Date(expiresAt).toISOString() } : {}),
  }] : [];

  async function search(event: FormEvent) {
    event.preventDefault();
    if (query.trim().length < 2) {
      setError("Enter at least two characters to search Entra ID.");
      return;
    }
    setBusy(true);
    try {
      // A grant names a person, so groups and workloads are not offered.
      setCandidates((await api.searchAccessDirectory(query.trim())).candidates.filter((candidate) => candidate.principal_type === "user"));
      setError(null);
    } catch (searchError) {
      setError(errorMessage(searchError, "Directory search failed."));
    } finally {
      setBusy(false);
    }
  }

  async function grant() {
    if (!known || !chosen || !reason.trim()) return;
    setBusy(true);
    try {
      // A privileged role needs the stepped-up token the server asks for before
      // it will open the request for a second Access Administrator.
      const outcome = await api.grantAccessRole(
        known.personId,
        {
          role_key: chosen.key,
          reason: reason.trim(),
          expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        },
        isPrivilegedRole(chosen),
      );
      const name = personLabel(known);
      const message = outcome.disposition === "pending_approval"
        ? `${chosen.name} for ${name} is waiting for a second Access Administrator to approve it.`
        : outcome.disposition === "already_held"
          ? `${name} already holds ${chosen.name}. Nothing changed.`
          : `${name} now holds ${chosen.name}.`;
      setGranted(message);
      setNotice(message);
      setError(null);
      await load();
    } catch (grantError) {
      setError(errorMessage(grantError, "The role could not be granted."));
    } finally {
      setBusy(false);
    }
  }

  async function check() {
    if (guestChanges.length === 0) {
      setError("Enter the guest’s email address.");
      return;
    }
    setBusy(true);
    try {
      setPreview(await api.previewAccessChanges(guestChanges));
      setResults(null);
      setError(null);
    } catch (previewError) {
      setError(errorMessage(previewError, "The invitation could not be checked."));
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!preview?.valid) return;
    setBusy(true);
    try {
      const submitted = await api.submitAccessChanges(guestChanges, idempotencyKey("onboard"));
      setResults({ changes: guestChanges, data: submitted });
      setNotice("Guest invited. They appear in People & guests after their first sign-in, and their OnBoard role is granted there.");
      setPreview(null);
      await load();
    } catch (submitError) {
      setError(errorMessage(submitError, "The invitation could not be sent."));
    } finally {
      setBusy(false);
    }
  }

  const whoDone = mode === "guest" ? !!guestEmail.trim() && !!sponsor.trim() : !!known;

  return <>
    <PageHead
      title="Add access"
      description="Give somebody a role in OnBoard, or invite a sponsored guest into the tenant so they can sign in. A role is granted against the person OnBoard knows; Entra is only asked who they are."
      actions={<Link className="am-btn ghost" to="/admin/access/people">Cancel</Link>}
    />
    {notReady ? <SetupNotice message={notReady} /> : null}
    <div className="am-flow">
      <div className="am-steps">
        <section className="am-step" aria-labelledby="am-step-who">
          <div className="am-step-head"><span className={`am-step-n${whoDone ? " done" : ""}`}>{whoDone ? <Icon name="check" size={13} /> : "1"}</span><div><h3 id="am-step-who">Who needs access</h3><p>{mode === "guest" ? "A guest from another organization, sponsored by someone at MVTA." : picked ? personLabel({ name: picked.display_name, email: picked.sign_in_name, objectId: picked.id }) : "Search the directory for the person."}</p></div></div>
          <div className="am-step-body">
            <div className="am-seg am-start" role="group" aria-label="Who needs access">
              <button type="button" aria-pressed={mode === "person"} onClick={() => edit(setMode)("person")}>Somebody in the directory</button>
              <button type="button" aria-pressed={mode === "guest"} onClick={() => edit(setMode)("guest")}>Sponsored B2B guest</button>
            </div>
            {mode === "person" ? <>
              <form className="am-search-row" onSubmit={(event) => void search(event)}>
                <label className="am-search"><Icon name="search" size={15} /><input type="search" aria-label="Search Entra directory" placeholder="Name or email" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
                <button type="submit" className="am-btn" disabled={busy}>Search Entra</button>
              </form>
              {candidates ? candidates.length ? <fieldset className="am-cands">
                <legend className="am-sr-only">Directory results</legend>
                {candidates.map((candidate) => {
                  const on = picked?.id === candidate.id;
                  const status = principalAccountStatus(candidate);
                  const seen = people.some((person) => person.objectId === candidate.id);
                  return <label key={candidate.id} className={`am-cand${on ? " is-on" : ""}`}>
                    <input type="radio" name="am-person" checked={on} onChange={() => edit(setPicked)(candidate)} />
                    <span className="am-who">
                      <Avatar name={candidate.display_name} kind={candidate.guest_state ? "guest" : "person"} />
                      <span><b>{candidate.display_name}</b><small>{candidate.sign_in_name || candidate.id}</small></span>
                    </span>
                    <Pill tone={seen ? "ok" : "mute"}>{seen ? "Known to OnBoard" : "Not signed in yet"}</Pill>
                    <Pill tone={status.tone}>{status.label}</Pill>
                  </label>;
                })}
              </fieldset> : <p className="am-fine">No matches in Entra.</p> : null}
              {picked && !known ? <p className="am-callout attn"><Icon name="info" /><span>
                <b>OnBoard has not seen {picked.display_name} yet.</b> A person becomes grantable the first time they sign in to OnBoard, because that is when OnBoard learns who they are. Ask them to sign in once, then grant the role here. If they already had access before roles moved into OnBoard, use <Link className="am-link" to="/admin/access">Import from Entra</Link> on the Overview.
              </span></p> : null}
              {known && known.roles.length ? <p className="am-fine">Holds now: {known.roles.map((held) => held.roleName).join(", ")}.</p> : null}
            </> : <div className="am-fields three">
              <label className="am-field">Guest email<input className="am-input" type="email" value={guestEmail} onChange={(event) => edit(setGuestEmail)(event.target.value)} /></label>
              <label className="am-field">MVTA sponsor<input className="am-input" value={sponsor} onChange={(event) => edit(setSponsor)(event.target.value)} /></label>
              <label className="am-field">Employer / organization<input className="am-input" value={organization} onChange={(event) => edit(setOrganization)(event.target.value)} /></label>
            </div>}
          </div>
        </section>

        <section className="am-step" aria-labelledby="am-step-level">
          <div className="am-step-head"><span className={`am-step-n${mode === "guest" ? " done" : roleKey ? " done" : ""}`}>{mode === "guest" || roleKey ? <Icon name="check" size={13} /> : "2"}</span><div>
            <h3 id="am-step-level">{mode === "guest" ? "Sign-in access in Entra" : "Role"}</h3>
            <p>{mode === "guest" ? "The invitation attaches one Entra app role, which is what lets the guest reach OnBoard. It grants nothing inside OnBoard." : "What the role allows is written beside it. Choose the least that does the job."}</p>
          </div></div>
          <div className="am-step-body">
            {mode === "guest"
              ? <select className="am-select" aria-label="Sign-in access level" value={guestRole} onChange={(event) => edit(setGuestRole)(event.target.value as OnBoardAccessRole)}>
                {HUMAN_ROLES.map((item) => <option key={item} value={item}>{roleLabel(item)}</option>)}
              </select>
              : choosable.length === 0
                ? <p className="am-fine">{notReady ? "Roles are not set up in this environment yet." : "No roles are defined yet. Define one on the Roles page first."}</p>
                : <div className="am-roles">{choosable.map((role) => <RoleCard key={role.key} role={role} chosen={roleKey === role.key} onChoose={() => edit(setRoleKey)(role.key)} />)}</div>}
            {chosen && isPrivilegedRole(chosen) ? <p className="am-callout attn"><Icon name="warn" /><span>{chosen.name} can manage everyone’s OnBoard access. Granting it is a Privileged Access Change: a second Access Administrator has to approve it before it takes effect.</span></p> : null}
          </div>
        </section>

        <section className="am-step" aria-labelledby="am-step-why">
          <div className="am-step-head"><span className={`am-step-n${reason.trim() ? " done" : ""}`}>{reason.trim() ? <Icon name="check" size={13} /> : "3"}</span><div><h3 id="am-step-why">Reason and expiry</h3></div></div>
          <div className="am-step-body">
            <div className="am-fields">
              <label className="am-field">Business reason<textarea className="am-input" value={reason} onChange={(event) => edit(setReason)(event.target.value)} /><span className="am-hint">Required. Recorded in the activity log.</span></label>
              <label className="am-field">Expiry {mode === "guest" ? "(required)" : "(optional)"}<input className="am-input" type="datetime-local" value={expiresAt} onChange={(event) => edit(setExpiresAt)(event.target.value)} /><span className="am-hint">{mode === "guest" ? "Guests always need an end date." : "Leave empty for access that doesn’t end."}</span></label>
            </div>
          </div>
        </section>
      </div>

      <aside className="am-summary" aria-label="Review changes">
        <div className="am-summary-head">
          <span className="am-eyebrow">REVIEW</span>
          <h3>{mode === "guest" ? (guestChanges.length ? "Invite a guest" : "No invitation yet") : chosen && known ? `Grant ${chosen.name}` : "No grant yet"}</h3>
          <small>{mode === "guest"
            ? results ? "Sent" : preview ? "Checked against Entra" : guestChanges.length ? "Not checked yet" : "Enter the guest’s details."
            : granted ? "Recorded" : known && chosen ? "Applies when you grant it" : "Pick the person and a role."}</small>
        </div>

        {mode === "guest"
          ? <>
            {guestChanges.length || results ? <ul className="am-plan">
              {results
                ? results.data.results.map((result) => <li key={result.index}><b>{changeLabel(results.changes[result.index])} — {result.message || result.errors?.join(" ") || resultLabel(result.disposition)}</b><span className="am-fine">{results.changes[result.index]!.principal_id}</span></li>)
                : guestChanges.map((change, index) => {
                  const item = preview?.items.find((entry) => entry.index === index);
                  const [tone, label] = item ? PREVIEW_TONE[item.disposition] ?? ["mute", item.disposition] : [null, null];
                  return <li key={change.principal_id}>
                    <b>Invite {change.principal_id} with {roleLabel(change.role)} sign-in access</b>
                    {item && tone ? <Pill tone={tone}>{label}</Pill> : null}
                    {item?.errors.length ? <span className="am-fine">{item.errors.join(" ")}</span> : null}
                  </li>;
                })}
            </ul> : null}
            <div className="am-summary-foot">
              {preview?.valid
                ? <button type="button" className="am-btn primary" disabled={busy || !canManage} onClick={() => void submit()}>Invite guest</button>
                : <button type="button" className="am-btn primary" disabled={busy || guestChanges.length === 0} onClick={() => void check()}>Check invitation</button>}
              {preview && !preview.valid ? <p className="am-fine" role="status">Fix the items marked above, then check again.</p> : null}
              {results
                ? <Link className="am-btn ghost sm" to="/admin/access/people">Back to People &amp; guests</Link>
                : <p className="am-fine">The invitation lets them sign in. Grant their OnBoard role here once they have.</p>}
            </div>
          </>
          : <>
            <ul className="am-plan">
              <li><b>{known ? personLabel(known) : picked ? picked.display_name : "Nobody selected"}</b><span className="am-fine">{known ? "Known to OnBoard" : picked ? "Has not signed in to OnBoard yet" : "Search the directory above."}</span></li>
              <li>
                <b>{chosen ? chosen.name : "No role chosen"}</b>
                {chosen && isPrivilegedRole(chosen) ? <Pill tone="warn">Needs a second approver</Pill> : null}
                {holdsChosen ? <span className="am-fine">They already hold this role.</span> : null}
              </li>
            </ul>
            <div className="am-summary-foot">
              <button type="button" className="am-btn primary" disabled={busy || !canManage || !known || !chosen || !reason.trim()} onClick={() => void grant()}>
                {chosen && isPrivilegedRole(chosen) ? "Request this role" : "Grant role"}
              </button>
              {granted
                ? <Link className="am-btn ghost sm" to="/admin/access/people">Back to People &amp; guests</Link>
                : <p className="am-fine am-center">{canManage ? "A grant takes effect on their next request." : "You may look, but not grant."}</p>}
            </div>
          </>}
      </aside>
    </div>
  </>;
}

// A role is chosen by what it allows, so the generated Access Summary is on the
// card rather than behind it.
function RoleCard({ role, chosen, onChoose }: { role: AccessRoleView; chosen: boolean; onChoose: () => void }) {
  return <label className="am-rolecard" title={role.key}>
    <input type="radio" name="am-role" checked={chosen} onChange={onChoose} />
    <span>
      <b><GrantChip name={role.name} privileged={isPrivilegedRole(role)} />{isPrivilegedRole(role) ? <Pill tone="warn" icon="lock">Needs approval</Pill> : null}</b>
      {role.purpose ? <small>{role.purpose}</small> : null}
      {role.summary.length
        ? <ul className="am-lines">{role.summary.map((line) => <li key={line}>{line}</li>)}</ul>
        : <small>Allows nothing yet.</small>}
    </span>
  </label>;
}
