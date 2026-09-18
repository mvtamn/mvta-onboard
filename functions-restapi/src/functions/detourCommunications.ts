import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireAccess } from "../lib/access/require";
import { isGuid, validateDetourCommunication } from "../lib/validation";
import { readContractorNotification, recordSentElsewhere, sendCommunication } from "../lib/detourCommunication";
import { readDetourWorkflows } from "../lib/detourWorkflow";

interface CommunicationRow { id: string; detour_id: string; audience: string; channel: string; recipients: string | null; content: string; status: "draft" | "published" | "failed"; outcome: string | null; created_by: string; created_at: Date; published_by: string | null; published_at: Date | null; }

app.http("detourCommunicationsList", {
  route: "detours/{id}/communications", methods: ["GET"], authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = await requireAccess(request, "detours.view");
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const id = request.params.id;
    if (!isGuid(id)) return { status: 400, jsonBody: { error: "id must be a GUID" } };
    try {
      const pool = await getPool();
      const req = pool.request().input("detour_id", sql.UniqueIdentifier, id);
      const result = await req.query<CommunicationRow>("SELECT * FROM DetourCommunications WHERE detour_id=@detour_id ORDER BY created_at DESC");
      // Per-recipient receipts (migration 093) ride along when the table
      // exists; the console shows them under the sent copy.
      const receiptsReady = (await pool.request().query<{ ready: number }>("SELECT CASE WHEN OBJECT_ID('dbo.DetourCommunicationReceipts', 'U') IS NULL THEN 0 ELSE 1 END AS ready")).recordset[0]?.ready === 1;
      const receiptsByCommunication = new Map<string, unknown[]>();
      if (receiptsReady && result.recordset.length > 0) {
        const receipts = await pool.request().input("detour_id", sql.UniqueIdentifier, id).query<{ communication_id: string }>(
          "SELECT r.id, r.communication_id, r.recipient, r.provider_message_id, r.status, r.details, r.reported_at, r.updated_at FROM DetourCommunicationReceipts r JOIN DetourCommunications c ON c.id = r.communication_id WHERE c.detour_id=@detour_id ORDER BY r.recipient",
        );
        for (const receipt of receipts.recordset) {
          const list = receiptsByCommunication.get(receipt.communication_id) ?? [];
          list.push(receipt);
          receiptsByCommunication.set(receipt.communication_id, list);
        }
      }
      return { status: 200, jsonBody: { communications: result.recordset.map((row) => ({ ...row, receipts: receiptsByCommunication.get(row.id) ?? [] })) } };
    } catch (err) { context.error("GET detour communications failed:", err); return { status: 500, jsonBody: { error: "Internal server error" } }; }
  },
});

app.http("detourCommunicationCreate", {
  route: "detours/{id}/communications", methods: ["POST"], authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = await requireAccess(request, "detours.edit");
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const id = request.params.id;
    if (!isGuid(id)) return { status: 400, jsonBody: { error: "id must be a GUID" } };
    let body: Record<string, unknown>;
    try { body = (await request.json()) as Record<string, unknown>; } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON" } }; }
    const errors = validateDetourCommunication(body);
    if (errors.length) return { status: 400, jsonBody: { error: "Validation failed", details: errors } };
    try {
      const pool = await getPool();
      const req = pool.request();
      req.input("detour_id", sql.UniqueIdentifier, id).input("audience", sql.NVarChar(100), (body.audience as string).trim()).input("channel", sql.NVarChar(100), (body.channel as string).trim()).input("recipients", sql.NVarChar(2000), body.recipients ?? null).input("content", sql.NVarChar(4000), (body.content as string).trim()).input("created_by", sql.NVarChar(200), auth.principal.userDetails || "system");
      const result = await req.query<CommunicationRow>("INSERT INTO DetourCommunications (detour_id,audience,channel,recipients,content,created_by) OUTPUT INSERTED.* VALUES (@detour_id,@audience,@channel,@recipients,@content,@created_by)");
      return { status: 201, jsonBody: result.recordset[0] };
    } catch (err) { context.error("POST detour communication failed:", err); return { status: 500, jsonBody: { error: "Internal server error" } }; }
  },
});

// Publishing is the one place a Detour communication goes out, by either
// route: the server sends it, or a person sends it themselves and records
// that here. Both ask the Detour communication module, so Detour
// communication eligibility (CONTEXT.md) is enforced rather than merely
// defined - a closed Detour, one whose reviewed facts are awaiting re-review,
// or one that is not fulfilled yet is refused with a sentence saying what to
// fix. Until this existed, publish checked only that the row was a draft.
app.http("detourCommunicationPublish", {
  route: "detours/{id}/communications/{communicationId}/publish", methods: ["POST"], authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = await requireAccess(request, "detours.edit");
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const id = request.params.id; const communicationId = request.params.communicationId;
    if (!isGuid(id) || !isGuid(communicationId)) return { status: 400, jsonBody: { error: "ids must be GUIDs" } };
    let body: Record<string, unknown> = {};
    try { body = (await request.json()) as Record<string, unknown>; } catch { /* empty body is valid for publishing a saved draft */ }
    // send=true asks the server to deliver (migration 092 + the dispatch app).
    // Without it, publishing records that a human sent it elsewhere.
    const send = body.send === true;
    try {
      const pool = await getPool();
      const actor = auth.principal.userDetails || "system";
      const contractor = await readContractorNotification(pool);
      const workflow = (await readDetourWorkflows(pool, [id])).get(id);
      if (!workflow) return { status: 404, jsonBody: { error: "Detour not found" } };
      const outcome = send
        ? await sendCommunication({ pool, detourId: id, communicationId, actor, contractor, workflow, context })
        : await recordSentElsewhere({
          pool, detourId: id, communicationId, actor, contractor, workflow,
          outcome: typeof body.outcome === "string" ? body.outcome : "Published by Operations",
        });
      const row = (await pool.request().input("id", sql.UniqueIdentifier, communicationId)
        .query<CommunicationRow>("SELECT * FROM DetourCommunications WHERE id=@id")).recordset[0];
      if (!outcome.ok) {
        return { status: outcome.status, jsonBody: { error: outcome.refusal.sentence, code: outcome.refusal.code, ...(row ? { communication: row } : {}) } };
      }
      // Queued means the dispatch app will report the real outcome; a Teams
      // post is already done by the time we get here.
      const status = outcome.delivery.status === "queued" ? 202 : 200;
      return { status, jsonBody: { ...row, state: outcome.state } };
    } catch (err) { context.error("POST detour communication publish failed:", err); return { status: 500, jsonBody: { error: "Internal server error" } }; }
  },
});
