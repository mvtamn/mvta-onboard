import { useEffect, useRef, useState } from "react";
import type { AccessHeldGrant, AccessPersonView } from "@mvta/shared";
import { api } from "../../config.js";
import { Avatar, Icon } from "./AccessUi.js";
import { errorMessage, personLabel, useAccess } from "./accessData.js";

// Removing access revokes one grant, by its id, with a reason that is kept.
// There is no server dry run any more: OnBoard owns the grant, so what the
// removal does is known here - this role ends, the others stay, and a
// privileged role goes to a second Access Administrator instead of applying.
export function RemoveAccessDialog({ person, grant, privileged, onClose }: {
  person: AccessPersonView;
  grant: AccessHeldGrant;
  privileged?: boolean;
  onClose: () => void;
}) {
  const { busy, setBusy, setNotice, load } = useAccess();
  const [reason, setReason] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const titleId = "am-remove-title";

  useEffect(() => { field.current?.focus(); }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const trimmed = reason.trim();
  const name = personLabel(person);
  const others = person.roles.filter((other) => other.grantId !== grant.grantId);

  async function confirm() {
    if (!trimmed) return;
    setBusy(true);
    setSubmitError(null);
    try {
      // A privileged removal needs the stepped-up token the server asks for
      // before it will open the request for a second Access Administrator.
      const outcome = await api.revokeAccessGrant(grant.grantId, trimmed, !!privileged);
      setNotice(outcome.disposition === "pending_approval"
        ? `Removing ${grant.roleName} from ${name} is waiting for a second Access Administrator.`
        : outcome.disposition === "already_held"
          ? `${name} no longer held ${grant.roleName}.`
          : `${grant.roleName} removed from ${name}.`);
      onClose();
      await load();
    } catch (error) {
      setSubmitError(errorMessage(error, "Access could not be removed."));
    } finally {
      setBusy(false);
    }
  }

  return <div className="modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <form className="modal-card am-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={(event) => { event.preventDefault(); void confirm(); }}>
      <div className="am-dialog-head">
        <Avatar name={name} kind={person.kind === "guest" ? "guest" : "person"} size="lg" />
        <div className="am-grow">
          <span className="am-eyebrow">REMOVE ACCESS</span>
          <h2 id={titleId}>Remove {grant.roleName} from {name}?</h2>
          <p>This ends one OnBoard role. It changes nothing in Entra: the account stays enabled and they can still sign in.</p>
        </div>
        <button className="btn-icon" type="button" aria-label="Close dialog" onClick={onClose}>×</button>
      </div>
      <div className="am-dialog-body">
        <ul className="am-effect">
          <li><span className="minus"><Icon name="close" size={15} /></span><span><b>{grant.roleName} ends</b>, and with it everything that role allowed.</span></li>
          {others.map((other) => <li key={other.grantId}><span className="keep"><Icon name="check" size={15} /></span><span><b>{other.roleName} stays.</b> What it allows is unchanged.</span></li>)}
          {others.length === 0 ? <li><span className="note"><Icon name="info" size={15} /></span><span className="am-muted">This is their last role, so they will see the No access page.</span></li> : null}
          <li><span className="note"><Icon name="clock" size={15} /></span><span className="am-muted">Effective access is resolved on the server for each request, so this takes effect on their next one.</span></li>
        </ul>
        <label className="am-field">Revocation reason
          <textarea ref={field} className="am-input" value={reason} onChange={(event) => setReason(event.target.value)} />
          <span className="am-hint">Required. Recorded in the activity log.</span>
        </label>
        <p className={`am-check${privileged ? " warn" : trimmed ? " ok" : ""}`} role="status">
          {privileged
            ? <><Icon name="lock" size={14} />This is a Privileged Access Change: a second Access Administrator decides it.</>
            : !trimmed ? "Say why this access is being removed."
              : <><Icon name="check" size={14} />This applies as soon as you confirm.</>}
        </p>
        {submitError ? <p className="am-check bad" role="alert">{submitError}</p> : null}
      </div>
      <div className="am-dialog-foot">
        <span className="am-grow" />
        <button type="button" className="am-btn" onClick={onClose}>Cancel</button>
        <button type="submit" className="am-btn danger" disabled={busy || !trimmed}>{privileged ? "Request removal" : "Remove access"}</button>
      </div>
    </form>
  </div>;
}
