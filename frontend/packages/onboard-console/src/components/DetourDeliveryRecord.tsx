import { useEffect, useState } from "react";
import { ApiError, type DetourCommunication, type DetourCommunicationReceipt } from "@mvta/shared";
import { api } from "../config.js";
import { dateTimeLabel } from "../lib/detourDates.js";

// Read-only delivery record for a Detour: every communication with who
// published it, how it was delivered, and the frozen copy of what went
// out (migration 092). Detour Reports uses it as the compliance view; the
// entry page reuses SentCopy beside its composer. Nothing here writes.

export function deliveryLabel(c: DetourCommunication): string {
  const teams = c.channel.trim().toLowerCase() === "teams";
  switch (c.delivery_status) {
    case "queued": return "Sending…";
    // "sent" is provider acceptance; "delivered" is the provider's receipt
    // for every recipient (Teams has no receipts, so Posted is final).
    case "sent": return `${teams ? "Posted" : "Accepted by provider"}${c.delivery_completed_at ? ` ${dateTimeLabel(c.delivery_completed_at)}` : ""}`;
    case "delivered": return `Delivered${c.delivery_completed_at ? ` ${dateTimeLabel(c.delivery_completed_at)}` : ""}`;
    case "partially_sent": return "Partially delivered";
    case "failed": return "Delivery failed";
    case "skipped": return "Delivery not available";
    default: return c.status === "published" ? (c.outcome || "Recorded as sent") : c.status === "failed" ? "Failed" : "Draft";
  }
}

export function receiptLabel(status: DetourCommunicationReceipt["status"]): string {
  switch (status) {
    case "accepted": return "Accepted, awaiting receipt";
    case "delivered": return "Delivered";
    case "expanded": return "Delivered to list";
    case "bounced": return "Bounced";
    case "suppressed": return "Suppressed";
    case "quarantined": return "Quarantined";
    case "filtered_spam": return "Filtered as spam";
    default: return "Failed";
  }
}

export function deliveryClass(c: DetourCommunication): string {
  if (c.delivery_status === "sent" || c.delivery_status === "delivered") return "ok-text";
  if (c.delivery_status === "partially_sent" || c.delivery_status === "failed" || c.delivery_status === "skipped" || c.status === "failed") return "warn-note";
  return "td-dim";
}

// The exact subject, recipients, and body the server sent, collapsed by
// default. Only present when delivery was requested; a communication a
// human sent elsewhere has no server copy.
export function SentCopy({ communication: c }: { communication: DetourCommunication }) {
  if (!c.sent_body) return null;
  return (
    <details style={{ marginTop: 4 }}>
      <summary className="td-dim" style={{ cursor: "pointer" }}>Sent copy{c.delivery_requested_at ? ` · requested ${dateTimeLabel(c.delivery_requested_at)}` : ""}</summary>
      <div className="subcard" style={{ marginTop: 4 }}>
        {c.sent_subject ? <p><b>Subject:</b> {c.sent_subject}</p> : null}
        {c.sent_recipients ? <p className="td-dim"><b>To:</b> {c.sent_recipients}</p> : null}
        <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", margin: 0 }}>{c.sent_body}</pre>
        {c.receipts?.length ? (
          <table className="data" style={{ marginTop: 6 }}>
            <thead><tr><th>Recipient</th><th>Receipt</th><th>Reported</th></tr></thead>
            <tbody>{c.receipts.map((r) => <tr key={r.id}>
              <td>{r.recipient}</td>
              <td><span className={r.status === "delivered" || r.status === "expanded" ? "ok-text" : r.status === "accepted" ? "td-dim" : "warn-note"}>{receiptLabel(r.status)}</span>{r.details ? <span className="td-dim"> · {r.details}</span> : null}</td>
              <td className="td-dim">{r.reported_at ? dateTimeLabel(r.reported_at) : "—"}</td>
            </tr>)}</tbody>
          </table>
        ) : c.delivery_provider_id ? <p className="td-dim" style={{ marginTop: 6 }}>Provider reference: {c.delivery_provider_id}</p> : null}
      </div>
    </details>
  );
}

export function DetourDeliveryRecord({ detourId }: { detourId: string }) {
  const [communications, setCommunications] = useState<DetourCommunication[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getDetourCommunications(detourId)
      .then((r) => setCommunications(r.communications))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load communications."));
  }, [detourId]);

  return (
    <div style={{ marginTop: 12 }}>
      <p className="field-label">Communications</p>
      {error ? <p className="error-text">{error}</p> : null}
      {communications === null && !error ? <p className="muted">Loading communications…</p> : null}
      {communications && communications.length === 0 ? <p className="td-dim">No communications recorded.</p> : null}
      {communications && communications.length > 0 ? (
        <table className="data">
          <thead><tr><th>Audience</th><th>Channel</th><th>Recipients</th><th>Published</th><th>Delivery</th></tr></thead>
          <tbody>
            {communications.map((c) => (
              <tr key={c.id}>
                <td>{c.audience}</td>
                <td className="td-dim">{c.channel}</td>
                <td className="td-dim">{c.sent_recipients || c.recipients || "—"}</td>
                <td className="td-dim">{c.published_by ? `${c.published_by}${c.published_at ? ` · ${dateTimeLabel(c.published_at)}` : ""}` : c.status === "draft" ? "Draft" : "—"}</td>
                <td>
                  <span className={deliveryClass(c)}>{deliveryLabel(c)}</span>
                  {c.delivery_error ? <div className="td-dim">{c.delivery_error}</div> : null}
                  <SentCopy communication={c} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
