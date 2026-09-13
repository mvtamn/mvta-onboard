// Service Bus trigger: "confirmation-requested-events".
// Sends the double opt-in SMS code / email confirmation link. Delivery is
// logged; a send failure dead-letters via the queue's maxDeliveryCount so it
// retries a bounded number of times.
import { app, type InvocationContext } from "@azure/functions";
import { sendSms, sendEmail } from "../lib/acs";
import { buildManageLinkEmail, buildManageLinkSms, manageLinkFor } from "../lib/alertEmail";

interface ConfirmationRequestedEvent {
  confirmation_id: string;
  subscriber_id: string;
  channel: "sms" | "email";
  token: string;
  phone_number: string | null;
  email: string | null;
}

// A rider asking for the link to their own subscription again (POST
// /api/subscribers/manage-link). Carried on this same queue, told apart by
// `kind`, so the request needed no new queue, trigger or role assignment.
interface ManageLinkRequestedEvent {
  kind: "manage_link";
  subscriber_id: string;
  channel: "sms" | "email";
  manage_key: string;
  phone_number: string | null;
  email: string | null;
}

async function sendManageLink(event: ManageLinkRequestedEvent, context: InvocationContext): Promise<void> {
  const link = manageLinkFor(process.env.RIDER_APP_BASE_URL, event.manage_key);
  if (!link) {
    context.warn(
      `manage-link request for subscriber ${event.subscriber_id} not sent: RIDER_APP_BASE_URL is unset or invalid, or the key is malformed.`,
    );
    return;
  }
  // Logged by subscriber id, never by contact or link: the link carries the
  // manage key, and the contact is not needed to trace a delivery.
  if (event.channel === "sms" && event.phone_number) {
    const res = await sendSms(event.phone_number, buildManageLinkSms(link), context);
    context.log(`Manage-link SMS for subscriber ${event.subscriber_id}: sent=${res.sent} ${res.skipped ?? ""}`);
  } else if (event.channel === "email" && event.email) {
    const mail = buildManageLinkEmail(link);
    const res = await sendEmail(event.email, mail.subject, mail.text, mail.html, context);
    context.log(`Manage-link email for subscriber ${event.subscriber_id}: sent=${res.sent} ${res.skipped ?? ""}`);
  } else {
    context.warn(`manage-link request for subscriber ${event.subscriber_id} is missing its contact for channel=${event.channel}`);
  }
}

app.serviceBusQueue("dispatchConfirmation", {
  connection: "ServiceBusConnection",
  queueName: "confirmation-requested-events",
  handler: async (message: unknown, context: InvocationContext) => {
    // Checked before anything else. A manage-link request has no confirmation
    // token, and sent down the path below it would text a rider "your
    // confirmation code is undefined". A message without `kind` is a
    // confirmation, which keeps messages already on the queue working.
    if ((message as { kind?: string }).kind === "manage_link") {
      await sendManageLink(message as ManageLinkRequestedEvent, context);
      return;
    }

    const { channel, token, phone_number, email } = message as ConfirmationRequestedEvent;

    if (channel === "sms" && phone_number) {
      const body = `MVTA alerts: your confirmation code is ${token}. Reply with this code to confirm. Reply STOP to cancel.`;
      const res = await sendSms(phone_number, body, context);
      context.log(`Confirmation SMS to ${phone_number}: sent=${res.sent} ${res.skipped ?? ""}`);
    } else if (channel === "email" && email) {
      const base = process.env.RIDER_APP_BASE_URL || "";
      const link = `${base}/api/subscribers/confirm-email?token=${encodeURIComponent(token)}`;
      const html = `<p>Confirm your MVTA service alert subscription:</p><p><a href="${link}">Confirm subscription</a></p><p>If you didn't request this, you can ignore this email.</p>`;
      const text = `Confirm your MVTA service alert subscription: ${link}`;
      const res = await sendEmail(email, "Confirm your MVTA alerts", text, html, context);
      context.log(`Confirmation email to ${email}: sent=${res.sent} ${res.skipped ?? ""}`);
    } else {
      context.warn(`confirmation-requested event missing contact for channel=${channel}`);
    }
  },
});
