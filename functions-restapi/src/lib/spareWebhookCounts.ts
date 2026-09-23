// What the Spare webhook receiver is being sent, and what it did with each
// delivery.
//
// The receiver answers roughly 5,000 deliveries an hour through a service day
// and logs nothing per delivery - deliberately, because a per-delivery log is
// the flood again. That left no way to answer the question the subscription
// raises: which of the four event types are worth receiving. The header of
// spareWebhookIntake.ts records "nine in ten of them vehicle locations" from
// the 2026-09-05 incident, but nothing has measured it since, and the cost of
// an ETA delivery (an outbound read of the request from Spare) is not visible
// at all.
//
// So: counts only, by type and outcome, logged once a window. No ids, no
// payload values, nothing that could identify a rider or a trip.
import type { SpareWebhookEventType } from "./spareWebhookPolicy";
import type { SpareEtaUpdate } from "./onDemandSpareMonitor";

export type WebhookDeliveryOutcome =
  | "stored"
  | "coalesced"
  | "unusable"
  | "not_admitted"
  | "read"
  | "skipped_not_monitored"
  | "shed"
  | "failed";

export interface WebhookEventCounts {
  window_seconds: number;
  total: number;
  by_type: Partial<Record<SpareWebhookEventType, Partial<Record<WebhookDeliveryOutcome, number>>>>;
}

export class WebhookEventCounter {
  private counts = new Map<string, Map<string, number>>();
  private total = 0;
  private windowStart: number | null = null;
  private readonly now: () => number;

  constructor(private readonly windowMs: number, now?: () => number) {
    this.now = now ?? Date.now;
  }

  record(type: SpareWebhookEventType, outcome: WebhookDeliveryOutcome): void {
    if (this.windowStart === null) this.windowStart = this.now();
    const byOutcome = this.counts.get(type) ?? new Map<string, number>();
    byOutcome.set(outcome, (byOutcome.get(outcome) ?? 0) + 1);
    this.counts.set(type, byOutcome);
    this.total++;
  }

  // The counts for the window just ended, or null when the window is still
  // open or nothing arrived in it. An empty window says nothing rather than
  // reporting zeroes: silence already means no deliveries.
  due(): WebhookEventCounts | null {
    if (this.windowStart === null) return null;
    const elapsed = this.now() - this.windowStart;
    if (elapsed < this.windowMs) return null;
    const by_type = Object.fromEntries(
      [...this.counts].map(([type, byOutcome]) => [type, Object.fromEntries(byOutcome)]),
    ) as WebhookEventCounts["by_type"];
    const counts = { window_seconds: Math.round(elapsed / 1000), total: this.total, by_type };
    this.counts = new Map();
    this.total = 0;
    this.windowStart = null;
    return counts;
  }
}

// Which ETA updates are worth an outbound read of the request from Spare.
//
// An ETA payload carries no service attribution and no ordering timestamp, so
// it can only be applied through the authoritative record - one Spare API call
// per update. A request the monitor is not tracking has no wait to update:
// per ADR 0023 the hourly reconciliation is what establishes monitored state,
// and a requestStatus delivery brings a new request in sooner than its ETAs
// would. So an ETA for an unknown request is counted and dropped rather than
// paying for a read that would, at best, re-derive what the next reconciliation
// will find anyway.
export function etaUpdatesToRead(
  updates: readonly SpareEtaUpdate[],
  monitoredRequestIds: ReadonlySet<string>,
): { read: SpareEtaUpdate[]; skipped: number } {
  const read = updates.filter((update) => monitoredRequestIds.has(update.requestId));
  return { read, skipped: updates.length - read.length };
}
