// Azure Communication Services senders (SMS + email), identity-based.
//
// Guarded: if ACS_ENDPOINT (and the relevant "from" setting) aren't configured,
// send functions log and no-op rather than throwing. That keeps the dispatch
// app deployable and its triggers healthy BEFORE ACS is provisioned (ACS is a
// portal step with real cost - see HANDOFF.md §8). Once the settings exist,
// sending activates with no code change.
import { DefaultAzureCredential } from "@azure/identity";
import { SmsClient } from "@azure/communication-sms";
import { EmailClient } from "@azure/communication-email";
import type { InvocationContext } from "@azure/functions";

export interface SendResult {
  sent: boolean;
  providerId?: string;
  skipped?: string;
}

let smsClient: SmsClient | undefined | null = null; // null = not yet resolved
let emailClient: EmailClient | undefined | null = null;

function getSmsClient(): SmsClient | undefined {
  if (smsClient !== null) return smsClient;
  const endpoint = process.env.ACS_ENDPOINT;
  smsClient = endpoint ? new SmsClient(endpoint, new DefaultAzureCredential()) : undefined;
  return smsClient;
}

function getEmailClient(): EmailClient | undefined {
  if (emailClient !== null) return emailClient;
  const endpoint = process.env.ACS_ENDPOINT;
  emailClient = endpoint ? new EmailClient(endpoint, new DefaultAzureCredential()) : undefined;
  return emailClient;
}

export async function sendSms(
  to: string,
  message: string,
  context?: InvocationContext,
): Promise<SendResult> {
  const client = getSmsClient();
  const from = process.env.ACS_SMS_FROM;
  if (!client || !from) {
    context?.warn("ACS SMS not configured (ACS_ENDPOINT/ACS_SMS_FROM) - skipping SMS.");
    return { sent: false, skipped: "acs_not_configured" };
  }
  const [result] = await client.send({ from, to: [to], message });
  return { sent: result.successful, providerId: result.messageId ?? undefined };
}

export async function sendEmail(
  to: string,
  subject: string,
  plainText: string,
  html: string,
  context?: InvocationContext,
): Promise<SendResult> {
  const client = getEmailClient();
  const from = process.env.ACS_EMAIL_FROM;
  if (!client || !from) {
    context?.warn("ACS Email not configured (ACS_ENDPOINT/ACS_EMAIL_FROM) - skipping email.");
    return { sent: false, skipped: "acs_not_configured" };
  }
  const poller = await client.beginSend({
    senderAddress: from,
    content: { subject, plainText, html },
    recipients: { to: [{ address: to }] },
  });
  const result = await poller.pollUntilDone();
  return { sent: result.status === "Succeeded", providerId: result.id };
}
