// Service Bus trigger: "detour-communication-requested".
// Delivers a published Detour communication by email to each recipient and
// writes the outcome back to DetourCommunications (migration 092). The
// subject/body/recipients in the message are the snapshot the REST API
// froze on the row; this never re-reads the editable draft.
//
// Per-recipient sends, because ACS reports one result per send and staff
// need to know which addresses failed. A partial failure leaves the row
// "partially_sent" with the failures named; a total failure sets status
// back to "failed" so the console offers a retry.
import { app, type InvocationContext } from "@azure/functions";
import sql from "mssql";
import { sendEmail } from "../lib/acs";
import { getPool } from "../lib/db";
import { escapeHtml } from "../lib/html";

interface DetourCommunicationRequestedEvent {
  communication_id: string;
  detour_id: string;
  recipients: string[];
  subject: string;
  body: string;
}

function bodyAsHtml(text: string): string {
  return `<div style="font-family: Segoe UI, Arial, sans-serif; font-size: 14px; white-space: pre-wrap;">${escapeHtml(text)}</div>`;
}

app.serviceBusQueue("dispatchDetourCommunication", {
  connection: "ServiceBusConnection",
  queueName: "detour-communication-requested",
  handler: async (message: unknown, context: InvocationContext) => {
    const event = message as DetourCommunicationRequestedEvent;
    if (!event?.communication_id || !Array.isArray(event.recipients) || event.recipients.length === 0) {
      context.warn("detour-communication-requested event is missing communication_id or recipients; dropping.");
      return;
    }
    const html = bodyAsHtml(event.body);
    const failures: string[] = [];
    const providerIds: string[] = [];
    const accepted: Array<{ to: string; providerId: string | null }> = [];
    let skipped: string | null = null;
    for (const to of event.recipients) {
      try {
        const res = await sendEmail(to, event.subject, event.body, html, context);
        if (res.skipped) { skipped = res.skipped; break; }
        if (res.sent) { providerIds.push(res.providerId ?? ""); accepted.push({ to, providerId: res.providerId ?? null }); }
        else failures.push(`${to}: provider reported failure`);
      } catch (err) {
        failures.push(`${to}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const status = skipped ? "skipped" : failures.length === 0 ? "sent" : failures.length === event.recipients.length ? "failed" : "partially_sent";
    const error = skipped ? "Email delivery is not configured (ACS_ENDPOINT/ACS_EMAIL_FROM); send from your mail client and mark published" : failures.length ? failures.join("; ").slice(0, 1000) : null;
    context.log(`Detour communication ${event.communication_id}: ${status} (${providerIds.length}/${event.recipients.length} sent)`);
    const pool = await getPool();
    // One receipt row per accepted recipient (migration 093), keyed by the
    // provider message id so the Event Grid delivery report can find it.
    const receiptsReady = (await pool.request().query<{ ready: number }>("SELECT CASE WHEN OBJECT_ID('dbo.DetourCommunicationReceipts', 'U') IS NULL THEN 0 ELSE 1 END AS ready")).recordset[0]?.ready === 1;
    if (receiptsReady) {
      await pool.request().input("id", sql.UniqueIdentifier, event.communication_id).query("DELETE FROM DetourCommunicationReceipts WHERE communication_id=@id");
      for (const a of accepted) {
        await pool.request().input("id", sql.UniqueIdentifier, event.communication_id).input("recipient", sql.NVarChar(320), a.to).input("provider", sql.NVarChar(200), a.providerId)
          .query("INSERT INTO DetourCommunicationReceipts (communication_id, recipient, provider_message_id, status) VALUES (@id, @recipient, @provider, 'accepted')");
      }
      for (const f of failures) {
        const to = f.split(":")[0];
        await pool.request().input("id", sql.UniqueIdentifier, event.communication_id).input("recipient", sql.NVarChar(320), to).input("details", sql.NVarChar(1000), f.slice(to.length + 2))
          .query("INSERT INTO DetourCommunicationReceipts (communication_id, recipient, status, details) VALUES (@id, @recipient, 'failed', @details)");
      }
    }
    await pool.request()
      .input("id", sql.UniqueIdentifier, event.communication_id)
      .input("status", sql.NVarChar(20), status)
      .input("error", sql.NVarChar(1000), error)
      .input("provider", sql.NVarChar(200), providerIds.filter(Boolean).join(",").slice(0, 200) || null)
      .query(`UPDATE DetourCommunications
              SET delivery_status=@status, delivery_completed_at=SYSUTCDATETIME(), delivery_error=@error, delivery_provider_id=@provider,
                  status = CASE WHEN @status IN ('failed', 'skipped') THEN 'failed' ELSE status END,
                  outcome = CASE WHEN @status = 'sent' THEN 'Sent by email to ' + ISNULL(sent_recipients, '') WHEN @status = 'partially_sent' THEN 'Partially sent by email; see delivery error' ELSE outcome END
              WHERE id=@id`);
  },
});
