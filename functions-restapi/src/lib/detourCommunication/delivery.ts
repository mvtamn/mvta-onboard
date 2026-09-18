// The delivery port and its adapters.
//
// Teams posts to one webhook inline; email is handed to Service Bus and the
// dispatch app sends it. Both are transports, and the publish handler should
// not know which one it has - it asks the port and records what comes back.
// The fake makes the send paths testable without a webhook or a queue.
import type { InvocationContext } from "@azure/functions";
import { publishDetourCommunicationRequested } from "../events";
import { deliverDetourToTeams } from "../detourTeams";
import type { DeliveryMessage, DeliveryOutcome, DetourDeliveryPort } from "./types";

export const TEAMS_CHANNEL = "teams";
export const EMAIL_CHANNEL = "email";

export function teamsDeliveryPort(deliver = deliverDetourToTeams): DetourDeliveryPort {
  return {
    channel: TEAMS_CHANNEL,
    async deliver(message: DeliveryMessage): Promise<DeliveryOutcome> {
      const outcome = await deliver(message.subject, message.body);
      if (outcome.status === "sent") return { status: "sent" };
      // A webhook that is not configured is not a failure of this Detour:
      // someone posts it by hand and marks it published.
      return outcome.status === "skipped"
        ? { status: "skipped", error: outcome.error }
        : { status: "failed", error: outcome.error, transient: outcome.transient };
    },
  };
}

/**
 * Email is queued, not sent, here: the dispatch app reports the real outcome
 * later, and until then the communication is `queued`.
 */
export function emailDeliveryPort(context: InvocationContext, enqueue = publishDetourCommunicationRequested): DetourDeliveryPort {
  return {
    channel: EMAIL_CHANNEL,
    async deliver(message: DeliveryMessage): Promise<DeliveryOutcome> {
      const queued = await enqueue({
        communication_id: message.communicationId,
        detour_id: message.detourId,
        recipients: message.recipients,
        subject: message.subject,
        body: message.body,
      }, context);
      return queued
        ? { status: "queued" }
        : { status: "skipped", error: "Delivery service is not configured; send from your mail client and mark published" };
    },
  };
}

export function deliveryPortFor(channel: string, context: InvocationContext): DetourDeliveryPort | null {
  const wanted = channel.trim().toLowerCase();
  if (wanted === TEAMS_CHANNEL) return teamsDeliveryPort();
  if (wanted === EMAIL_CHANNEL) return emailDeliveryPort(context);
  return null;
}

/** A port that records what it was asked to send. For tests. */
export function fakeDeliveryPort(channel: string, outcome: DeliveryOutcome = { status: "sent" }): DetourDeliveryPort & { sent: DeliveryMessage[] } {
  const sent: DeliveryMessage[] = [];
  return {
    channel,
    sent,
    async deliver(message: DeliveryMessage): Promise<DeliveryOutcome> {
      sent.push(message);
      return outcome;
    },
  };
}
