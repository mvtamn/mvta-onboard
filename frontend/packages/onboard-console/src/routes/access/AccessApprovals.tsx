import type { OnBoardAccessChangeRecord } from "@mvta/shared";
import { api } from "../../config.js";
import { roleLabel } from "../../auth/roles.js";
import { useAuth } from "../../auth/AuthContext.js";
import { useAccess as useMyAccess } from "../../auth/AccessContext.js";
import { useAppDialog } from "../../components/AppDialog.js";
import { Icon, Loading, PageHead, Pill } from "./AccessUi.js";
import { displayTime, errorMessage, idempotencyKey, relativeTime, useAccess } from "./accessData.js";

const URGENT_MS = 4 * 3_600_000;

// Privileged changes wait here for a second Access Administrator. One card
// per request, with what it does and why up front, and the reason a button is
// missing when it is: nobody approves their own request, and a request from
// before requesters were recorded can only be rejected.
export function AccessApprovals() {
  const { pending, loading, busy, setBusy, setError, setNotice, load, principalName } = useAccess();
  const { account } = useAuth();
  const { can } = useMyAccess();
  const canApprove = can("access-identity.approve"), canManage = can("access-identity.manage");
  const { prompt } = useAppDialog();

  const ordered = [...pending].sort((a, b) => (a.approval_expires_at ?? "9").localeCompare(b.approval_expires_at ?? "9"));

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

  async function cancel(change: OnBoardAccessChangeRecord) {
    const cancellationReason = await prompt({ title: "Cancel privileged access request", description: "Record why this request is no longer needed.", label: "Cancellation reason", confirmLabel: "Cancel request", multiline: true, required: true });
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

  return <>
    <PageHead
      title="Approvals"
      description={<><span title="OCC.Admin">Operations Administrator</span> and <span title="OCC.AccessAdmin">Access Administrator</span> changes need a second, recently signed-in Access Administrator. A request expires if nobody decides.</>}
    />
    {loading && pending.length === 0 ? <Loading label="Loading approval requests…" />
      : ordered.length === 0 ? <div className="am-card"><p className="am-empty">No privileged changes are waiting for approval.</p></div>
        : ordered.map((change) => {
          const expiresIn = change.approval_expires_at ? new Date(change.approval_expires_at).getTime() - Date.now() : null;
          const urgent = expiresIn !== null && expiresIn < URGENT_MS;
          const legacy = change.requested_by_id === "unknown";
          const own = !legacy && (change.requested_by_id === account?.id || (!!account?.username && change.requested_by_name.toLowerCase() === account.username.toLowerCase()));
          const verb = change.change.action === "grant" ? "Grant" : change.change.action === "revoke" ? "Remove" : "Invite";
          const preposition = change.change.action === "revoke" ? "from" : change.change.action === "grant" ? "to" : "as";
          const title = `${verb} ${roleLabel(change.change.role)} ${preposition} ${principalName(change.change.principal_id)}`;
          return <article key={change.id} className={`am-req${urgent ? " urgent" : ""}`} aria-label={title}>
            <div className="am-req-main">
              <div className="am-req-title">
                {legacy ? <Pill tone="bad" icon="warn">Can’t verify requester</Pill> : own ? <Pill tone="mute">You requested this</Pill> : change.approval_expires_at ? <Pill tone={urgent ? "warn" : "info"} icon="clock">Expires {relativeTime(change.approval_expires_at)}</Pill> : null}
                <h3><span title={change.change.role}>{title}</span></h3>
              </div>
              <div className="am-req-meta">
                <span><Icon name="users" size={13} />Requested by {legacy ? "an unrecorded account" : own ? "you" : change.requested_by_name}</span>
                <span><Icon name="clock" size={13} />{displayTime(change.requested_at)}{change.approval_expires_at && (own || legacy) ? ` · expires ${relativeTime(change.approval_expires_at)}` : ""}</span>
                <span><Icon name="layers" size={13} />{change.change.source === "group" ? "Group membership" : "Direct assignment"}</span>
                <span className="am-mono">{change.environment}</span>
              </div>
              <p className="am-quote"><b>Reason</b>{change.change.reason || "No reason recorded."}</p>
            </div>
            <div className="am-req-side">
              {legacy
                ? <><p>Unverifiable legacy request — reject and resubmit.</p><button type="button" className="am-btn" disabled={busy || !canApprove} onClick={() => void decide(change, "rejected")}>Reject</button></>
                : own
                  ? <><p>Awaiting another Access Administrator</p><button type="button" className="am-btn" disabled={busy || !canManage} onClick={() => void cancel(change)}>Cancel request</button></>
                  : <><button type="button" className="am-btn primary" disabled={busy || !canApprove} onClick={() => void decide(change, "approved")}><Icon name="check" size={15} />Approve</button><button type="button" className="am-btn" disabled={busy || !canApprove} onClick={() => void decide(change, "rejected")}>Reject</button></>}
            </div>
          </article>;
        })}
  </>;
}
