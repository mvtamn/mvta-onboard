import type { AccessGrantRequestView } from "@mvta/shared";
import { api } from "../../config.js";
import { useAuth } from "../../auth/AuthContext.js";
import { useAccess as useMyAccess } from "../../auth/AccessContext.js";
import { useAppDialog } from "../../components/AppDialog.js";
import { Icon, Loading, PageHead, Pill, SetupNotice } from "./AccessUi.js";
import { displayTime, errorMessage, relativeTime, useAccess } from "./accessData.js";

const URGENT_MS = 4 * 3_600_000;

// Privileged Access Changes wait here for a second Access Administrator. One
// card per request, with what it does and why up front, and the reason a button
// is missing when it is: nobody decides their own request, approving needs a
// recent sign-in confirmation, and a request that outlived its window is
// expired rather than waiting.
export function AccessApprovals() {
  const { requests, notReady, loading, busy, setBusy, setError, setNotice, load } = useAccess();
  const { account } = useAuth();
  const { can } = useMyAccess();
  const canApprove = can("access-identity.approve"), canManage = can("access-identity.manage");
  const { prompt } = useAppDialog();

  const open = requests.filter((request) => request.status === "pending" || request.status === "expired");
  const ordered = [...open].sort((a, b) => a.approvalExpiresAt.localeCompare(b.approvalExpiresAt));
  const decided = requests.filter((request) => request.status !== "pending" && request.status !== "expired").slice(0, 8);

  async function decide(request: AccessGrantRequestView, decision: "approve" | "reject") {
    setBusy(true);
    try {
      await api.decideAccessGrantRequest(request.requestId, decision);
      setNotice(`${titleOf(request)} was ${decision === "approve" ? "approved" : "rejected"}.`);
      await load();
    } catch (decisionError) {
      setError(errorMessage(decisionError, "The privileged decision failed."));
    } finally {
      setBusy(false);
    }
  }

  async function cancel(request: AccessGrantRequestView) {
    const cancellationReason = await prompt({ title: "Cancel privileged access request", description: "Record why this request is no longer needed.", label: "Cancellation reason", confirmLabel: "Cancel request", multiline: true, required: true });
    if (!cancellationReason?.trim()) return;
    setBusy(true);
    try {
      await api.decideAccessGrantRequest(request.requestId, "cancel", cancellationReason.trim());
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
      description="Granting or removing a role that can manage access is a Privileged Access Change: a second Access Administrator decides it, and they have to have signed in recently. A request expires if nobody decides."
    />
    {notReady ? <SetupNotice message={notReady} /> : null}
    {loading && requests.length === 0 ? <Loading label="Loading approval requests…" />
      : ordered.length === 0 ? <div className="am-card"><p className="am-empty">No privileged changes are waiting for approval.</p></div>
        : ordered.map((request) => {
          const expired = request.status === "expired";
          const expiresIn = new Date(request.approvalExpiresAt).getTime() - Date.now();
          const urgent = !expired && expiresIn < URGENT_MS;
          const own = !!request.requestedByObjectId
            && (request.requestedByObjectId === account?.id
              || (!!account?.username && (request.requestedByName ?? "").toLowerCase() === account.username.toLowerCase()));
          const title = titleOf(request);
          return <article key={request.requestId} className={`am-req${urgent ? " urgent" : ""}`} aria-label={title}>
            <div className="am-req-main">
              <div className="am-req-title">
                {expired ? <Pill tone="mute" icon="clock">Expired</Pill>
                  : own ? <Pill tone="mute">You requested this</Pill>
                    : <Pill tone={urgent ? "warn" : "info"} icon="clock">Expires {relativeTime(request.approvalExpiresAt)}</Pill>}
                <h3><span title={request.roleKey}>{title}</span></h3>
              </div>
              <div className="am-req-meta">
                <span><Icon name="users" size={13} />Requested by {own ? "you" : request.requestedByName || "an unrecorded account"}</span>
                <span><Icon name="clock" size={13} />{displayTime(request.requestedAt)}{expired ? ` · window closed ${relativeTime(request.approvalExpiresAt)}` : own ? ` · expires ${relativeTime(request.approvalExpiresAt)}` : ""}</span>
                {request.expiresAt ? <span><Icon name="clock" size={13} />Access would expire {displayTime(request.expiresAt)}</span> : null}
              </div>
              <p className="am-quote"><b>Reason</b>{request.reason || "No reason recorded."}</p>
            </div>
            <div className="am-req-side">
              {expired
                ? <p>Nobody decided within the approval window. Ask for it again if it is still needed.</p>
                : own
                  ? <><p>Awaiting another Access Administrator</p><button type="button" className="am-btn" disabled={busy || !canManage} onClick={() => void cancel(request)}>Cancel request</button></>
                  : <><button type="button" className="am-btn primary" disabled={busy || !canApprove} onClick={() => void decide(request, "approve")}><Icon name="check" size={15} />Approve</button><button type="button" className="am-btn" disabled={busy || !canApprove} onClick={() => void decide(request, "reject")}>Reject</button></>}
            </div>
          </article>;
        })}

    {decided.length ? <section className="am-card" aria-labelledby="am-decided-title">
      <div className="am-card-head"><h3 id="am-decided-title">Recently decided</h3></div>
      <ul className="am-feed">{decided.map((request) => <li key={request.requestId}>
        <span className={`am-dot${request.status === "approved" ? "" : " bad"}`} />
        <span><b>{titleOf(request)}</b> · {request.status}{request.decidedByName ? ` by ${request.decidedByName}` : ""}</span>
        <small>{request.decidedAt ? displayTime(request.decidedAt) : ""}</small>
      </li>)}</ul>
    </section> : null}
  </>;
}

function titleOf(request: AccessGrantRequestView): string {
  const who = request.personName || request.personEmail || "somebody";
  return request.action === "revoke" ? `Remove ${request.roleName} from ${who}` : `Grant ${request.roleName} to ${who}`;
}
