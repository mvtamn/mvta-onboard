// Service Bus trigger: "confirmation-requested-events".
// Sends the double opt-in SMS code / email confirmation link. Delivery is
// logged; a send failure dead-letters via the queue's maxDeliveryCount so it
// retries a bounded number of times.
import { app, type InvocationContext } from "@azure/functions";
import { sendSms, sendEmail } from "../lib/acs";

interface ConfirmationRequestedEvent {
  confirmation_id: string;
  subscriber_id: string;
  channel: "sms" | "email";
  token: string;
  phone_number: string | null;
  email: string | null;
}

app.serviceBusQueue("dispatchConfirmation", {
  connection: "ServiceBusConnection",
  queueName: "confirmation-requested-events",
  handler: async (message: unknown, context: InvocationContext) => {
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
