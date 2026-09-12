// POST /api/acs-sms-events - Event Grid webhook for inbound texts
// (Microsoft.Communication.SMSReceived). Function-key authenticated: the Event
// Grid subscription's endpoint URL carries ?code=<function key>.
//
// Increment 5 of plans/rider-opt-in-confirmation-loop-spec.md, and the last
// piece of the double opt-in loop: a rider who replies with their code
// confirms here, and a rider who texts STOP is recorded here.
//
// WHY THIS LIVES IN THE REST API and not beside acsEmailEvents in the dispatch
// app, which is where every other ACS webhook is. The rule is the same one
// dispatch's webhook follows - the app that owns the tables handles the event.
// That webhook writes detour-communication tables, which dispatch owns. This
// one writes Subscribers and SubscriberConfirmations, which are the REST API's
// and carry the whole double opt-in state machine, the attempt cap and the
// merge. Putting it in dispatch would mean a second copy of all of that.
//
// The cost is that the REST app's inbound is Front Door only, so the Event
// Grid subscription has to point at the Front Door URL rather than the
// Function App's own hostname. That is a deployment step, written down in the
// PR and in HANDOFF.
import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import type { Transaction } from "mssql";
import { getPool, sql } from "../lib/db";
import { classifyInboundSms, parseInboundSms, validationResponse, type InboundSms } from "../lib/inboundSms";
import { normalizeUsPhone } from "../lib/phone";
import { confirmSms, optOut, type ConfirmOutcome } from "../lib/subscriberConfirmation";

export interface InboundSmsGateway {
  withTransaction<T>(run: (tx: Transaction) => Promise<T>): Promise<T>;
}

const liveGateway: InboundSmsGateway = {
  async withTransaction(run) {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const result = await run(tx);
      await tx.commit();
      return result;
    } catch (err) {
      try {
        await tx.rollback();
      } catch {
        /* already rolled back / not begun */
      }
      throw err;
    }
  },
};

let gateway: InboundSmsGateway = liveGateway;
export function setInboundSmsGatewayForTests(replacement: InboundSmsGateway | null): void {
  gateway = replacement ?? liveGateway;
}

export interface InboundResult {
  intent: "code" | "stop" | "other";
  /** The confirmation outcome, when a code was presented. */
  outcome?: ConfirmOutcome;
  /** Subscriber rows a STOP changed. */
  changed?: number;
  /** The message could not be processed; it is acknowledged anyway. */
  failed?: boolean;
}

/**
 * Act on one inbound text.
 *
 * THE SENDER'S NUMBER IS PROVEN HERE, by the carrier, in a way it never is on
 * the HTTP endpoints. `POST /subscribers/confirm-sms` takes a phone number in
 * a request body from anyone, which is why it collapses every refusal into one
 * answer. Here the number is the channel the message arrived on, so the full
 * outcome is safe to know - and it is logged rather than replied to, because
 * OnBoard sends no automatic reply to an inbound text at all (ACS answers the
 * mandatory keywords itself, from the campaign brief).
 */
export async function handleInboundMessage(
  message: InboundSms,
  context: InvocationContext,
): Promise<InboundResult> {
  const intent = classifyInboundSms(message.message);
  // ACS reports E.164, and every subscriber row stores E.164 - but a number
  // that arrives in any other shape would silently match nothing, which is
  // indistinguishable from a number that never subscribed.
  const from = normalizeUsPhone(message.from);
  if (!from) {
    context.warn(`Inbound SMS from an unreadable number; ignored.`);
    return { intent: intent.kind };
  }

  try {
    if (intent.kind === "stop") {
      const result = await gateway.withTransaction((tx) => optOut(tx, "sms", from, "sms_stop"));
      // Zero is a normal answer, not a failure: ACS relays STOP from any
      // number, including numbers that never subscribed.
      context.log(`Inbound STOP: ${result.changed} subscriber row(s) stopped.`);
      return { intent: "stop", changed: result.changed };
    }

    if (intent.kind === "code") {
      const result = await gateway.withTransaction((tx) => confirmSms(tx, from, intent.code));
      context.log(`Inbound confirmation code: ${result.outcome}.`);
      return { intent: "code", outcome: result.outcome };
    }

    // Acknowledged and logged, never answered. A reply to an unrecognised text
    // would be an unsolicited message to somebody who may not be a subscriber
    // at all, and two systems answering the same text is how a loop starts.
    context.log(`Inbound SMS was neither a code nor a stop keyword; no reply sent.`);
    return { intent: "other" };
  } catch (err) {
    // Logged, and still acknowledged - see the handler below on why.
    context.error("Failed to process an inbound SMS:", err);
    return { intent: intent.kind, failed: true };
  }
}

/**
 * ALWAYS ANSWERS 200, including when a message could not be processed.
 *
 * A non-200 makes Event Grid redeliver, and a message that fails for its own
 * reasons fails again on redelivery - a STOP that throws would be retried
 * until Event Grid gives up, with every attempt doing the same work. Both
 * actions here are idempotent, so a redelivery would be harmless; what is not
 * harmless is a poison event consuming the subscription's retries while other
 * riders' messages queue behind it.
 *
 * The trade is that a failure is dropped rather than retried, and for STOP
 * that is a compliance record lost. Three things make it acceptable: ACS
 * maintains the opt-out database for toll-free numbers itself, so delivery is
 * already blocked regardless of what OnBoard recorded; the count of failures
 * is in the response and the error is logged, so it is visible rather than
 * silent; and the rider can text STOP again. It is still the weakest point in
 * this increment, and worth revisiting if failures ever appear in the logs.
 */
export async function acsSmsEvents(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  let events: unknown;
  try {
    events = await request.json();
  } catch {
    // Malformed JSON is not something a redelivery fixes either, but it is
    // also not Event Grid's doing, so it is reported honestly.
    return { status: 400, jsonBody: { error: "Body must be a JSON array of Event Grid events" } };
  }

  const batch = Array.isArray(events) ? events : [events];
  const validation = validationResponse(batch);
  if (validation) return { status: 200, jsonBody: validation };

  const messages = parseInboundSms(batch);
  const results: InboundResult[] = [];
  for (const message of messages) {
    results.push(await handleInboundMessage(message, context));
  }

  const failed = results.filter((r) => r.failed).length;
  if (failed > 0) {
    context.error(`${failed} of ${messages.length} inbound SMS messages could not be processed.`);
  }
  return {
    status: 200,
    jsonBody: {
      received: messages.length,
      confirmed: results.filter((r) => r.outcome === "confirmed").length,
      stopped: results.filter((r) => r.intent === "stop" && !r.failed).length,
      failed,
    },
  };
}

app.http("acsSmsEvents", {
  route: "acs-sms-events",
  methods: ["POST"],
  authLevel: "function",
  handler: acsSmsEvents,
});
