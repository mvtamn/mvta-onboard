// Service Bus trigger: "message-created-events".
// For each new alert, find confirmed subscribers whose preferences match, send
// SMS/email via ACS, and record each attempt in SmsDeliveryLog/EmailDeliveryLog.
// Delivery reports for those emails come back through acsEmailEvents.
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
import { randomUUID } from "node:crypto";
import { app, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { sendSms, sendEmail } from "../lib/acs";
import { channelRequested, deliveryLogStatus, teamsTargets } from "../lib/deliveryChannels";
import { parseAudience, routeMatches, zoneMatches } from "../lib/audienceMatch";
import { buildAlertEmail, manageLinkFor, oneClickUnsubscribeUrl, unsubscribeHeaders } from "../lib/alertEmail";
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
  manage_key: string | null;
  email_bounced: number;
}

async function logDelivery(
  pool: ConnectionPool,
  table: "SmsDeliveryLog" | "EmailDeliveryLog",
  messageId: string,
  subscriberId: string,
  status: string,
  providerId?: string,
  logId: string = randomUUID(),
): Promise<void> {
  const req = pool.request();
  req.input("log_id", sql.UniqueIdentifier, logId);
  req.input("message_id", sql.UniqueIdentifier, messageId);
  req.input("subscriber_id", sql.UniqueIdentifier, subscriberId);
  req.input("delivery_status", sql.NVarChar, status);
  req.input("provider_message_id", sql.NVarChar, providerId || null);
  await req.query(`
    INSERT INTO ${table} (log_id, message_id, subscriber_id, delivery_status, provider_message_id)
    VALUES (@log_id, @message_id, @subscriber_id, @delivery_status, @provider_message_id)
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
    // email_bounced: ACS reported this address bounced, or on its suppression
    // list, since the email channel was last confirmed (acsEmailEvents writes
    // the report onto the delivery's log row). Mailing it again harms the
    // sender's reputation for every rider; confirming the address again is
    // what clears it. Derived from the log rather than stored on the
    // subscriber, so it reads the same before and after migration 160.
    const { recordset } = await findSubs.query<SubscriberRow>(`
      SELECT s.subscriber_id, s.phone_number, s.email, s.sms_status, s.email_status, s.routes, s.zones, s.manage_key,
             CASE WHEN EXISTS (
               SELECT 1 FROM EmailDeliveryLog b
                WHERE b.subscriber_id = s.subscriber_id
                  AND b.delivery_status IN ('bounced', 'suppressed')
                  AND b.sent_at > COALESCE(
                        (SELECT MAX(c.confirmed_at) FROM SubscriberConfirmations c
                          WHERE c.subscriber_id = s.subscriber_id AND c.channel = 'email'),
                        '19000101')
             ) THEN 1 ELSE 0 END AS email_bounced
      FROM Subscribers s
      WHERE s.status = 'confirmed'
        AND EXISTS (SELECT 1 FROM OPENJSON(s.categories) WHERE value = @category)
    `);

    const alertRoutes = event.routes_affected || null;
    const alertZones = event.zones_affected || null;
    // Checked once, not per subscriber: an unset or invalid base URL would
    // otherwise log the same warning for every recipient of every alert.
    const riderAppBase = process.env.RIDER_APP_BASE_URL;
    const baseUsable = manageLinkFor(riderAppBase, "0".repeat(64)) !== null;
    if (sendEmailChannel && !baseUsable) {
      context.warn(
        `RIDER_APP_BASE_URL is unset or not a plain https URL; message ${event.message_id} goes out without a manage/unsubscribe link.`,
      );
    }
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
            deliveryLogStatus(res),
            res.providerId,
          );
          if (res.sent) smsCount++;
        } catch (err) {
          context.error(`SMS to subscriber ${sub.subscriber_id} failed:`, err);
          await logDelivery(pool, "SmsDeliveryLog", event.message_id, sub.subscriber_id, "failed");
        }
      }

      if (sendEmailChannel && sub.email && sub.email_status === "confirmed" && sub.email_bounced) {
        context.log(`Email to subscriber ${sub.subscriber_id} skipped: the address bounced since it was confirmed.`);
      } else if (sendEmailChannel && sub.email && sub.email_status === "confirmed") {
        // Chosen before the send so the one-click header can name it.
        const logId = randomUUID();
        try {
          // The footer's link is the rider's way to change or stop these emails.
          // Never logged: it carries the manage key.
          const link = manageLinkFor(riderAppBase, sub.manage_key);
          if (baseUsable && !link) {
            context.warn(`Subscriber ${sub.subscriber_id} has no manage key; email sent without a manage/unsubscribe link.`);
          }
          const mail = buildAlertEmail(event.summary, link);
          const headers = unsubscribeHeaders(oneClickUnsubscribeUrl(riderAppBase, logId));
          const res = await sendEmail(sub.email, mail.subject, mail.text, mail.html, context, headers);
          await logDelivery(
            pool,
            "EmailDeliveryLog",
            event.message_id,
            sub.subscriber_id,
            deliveryLogStatus(res),
            res.providerId,
            logId,
          );
          if (res.sent) emailCount++;
        } catch (err) {
          context.error(`Email to subscriber ${sub.subscriber_id} failed:`, err);
          await logDelivery(pool, "EmailDeliveryLog", event.message_id, sub.subscriber_id, "failed", undefined, logId);
        }
      }
    }

    context.log(
      `Dispatched message ${event.message_id}: ${smsCount} SMS, ${emailCount} email across ${recordset.length} candidate subscribers.`,
    );
  },
});
