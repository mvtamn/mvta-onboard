// Service Bus trigger: "message-created-events".
// For each new alert, find confirmed subscribers whose preferences match, send
// SMS/email via ACS, and record each attempt in SmsDeliveryLog/EmailDeliveryLog.
// "Teams: <audience>" channels post one card per audience to that audience's
// Teams channel (lib/teamsAnnouncements.ts), recorded in TeamsDeliveryLog.
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
import { channelRequested, teamsTargets } from "../lib/deliveryChannels";
import { parseAudience, routeMatches, zoneMatches } from "../lib/audienceMatch";
import { buildAlertEmail, manageLinkFor } from "../lib/alertEmail";
import { postAnnouncementToTeams } from "../lib/teamsAnnouncements";
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

// One post per audience, recorded in TeamsDeliveryLog (migration 144).
//
// Never throws. A throw redelivers the whole Service Bus message, which would
// resend every rider's SMS and email to retry one channel post. A failed post
// is recorded as failed and stays that way.
//
// An audience already logged as sent for this message is not posted again:
// the subscriber fan-out below can throw after Teams has gone out, and the
// redelivery that follows must not repeat the post in the channel.
async function postToTeams(event: MessageCreatedEvent, audiences: string[], context: InvocationContext): Promise<void> {
  let pool: ConnectionPool | null = null;
  let alreadySent = new Set<string>();
  try {
    pool = await getPool();
    const table = await pool.request().query<{ present: number | null }>("SELECT OBJECT_ID('dbo.TeamsDeliveryLog', 'U') AS present");
    if (table.recordset[0]?.present == null) {
      context.warn(`TeamsDeliveryLog is missing (run migration 144); Teams posts for message ${event.message_id} go unrecorded.`);
      pool = null;
    } else {
      const sent = await pool.request()
        .input("message_id", sql.UniqueIdentifier, event.message_id)
        .query<{ audience: string }>("SELECT audience FROM TeamsDeliveryLog WHERE message_id = @message_id AND delivery_status = 'sent'");
      alreadySent = new Set(sent.recordset.map((row) => row.audience.toLowerCase()));
    }
  } catch (err) {
    context.error(`Could not read Teams delivery history for message ${event.message_id}:`, err);
    pool = null;
  }

  for (const audience of audiences) {
    if (alreadySent.has(audience.toLowerCase())) {
      context.log(`Message ${event.message_id} was already posted to Teams for ${audience}; not posting again.`);
      continue;
    }
    const outcome = await postAnnouncementToTeams(audience, event);
    const error = outcome.status === "sent" ? null : outcome.error;
    if (error) context.warn(`Teams post for message ${event.message_id} to ${audience} ${outcome.status}: ${error}`);
    else context.log(`Message ${event.message_id} posted to Teams for ${audience}.`);
    if (!pool) continue;
    try {
      await pool.request()
        .input("message_id", sql.UniqueIdentifier, event.message_id)
        .input("audience", sql.NVarChar(100), audience)
        .input("delivery_status", sql.NVarChar(20), outcome.status)
        .input("error", sql.NVarChar(500), error?.slice(0, 500) ?? null)
        .query(`
          MERGE TeamsDeliveryLog WITH (HOLDLOCK) AS target
          USING (SELECT @message_id AS message_id, @audience AS audience) AS source
            ON target.message_id = source.message_id AND target.audience = source.audience
          WHEN MATCHED THEN UPDATE SET delivery_status = @delivery_status, error = @error, attempted_at = SYSUTCDATETIME()
          WHEN NOT MATCHED THEN INSERT (message_id, audience, delivery_status, error) VALUES (@message_id, @audience, @delivery_status, @error);
        `);
    } catch (err) {
      context.error(`Could not record the Teams post for message ${event.message_id} to ${audience}:`, err);
    }
  }
}

app.serviceBusQueue("dispatchMessageCreated", {
  connection: "ServiceBusConnection",
  queueName: "message-created-events",
  handler: async (message: unknown, context: InvocationContext) => {
    const event = message as MessageCreatedEvent;
    const sendSmsChannel = channelRequested(event.channels, "SMS");
    const sendEmailChannel = channelRequested(event.channels, "Email");
    const requestedTeamsTargets = teamsTargets(event.channels);

    // Teams first: a Teams-only announcement returns below, before any
    // subscriber is read.
    if (requestedTeamsTargets.length > 0) {
      await postToTeams(event, requestedTeamsTargets, context);
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
      SELECT subscriber_id, phone_number, email, sms_status, email_status, routes, zones, manage_key
      FROM Subscribers
      WHERE status = 'confirmed'
        AND EXISTS (SELECT 1 FROM OPENJSON(categories) WHERE value = @category)
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
          // The footer's link is the rider's way to change or stop these emails.
          // Never logged: it carries the manage key.
          const link = manageLinkFor(riderAppBase, sub.manage_key);
          if (baseUsable && !link) {
            context.warn(`Subscriber ${sub.subscriber_id} has no manage key; email sent without a manage/unsubscribe link.`);
          }
          const mail = buildAlertEmail(event.summary, link);
          const res = await sendEmail(sub.email, mail.subject, mail.text, mail.html, context);
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
