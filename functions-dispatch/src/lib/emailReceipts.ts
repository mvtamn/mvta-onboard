// ACS email delivery receipts, arriving as Event Grid events
// (Microsoft.Communication.EmailDeliveryReportReceived). Pure parsing and
// aggregation; the HTTP endpoint in functions/acsEmailEvents.ts does the
// I/O.

export type ReceiptStatus = "accepted" | "delivered" | "bounced" | "suppressed" | "quarantined" | "filtered_spam" | "failed" | "expanded";

export interface EmailReceipt {
  provider_message_id: string;
  recipient: string;
  status: ReceiptStatus;
  details: string | null;
  reported_at: string | null;
}

interface EventGridEvent {
  id?: string;
  eventType?: string;
  data?: Record<string, unknown>;
}

export const SUBSCRIPTION_VALIDATION_EVENT = "Microsoft.EventGrid.SubscriptionValidationEvent";
export const EMAIL_DELIVERY_REPORT_EVENT = "Microsoft.Communication.EmailDeliveryReportReceived";

// Event Grid's handshake: echo the validation code. Returns null when the
// batch is not a validation request.
export function validationResponse(events: EventGridEvent[]): { validationResponse: string } | null {
  const validation = events.find((e) => e.eventType === SUBSCRIPTION_VALIDATION_EVENT);
  const code = validation?.data?.validationCode;
  return typeof code === "string" ? { validationResponse: code } : null;
}

const STATUS_MAP: Record<string, ReceiptStatus> = {
  delivered: "delivered", bounced: "bounced", suppressed: "suppressed", quarantined: "quarantined",
  filteredspam: "filtered_spam", failed: "failed", expanded: "expanded",
};

export function parseEmailReceipts(events: EventGridEvent[]): EmailReceipt[] {
  const receipts: EmailReceipt[] = [];
  for (const event of events) {
    if (event.eventType !== EMAIL_DELIVERY_REPORT_EVENT || !event.data) continue;
    const d = event.data;
    const messageId = typeof d.messageId === "string" ? d.messageId : null;
    const recipient = typeof d.recipient === "string" ? d.recipient : null;
    const rawStatus = typeof d.status === "string" ? d.status.toLowerCase() : "";
    if (!messageId || !recipient) continue;
    const details = d.deliveryStatusDetails && typeof d.deliveryStatusDetails === "object" ? (d.deliveryStatusDetails as { statusMessage?: unknown }).statusMessage : null;
    receipts.push({
      provider_message_id: messageId,
      recipient,
      status: STATUS_MAP[rawStatus] ?? "failed",
      details: typeof details === "string" ? details.slice(0, 1000) : null,
      reported_at: typeof d.deliveryAttemptTimestamp === "string" ? d.deliveryAttemptTimestamp : null,
    });
  }
  return receipts;
}

export type AggregateDelivery = "sent" | "delivered" | "partially_sent" | "failed";

// The parent communication's delivery_status from its receipts. "sent"
// while any recipient is still only accepted; "delivered" once every one
// is confirmed; a mix of confirmed and failed is partial; all failed is
// failed. Expanded (a distribution list) counts as delivered.
export function aggregateDelivery(statuses: ReceiptStatus[]): { status: AggregateDelivery; failed: number } {
  const bad = statuses.filter((s) => s === "bounced" || s === "suppressed" || s === "quarantined" || s === "filtered_spam" || s === "failed").length;
  const good = statuses.filter((s) => s === "delivered" || s === "expanded").length;
  const pending = statuses.length - bad - good;
  if (statuses.length === 0) return { status: "sent", failed: 0 };
  if (bad === statuses.length) return { status: "failed", failed: bad };
  if (bad > 0) return { status: "partially_sent", failed: bad };
  if (pending > 0) return { status: "sent", failed: 0 };
  return { status: "delivered", failed: 0 };
}
