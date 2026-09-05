// POST /api/acs-email-events - Event Grid webhook for ACS email delivery
// reports (Microsoft.Communication.EmailDeliveryReportReceived). Function-
// key authenticated: the Event Grid subscription's endpoint URL carries
// ?code=<function key>. Handles the subscription-validation handshake, then
// updates the per-recipient receipt (migration 093) matched by provider
// message id and recomputes the parent communication's delivery_status.
//
// Events for messages this app did not send (other ACS senders on the same
// resource) match no receipt and are acknowledged without effect.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import sql from "mssql";
import { getPool } from "../lib/db";
import { aggregateDelivery, parseEmailReceipts, validationResponse, type ReceiptStatus } from "../lib/emailReceipts";

app.http("acsEmailEvents", {
  route: "acs-email-events",
  methods: ["POST"],
  authLevel: "function",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    let events: unknown;
    try { events = await request.json(); } catch { return { status: 400, jsonBody: { error: "Body must be a JSON array of Event Grid events" } }; }
    const batch = Array.isArray(events) ? events : [events];
    const validation = validationResponse(batch);
    if (validation) return { status: 200, jsonBody: validation };

    const receipts = parseEmailReceipts(batch);
    if (receipts.length === 0) return { status: 200, jsonBody: { updated: 0 } };
    const pool = await getPool();
    const touched = new Set<string>();
    for (const receipt of receipts) {
      const updated = await pool.request()
        .input("provider", sql.NVarChar(200), receipt.provider_message_id)
        .input("status", sql.NVarChar(30), receipt.status)
        .input("details", sql.NVarChar(1000), receipt.details)
        .input("reported_at", sql.DateTime2, receipt.reported_at ? new Date(receipt.reported_at) : null)
        .query<{ communication_id: string }>(
          "UPDATE DetourCommunicationReceipts SET status=@status, details=@details, reported_at=COALESCE(@reported_at, reported_at), updated_at=SYSUTCDATETIME() OUTPUT INSERTED.communication_id WHERE provider_message_id=@provider",
        );
      for (const row of updated.recordset) touched.add(row.communication_id);
    }
    for (const communicationId of touched) {
      const rows = await pool.request().input("id", sql.UniqueIdentifier, communicationId)
        .query<{ status: ReceiptStatus; recipient: string; details: string | null }>("SELECT status, recipient, details FROM DetourCommunicationReceipts WHERE communication_id=@id");
      const aggregate = aggregateDelivery(rows.recordset.map((r) => r.status));
      const failures = rows.recordset.filter((r) => !["accepted", "delivered", "expanded"].includes(r.status)).map((r) => `${r.recipient}: ${r.status.replace("_", " ")}${r.details ? ` (${r.details})` : ""}`).join("; ").slice(0, 1000) || null;
      await pool.request().input("id", sql.UniqueIdentifier, communicationId).input("status", sql.NVarChar(20), aggregate.status).input("error", sql.NVarChar(1000), failures)
        .query(`UPDATE DetourCommunications
                SET delivery_status=@status, delivery_error=@error, delivery_completed_at=SYSUTCDATETIME(),
                    status = CASE WHEN @status = 'failed' THEN 'failed' ELSE status END,
                    outcome = CASE WHEN @status = 'delivered' THEN 'Delivered by email to ' + ISNULL(sent_recipients, '') WHEN @status = 'partially_sent' THEN 'Partially delivered by email; see delivery error' ELSE outcome END
                WHERE id=@id AND delivery_status IN ('sent', 'delivered', 'partially_sent', 'failed')`);
    }
    context.log(`ACS email receipts: ${receipts.length} events, ${touched.size} communications updated`);
    return { status: 200, jsonBody: { updated: touched.size } };
  },
});
