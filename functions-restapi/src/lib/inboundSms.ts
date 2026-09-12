// What a rider texted back, as Event Grid delivers it
// (Microsoft.Communication.SMSReceived). Pure parsing and classification; the
// webhook in functions/acsSmsEvents.ts does the I/O.
//
// Increment 5 of plans/rider-opt-in-confirmation-loop-spec.md.

export const SUBSCRIPTION_VALIDATION_EVENT = "Microsoft.EventGrid.SubscriptionValidationEvent";
export const SMS_RECEIVED_EVENT = "Microsoft.Communication.SMSReceived";

interface EventGridEvent {
  id?: string;
  eventType?: string;
  data?: Record<string, unknown>;
}

/**
 * Event Grid's handshake: echo the validation code. Null when the batch is not
 * a validation request.
 *
 * A second copy of the dispatch app's `validationResponse` - the two Function
 * Apps share no code, and this one has to live where the subscriber tables
 * are.
 */
export function validationResponse(events: EventGridEvent[]): { validationResponse: string } | null {
  const validation = events.find((e) => e.eventType === SUBSCRIPTION_VALIDATION_EVENT);
  const code = validation?.data?.validationCode;
  return typeof code === "string" ? { validationResponse: code } : null;
}

export interface InboundSms {
  /** The rider's number, as the carrier reported it. */
  from: string;
  /** The number they texted, which is ours. */
  to: string;
  message: string;
  receivedAt: string | null;
}

export function parseInboundSms(events: EventGridEvent[]): InboundSms[] {
  const messages: InboundSms[] = [];
  for (const event of events) {
    if (event.eventType !== SMS_RECEIVED_EVENT || !event.data) continue;
    const d = event.data;
    const from = typeof d.from === "string" ? d.from : null;
    const message = typeof d.message === "string" ? d.message : null;
    // A message with no sender cannot be acted on: every path here is scoped
    // to the number that sent it, and that scoping is what stops a texted code
    // confirming somebody else's subscription.
    if (!from || message === null) continue;
    messages.push({
      from,
      to: typeof d.to === "string" ? d.to : "",
      message,
      receivedAt: typeof d.receivedTimestamp === "string" ? d.receivedTimestamp : null,
    });
  }
  return messages;
}

export type InboundIntent =
  | { kind: "code"; code: string }
  | { kind: "stop" }
  | { kind: "other" };

/**
 * The keywords that stop messages. EXACT matches only, after trimming and
 * upper-casing.
 *
 * Matching more widely is how a rider asking a question gets silently
 * unsubscribed: "stop sending me the 444 alerts, just the 445 ones" contains
 * the word and means something else entirely. These are also the keywords the
 * carriers require and ACS itself acts on, so widening the list here would
 * make OnBoard disagree with the opt-out database that actually governs
 * delivery - and a subscriber stopped in one and not the other is the worst of
 * both.
 */
const STOP_KEYWORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);

/**
 * What the rider meant.
 *
 * HELP is deliberately absent: ACS answers the mandatory keywords itself, from
 * the responses registered in the toll-free campaign brief, and a second
 * answer from here would be a duplicate text.
 *
 * START / UNSTOP are absent for a different reason. The carriers treat them as
 * resuming delivery, but OnBoard cannot honour that on its own: resubscribing
 * means recording consent, and a one-word text is not the consent record the
 * opt-in form produces. They fall through to "other", which is logged.
 */
export function classifyInboundSms(message: string): InboundIntent {
  const normalized = message.trim().toUpperCase();
  if (STOP_KEYWORDS.has(normalized)) return { kind: "stop" };
  // The confirmation code as it was sent: six digits and nothing else. Pulling
  // six digits out of a longer message would spend one of the rider's five
  // attempts on something that may never have been a code - a bus number, a
  // time, a zip - and the attempt cap is what makes a six-digit secret worth
  // anything. A rider who writes "my code is 123456" gets no reply either way,
  // so the strict reading costs them nothing they would notice.
  if (/^\d{6}$/.test(normalized)) return { kind: "code", code: normalized };
  return { kind: "other" };
}
