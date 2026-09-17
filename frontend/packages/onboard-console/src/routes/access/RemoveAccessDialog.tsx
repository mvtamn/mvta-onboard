import { useEffect, useRef, useState } from "react";
import type { OnBoardAccessAssignment, OnBoardAccessPrincipal, OnBoardDirectoryChange } from "@mvta/shared";
import { api } from "../../config.js";
import { roleLabel } from "../../auth/roles.js";
import { Avatar, Icon } from "./AccessUi.js";
import { errorMessage, idempotencyKey, useAccess, type PreviewResult } from "./accessData.js";

// How long the reason must sit still before the change is checked. The check
// is a server dry run; checking on every keystroke would spend one per letter.
const CHECK_DELAY_MS = 600;

// Removing access used to be a form that appeared under the table with a
// Preview button and then a Confirm button. It is a dialog now, and the
// preview runs by itself once a reason is written: the person sees what will
// be removed, what stays, and whether it needs a second approver before the
// one button that acts is enabled.
export function RemoveAccessDialog({ principal, assignment, onClose }: {
  principal: OnBoardAccessPrincipal;
  assignment: OnBoardAccessAssignment;
  onClose: () => void;
}) {
  const { busy, setBusy, setNotice, load } = useAccess();
  const [reason, setReason] = useState("");
  const [checked, setChecked] = useState<{ reason: string; preview: PreviewResult } | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const titleId = "am-remove-title";

  const change = (text: string): OnBoardDirectoryChange => ({
    action: "revoke",
    principal_id: principal.id,
    principal_type: principal.principal_type,
    role: assignment.role,
    source: assignment.source,
    source_id: assignment.source_id,
    reason: text,
  });

  useEffect(() => { field.current?.focus(); }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const trimmed = reason.trim();
  useEffect(() => {
    if (!trimmed) return;
    let stale = false;
    const timer = window.setTimeout(() => {
      setChecking(true);
      setCheckError(null);
      api.previewAccessChanges([change(trimmed)])
        .then((preview) => { if (!stale) setChecked({ reason: trimmed, preview }); })
        .catch((error) => { if (!stale) setCheckError(errorMessage(error, "The removal could not be checked.")); })
        .finally(() => { if (!stale) setChecking(false); });
    }, CHECK_DELAY_MS);
    return () => { stale = true; window.clearTimeout(timer); };
    // change() is rebuilt each render from props that do not change while open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed]);

  const current = checked?.reason === trimmed ? checked.preview : null;
  const item = current?.items[0];
  const needsApproval = item?.disposition === "approval_required";
  const role = roleLabel(assignment.role);
  const others = principal.assignments.filter((other) => other !== assignment);
  const isGroup = principal.principal_type === "group";
  const viaGroup = assignment.source === "group";

  async function confirm() {
    if (!current?.valid) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const response = await api.submitAccessChanges([change(trimmed)], idempotencyKey("revoke"));
      setNotice(response.results[0]?.disposition === "pending_approval"
        ? `Removing ${role} from ${principal.display_name} is waiting for a second Access Administrator.`
        : `${role} removed from ${principal.display_name}.`);
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
        <Avatar name={principal.display_name} kind={isGroup ? "group" : principal.principal_type === "service_principal" ? "workload" : "person"} size="lg" />
        <div className="am-grow">
          <span className="am-eyebrow">REMOVE ACCESS</span>
          <h2 id={titleId}>Remove {role} from {principal.display_name}?</h2>
          <p>{isGroup
            ? "This changes the group’s OnBoard access. Nobody is removed from the group."
            : viaGroup
              ? `${principal.display_name} has this access through ${assignment.source_name}, so removing it takes them out of that group.`
              : "This removes a direct assignment."}</p>
        </div>
        <button className="btn-icon" type="button" aria-label="Close dialog" onClick={onClose}>×</button>
      </div>
      <div className="am-dialog-body">
        <ul className="am-effect">
          <li><span className="minus"><Icon name="close" size={15} /></span><span>{isGroup
            ? <><b>{assignment.source_name}</b> loses {role} on OnBoard. It does not remove anyone from the Entra group.</>
            : viaGroup
              ? <><b>Removed from {assignment.source_name}</b> in Entra, which ends {role} access.</>
              : <><b>Direct {role} assignment removed.</b></>}</span></li>
          {others.map((other) => <li key={`${other.role}-${other.source}-${other.source_id}`}><span className="keep"><Icon name="check" size={15} /></span><span><b>{roleLabel(other.role)} stays.</b> {other.source === "group" ? `It comes from ${other.source_name}.` : "It is a direct assignment."}</span></li>)}
          {isGroup ? null : <li><span className="note"><Icon name="clock" size={15} /></span><span className="am-muted">Authorization may continue until the current sign-in token is refreshed. OnBoard does not end sessions across the tenant.</span></li>}
        </ul>
        <label className="am-field">Revocation reason
          <textarea ref={field} className="am-input" value={reason} onChange={(event) => setReason(event.target.value)} />
          <span className="am-hint">Required. Recorded in the activity log.</span>
        </label>
        <p className={`am-check${checkError || (current && !current.valid) ? " bad" : needsApproval ? " warn" : current ? " ok" : ""}`} role="status">
          {!trimmed ? null
            : checking || !current && !checkError ? "Checking this change…"
              : checkError ? checkError
                : !current!.valid ? item?.errors.join(" ") || "This change cannot be submitted."
                  : needsApproval ? <><Icon name="lock" size={14} />This privileged change needs a second Access Administrator.</>
                    : <><Icon name="check" size={14} />Checked: this applies as soon as you confirm.</>}
        </p>
        {submitError ? <p className="am-check bad" role="alert">{submitError}</p> : null}
      </div>
      <div className="am-dialog-foot">
        <span className="am-grow" />
        <button type="button" className="am-btn" onClick={onClose}>Cancel</button>
        <button type="submit" className="am-btn danger" disabled={busy || checking || !current?.valid}>{needsApproval ? "Request removal" : "Remove access"}</button>
      </div>
    </form>
  </div>;
}
