// Service Bus trigger: "message-created-events".
// For each new alert, find confirmed subscribers whose preferences match, send
// SMS/email via ACS, and record each attempt in SmsDeliveryLog/EmailDeliveryLog.
//
// Matching (POC scope): the subscriber record is 'confirmed', the alert's
// category is in their categories, and they are in the alert's audience by
// route AND by zone (lib/audienceMatch.ts) - where an alert naming no routes,
// or no zones, is system-wide on that dimension.
//
// Each channel is then gated on its OWN confirmation state - sms_status and
// email_status (migration 117) - never on the record's. Before 117, `status`
// was both the record's lifecycle and the SMS channel's state, so confirming
// an email link would have made an unproven phone number SMS-eligible. A
// channel may not vouch for the other one; that is what double opt-in is.
import { app, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { sendSms, sendEmail } from "../lib/acs";
import { escapeHtml } from "../lib/html";
import { channelRequested, teamsTargets } from "../lib/deliveryChannels";
import { parseAudience, routeMatches, zoneMatches } from "../lib/audienceMatch";
import type { ConnectionPool } from "mssql";

interface MessageCreatedEvent {
  message_id: string;
  category: string;
  severity: string;
  summary: string;
  routes_affected: string[] | null;
  zones_affected: string[] | null;
  channels: string[] | null;
  created_at: string;
  expires_at: string;
}

interface SubscriberRow {
  subscriber_id: string;
  phone_number: string | null;
  email: string | null;
  sms_status: string | null;
  email_status: string | null;
  routes: string | null;
  zones: string | null;
}

async function logDelivery(
  pool: ConnectionPool,
  table: "SmsDeliveryLog" | "EmailDeliveryLog",
  messageId: string,
  subscriberId: string,
  status: string,
  providerId?: string,
): Promise<void> {
  const req = pool.request();
  req.input("message_id", sql.UniqueIdentifier, messageId);
  req.input("subscriber_id", sql.UniqueIdentifier, subscriberId);
  req.input("delivery_status", sql.NVarChar, status);
  req.input("provider_message_id", sql.NVarChar, providerId || null);
  await req.query(`
    INSERT INTO ${table} (message_id, subscriber_id, delivery_status, provider_message_id)
    VALUES (@message_id, @subscriber_id, @delivery_status, @provider_message_id)
  `);
}

app.serviceBusQueue("dispatchMessageCreated", {
  connection: "ServiceBusConnection",
  queueName: "message-created-events",
  handler: async (message: unknown, context: InvocationContext) => {
    const event = message as MessageCreatedEvent;
    const sendSmsChannel = channelRequested(event.channels, "SMS");
    const sendEmailChannel = channelRequested(event.channels, "Email");
    const requestedTeamsTargets = teamsTargets(event.channels);

    if (requestedTeamsTargets.length > 0) {
      context.log(
        `Message ${event.message_id} requested future Teams delivery to: ${requestedTeamsTargets.join(", ")}. No Teams connector is configured yet.`,
      );
    }

    // Internal/web-only messages should not fan out to rider SMS/email.
    if (!sendSmsChannel && !sendEmailChannel) {
      context.log(
        `Message ${event.message_id} requested no subscriber SMS/email channels; subscriber dispatch skipped.`,
      );
      return;
    }

    const pool = await getPool();
    const findSubs = pool.request();
    findSubs.input("category", sql.NVarChar, event.category);
    const { recordset } = await findSubs.query<SubscriberRow>(`
      SELECT subscriber_id, phone_number, email, sms_status, email_status, routes, zones
      FROM Subscribers
      WHERE status = 'confirmed'
        AND EXISTS (SELECT 1 FROM OPENJSON(categories) WHERE value = @category)
    `);

    const alertRoutes = event.routes_affected || null;
    const alertZones = event.zones_affected || null;
    const body = `MVTA: ${event.summary}`;

    let smsCount = 0;
    let emailCount = 0;
    for (const sub of recordset) {
      if (!routeMatches(parseAudience(sub.routes), alertRoutes)) continue;
      // CURRENT_STATE 7.3: zones_affected was read into the event and never
      // looked at, so a zone-scoped alert reached every subscriber. See
      // audienceMatch.ts for why these are external_location_ids.
      if (!zoneMatches(parseAudience(sub.zones), alertZones)) continue;

      if (sendSmsChannel && sub.phone_number && sub.sms_status === "confirmed") {
        try {
          const res = await sendSms(sub.phone_number, body, context);
          await logDelivery(
            pool,
            "SmsDeliveryLog",
            event.message_id,
            sub.subscriber_id,
            res.sent ? "sent" : "failed",
            res.providerId,
          );
          if (res.sent) smsCount++;
        } catch (err) {
          context.error(`SMS to subscriber ${sub.subscriber_id} failed:`, err);
          await logDelivery(pool, "SmsDeliveryLog", event.message_id, sub.subscriber_id, "failed");
        }
      }

      if (sendEmailChannel && sub.email && sub.email_status === "confirmed") {
        try {
          const res = await sendEmail(
            sub.email,
            "MVTA Service Alert",
            event.summary,
            `<p>${escapeHtml(event.summary)}</p>`,
            context,
          );
          await logDelivery(
            pool,
            "EmailDeliveryLog",
            event.message_id,
            sub.subscriber_id,
            res.sent ? "sent" : "failed",
            res.providerId,
          );
          if (res.sent) emailCount++;
        } catch (err) {
          context.error(`Email to subscriber ${sub.subscriber_id} failed:`, err);
          await logDelivery(pool, "EmailDeliveryLog", event.message_id, sub.subscriber_id, "failed");
        }
      }
    }

    context.log(
      `Dispatched message ${event.message_id}: ${smsCount} SMS, ${emailCount} email across ${recordset.length} candidate subscribers.`,
    );
  },
});
