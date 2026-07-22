// Service Bus trigger: "message-created-events".
// For each new alert, find confirmed subscribers whose preferences match, send
// SMS/email via ACS, and record each attempt in SmsDeliveryLog/EmailDeliveryLog.
//
// Matching (POC scope): subscriber is 'confirmed', the alert's category is in
// their categories, and either they subscribed to "ALL" routes, the alert has
// no specific routes, or their routes intersect the alert's routes_affected.
import { app, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { sendSms, sendEmail } from "../lib/acs";
import { escapeHtml } from "../lib/html";
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
  email_status: string | null;
  routes: string | null;
}

function parseAudience(value: string | null): string[] | "ALL" | null {
  if (!value || value === "ALL") return value === "ALL" ? "ALL" : null;
  try {
    return JSON.parse(value) as string[];
  } catch {
    return null;
  }
}

function routeMatches(subscriberRoutes: string[] | "ALL" | null, alertRoutes: string[] | null): boolean {
  if (subscriberRoutes === "ALL" || subscriberRoutes == null) return true;
  if (!alertRoutes || alertRoutes.length === 0) return true; // system-wide alert
  const set = new Set(alertRoutes);
  return subscriberRoutes.some((r) => set.has(r));
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
    const pool = await getPool();

    const findSubs = pool.request();
    findSubs.input("category", sql.NVarChar, event.category);
    const { recordset } = await findSubs.query<SubscriberRow>(`
      SELECT subscriber_id, phone_number, email, email_status, routes
      FROM Subscribers
      WHERE status = 'confirmed'
        AND EXISTS (SELECT 1 FROM OPENJSON(categories) WHERE value = @category)
    `);

    const alertRoutes = event.routes_affected || null;
    const body = `MVTA: ${event.summary}`;

    let smsCount = 0;
    let emailCount = 0;
    for (const sub of recordset) {
      if (!routeMatches(parseAudience(sub.routes), alertRoutes)) continue;

      if (sub.phone_number) {
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

      if (sub.email && sub.email_status === "confirmed") {
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
