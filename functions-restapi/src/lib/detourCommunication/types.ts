// Vocabulary of Detour communication eligibility (CONTEXT.md).
//
// "A derived determination that an authoritative Detour has reviewed
// operational facts, an accountable reviewer, and the fulfillment
// prerequisites needed for a specific audience's communication. It is not a
// lifecycle state and does not publish anything by itself."
//
// Until this module existed the determination was defined and never enforced:
// publish checked only that the row was a draft, so a closed Detour, or one
// with an Outstanding re-review, could be emailed to riders.
import type { DetourChannel } from "./channels";
import type { DetourConflictStatus } from "../detourConflicts";
import type { DetourFulfillmentMode, DetourLifecycleState } from "../detourWorkflow/types";

/** What a Detour's record says, as far as communicating about it is concerned. */
export interface CommunicationDetour {
  lifecycle_state: DetourLifecycleState | string;
  fulfillment_mode: DetourFulfillmentMode | string;
  re_review_outstanding: boolean;
  conflict_status: DetourConflictStatus;
  /** Audiences this Detour must reach, contractor included (detourContractor.ts). */
  required_audiences: string[];
}

export interface CommunicationRequest {
  audience: string;
  /** Null when the stored or submitted string names no known channel. */
  channel: DetourChannel | null;
  recipients: string[];
}

export type EligibilityRefusalCode =
  // The Detour is closed: there is nothing left to tell anyone about.
  | "detour_closed"
  // Reviewed operational facts changed and no one has re-reviewed them, so
  // what a rider would be told may already be wrong.
  | "re_review_outstanding"
  // The Detour is not fulfilled yet: no Avail entry confirmed and no manual
  // fallback recorded.
  | "fulfillment_pending"
  // The Avail entry failed and no manual fallback was recorded.
  | "fulfillment_failed"
  // A Likely duplicate is unresolved: two Detours may be describing the same
  // closure, and sending both would contradict itself.
  | "conflict_unresolved"
  // An email or text with nobody to send it to.
  | "no_recipients"
  // The stored or submitted channel is not one OnBoard knows.
  | "unknown_channel";

export interface EligibilityRefusal {
  code: EligibilityRefusalCode;
  /** A sentence a dispatcher can act on; handlers return it unchanged. */
  sentence: string;
}

export interface CommunicationEligibility {
  /** Wording may be prepared: everything except a closed Detour. */
  may_draft: boolean;
  may_send: boolean;
  /** Why not, when may_send is false. */
  refusal: EligibilityRefusal | null;
  /**
   * True when the audience is not one the record requires. Not a refusal -
   * telling someone extra about a Detour is allowed - but the console says so,
   * because an audience typed by hand never clears "needs communication".
   */
  audience_not_required: boolean;
}

/**
 * When a recorded channel actually carried the message. Nobody sends a road
 * sign, so the record needs the date the thing happened, not only the date it
 * was typed - otherwise a Detour closed weeks ago reads as communicated weeks
 * late.
 */
export interface RecordedDelivery {
  occurredAt: Date;
  note: string | null;
}

/** Where a communication has got to, derived from what the provider reported. */
export type CommunicationState = "draft" | "queued" | "sent" | "failed" | "recorded";

export type DeliveryStatus = "queued" | "sent" | "partially_sent" | "failed" | "skipped";

/** What a delivery adapter reports back. Nothing here writes to the database. */
export type DeliveryOutcome =
  | { status: "sent"; providerIds?: string[] }
  | { status: "queued" }
  | { status: "partially_sent"; providerIds: string[]; error: string }
  | { status: "failed"; error: string; transient?: boolean }
  // Not configured in this environment: a person has to send it themselves.
  | { status: "skipped"; error: string };

export interface DeliveryMessage {
  communicationId: string;
  detourId: string;
  subject: string;
  body: string;
  recipients: string[];
}

/**
 * One port, two adapters (Teams posts inline, email goes through Service Bus
 * to the dispatch app) and a fake for tests. The publish handler talks to this
 * and never to a transport.
 */
export interface DetourDeliveryPort {
  readonly channel: string;
  deliver(message: DeliveryMessage): Promise<DeliveryOutcome>;
}
