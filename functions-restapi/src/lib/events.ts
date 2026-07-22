// Publishes domain events to Service Bus so the dispatch Function App can pick
// them up and fan out SMS/email. Identity-based auth only (the namespace has
// local/SAS auth disabled - see infra-phase1/modules/servicebus.bicep); the
// Function App's system-assigned managed identity holds the Sender role.
//
// Best-effort by design: a publish failure is logged but does NOT fail the
// originating request (e.g. creating a message still succeeds even if the
// event can't be enqueued). The active-messages read path is the source of
// truth for riders; dispatch is a downstream side effect.
import { ServiceBusClient } from "@azure/service-bus";
import { DefaultAzureCredential } from "@azure/identity";
import type { InvocationContext } from "@azure/functions";
import type { MessageCreatedEvent, ConfirmationRequestedEvent } from "./types";

let client: ServiceBusClient | null = null;

function getClient(): ServiceBusClient | null {
  if (client) return client;
  const namespace = process.env.SERVICE_BUS_NAMESPACE; // e.g. sb-mvta-onboard-dev.servicebus.windows.net
  if (!namespace) return null;
  client = new ServiceBusClient(namespace, new DefaultAzureCredential());
  return client;
}

async function publish(
  queueName: string,
  subject: string,
  body: unknown,
  messageId: string,
  context?: InvocationContext,
): Promise<boolean> {
  const sbClient = getClient();
  if (!sbClient) {
    context?.warn(`SERVICE_BUS_NAMESPACE not set - skipping "${subject}" publish.`);
    return false;
  }
  const sender = sbClient.createSender(queueName);
  try {
    await sender.sendMessages({
      contentType: "application/json",
      subject,
      body,
      messageId,
    });
    return true;
  } catch (err) {
    context?.error(`Failed to publish "${subject}" event:`, err);
    return false;
  } finally {
    await sender.close();
  }
}

/**
 * Publish a "message-created" event. Returns true if enqueued, false if
 * Service Bus isn't configured or the publish failed (already logged).
 */
export function publishMessageCreated(
  event: MessageCreatedEvent,
  context?: InvocationContext,
): Promise<boolean> {
  const queueName = process.env.SERVICE_BUS_QUEUE || "message-created-events";
  return publish(queueName, "message-created", event, event.message_id, context);
}

/**
 * Publish a "confirmation-requested" event so the dispatch app sends the
 * double opt-in SMS code / email link. Best-effort like the others.
 */
export function publishConfirmationRequested(
  event: ConfirmationRequestedEvent,
  context?: InvocationContext,
): Promise<boolean> {
  const queueName = process.env.SERVICE_BUS_CONFIRM_QUEUE || "confirmation-requested-events";
  return publish(queueName, "confirmation-requested", event, event.confirmation_id, context);
}
