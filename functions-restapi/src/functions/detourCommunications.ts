import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { DETOUR_READ_ROLES, DETOUR_WRITE_ROLES, requireRole } from "../lib/auth";
import { isGuid, validateDetourCommunication } from "../lib/validation";
import { publishDetourCommunicationRequested } from "../lib/events";
import { parseRecipients } from "../lib/detourContractor";
import { deliverDetourToTeams } from "../lib/detourTeams";

interface CommunicationRow { id: string; detour_id: string; audience: string; channel: string; recipients: string | null; content: string; status: "draft" | "published" | "failed"; outcome: string | null; created_by: string; created_at: Date; published_by: string | null; published_at: Date | null; }

app.http("detourCommunicationsList", {
  route: "detours/{id}/communications", methods: ["GET"], authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, DETOUR_READ_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const id = request.params.id;
    if (!isGuid(id)) return { status: 400, jsonBody: { error: "id must be a GUID" } };
    try {
      const pool = await getPool();
      const req = pool.request().input("detour_id", sql.UniqueIdentifier, id);
      const result = await req.query<CommunicationRow>("SELECT * FROM DetourCommunications WHERE detour_id=@detour_id ORDER BY created_at DESC");
      return { status: 200, jsonBody: { communications: result.recordset } };
    } catch (err) { context.error("GET detour communications failed:", err); return { status: 500, jsonBody: { error: "Internal server error" } }; }
  },
});

app.http("detourCommunicationCreate", {
  route: "detours/{id}/communications", methods: ["POST"], authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, DETOUR_WRITE_ROLES);
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

app.http("detourCommunicationPublish", {
  route: "detours/{id}/communications/{communicationId}/publish", methods: ["POST"], authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, DETOUR_WRITE_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const id = request.params.id; const communicationId = request.params.communicationId;
    if (!isGuid(id) || !isGuid(communicationId)) return { status: 400, jsonBody: { error: "ids must be GUIDs" } };
    let body: Record<string, unknown> = {};
    try { body = (await request.json()) as Record<string, unknown>; } catch { /* empty body is valid for publishing a saved draft */ }
    // send=true asks the server to deliver by email (migration 092 +
    // dispatch app). Without it, publishing records that a human sent the
    // communication elsewhere, as before.
    const send = body.send === true;
    try {
      const pool = await getPool();
      const actor = auth.principal.userDetails || "system";
      const deliveryReady = send && (await pool.request().query<{ ready: number }>("SELECT CASE WHEN COL_LENGTH('dbo.DetourCommunications', 'delivery_status') IS NULL THEN 0 ELSE 1 END AS ready")).recordset[0]?.ready === 1;
      if (send && !deliveryReady) return { status: 503, jsonBody: { error: "Server-side delivery is not configured (migration 092)" } };
      if (send) {
        const current = (await pool.request().input("id", sql.UniqueIdentifier, communicationId).input("detour_id", sql.UniqueIdentifier, id)
          .query<CommunicationRow & { internal_number: string | null; number: string | null; closure: string }>("SELECT c.*, d.internal_number, d.number, d.closure FROM DetourCommunications c JOIN Detours d ON d.id = c.detour_id WHERE c.id=@id AND c.detour_id=@detour_id")).recordset[0];
        if (!current) return { status: 404, jsonBody: { error: "Communication not found" } };
        if (current.status !== "draft" && current.status !== "failed") return { status: 409, jsonBody: { error: "Only a draft or failed communication can be sent" } };
        const channel = current.channel.trim().toLowerCase();
        const ref = current.internal_number || current.number;
        const subject = `${ref ? `[${ref}] ` : ""}Detour: ${current.closure}`.slice(0, 500);
        if (channel === "teams") {
          // Teams is one webhook, delivered inline: snapshot, post, record.
          await pool.request().input("id", sql.UniqueIdentifier, communicationId).input("actor", sql.NVarChar(200), actor).input("subject", sql.NVarChar(500), subject).input("body", sql.NVarChar(sql.MAX), current.content)
            .query("UPDATE DetourCommunications SET delivery_status='queued', delivery_requested_at=SYSUTCDATETIME(), delivery_completed_at=NULL, delivery_error=NULL, delivery_provider_id=NULL, sent_subject=@subject, sent_body=@body, sent_recipients='Teams channel' WHERE id=@id");
          const outcome = await deliverDetourToTeams(subject, current.content);
          const sent = outcome.status === "sent";
          await pool.request().input("id", sql.UniqueIdentifier, communicationId).input("actor", sql.NVarChar(200), actor).input("delivery", sql.NVarChar(20), outcome.status).input("error", sql.NVarChar(1000), sent ? null : outcome.error)
            .query(sent
              ? "UPDATE DetourCommunications SET status='published', published_by=@actor, published_at=SYSUTCDATETIME(), outcome='Posted to Teams', delivery_status='sent', delivery_completed_at=SYSUTCDATETIME(), delivery_error=NULL WHERE id=@id"
              : "UPDATE DetourCommunications SET status=CASE WHEN @delivery='failed' THEN 'failed' ELSE 'draft' END, delivery_status=@delivery, delivery_completed_at=SYSUTCDATETIME(), delivery_error=@error WHERE id=@id");
          const after = (await pool.request().input("id", sql.UniqueIdentifier, communicationId).query<CommunicationRow>("SELECT * FROM DetourCommunications WHERE id=@id")).recordset[0];
          if (sent) return { status: 200, jsonBody: after };
          return { status: outcome.status === "skipped" ? 503 : 502, jsonBody: { error: outcome.error, communication: after } };
        }
        if (channel !== "email") return { status: 409, jsonBody: { error: "Server-side delivery is available for email and Teams communications only" } };
        const recipients = parseRecipients(current.recipients);
        if (recipients.length === 0) return { status: 409, jsonBody: { error: "Add at least one email recipient before sending" } };
        // Snapshot first, then enqueue: what went out is fixed before any
        // delivery attempt, and the row shows "queued" until the dispatcher
        // reports back.
        await pool.request().input("id", sql.UniqueIdentifier, communicationId).input("actor", sql.NVarChar(200), actor).input("subject", sql.NVarChar(500), subject).input("body", sql.NVarChar(sql.MAX), current.content).input("recipients", sql.NVarChar(2000), recipients.join(", "))
          .query("UPDATE DetourCommunications SET status='published', published_by=@actor, published_at=SYSUTCDATETIME(), outcome=NULL, delivery_status='queued', delivery_requested_at=SYSUTCDATETIME(), delivery_completed_at=NULL, delivery_error=NULL, delivery_provider_id=NULL, sent_subject=@subject, sent_body=@body, sent_recipients=@recipients WHERE id=@id");
        const queued = await publishDetourCommunicationRequested({ communication_id: communicationId, detour_id: id, recipients, subject, body: current.content }, context);
        if (!queued) {
          await pool.request().input("id", sql.UniqueIdentifier, communicationId)
            .query("UPDATE DetourCommunications SET delivery_status='skipped', delivery_completed_at=SYSUTCDATETIME(), delivery_error='Delivery service is not configured; send from your mail client and mark published', status='draft', published_by=NULL, published_at=NULL WHERE id=@id");
        }
        const after = (await pool.request().input("id", sql.UniqueIdentifier, communicationId).query<CommunicationRow>("SELECT * FROM DetourCommunications WHERE id=@id")).recordset[0];
        return { status: queued ? 202 : 503, jsonBody: queued ? after : { error: "Delivery service is not configured; send from your mail client and mark published", communication: after } };
      }
      const req = pool.request().input("id", sql.UniqueIdentifier, communicationId).input("detour_id", sql.UniqueIdentifier, id).input("published_by", sql.NVarChar(200), actor).input("outcome", sql.NVarChar(500), body.outcome ?? "Published by Operations");
      const result = await req.query<CommunicationRow>("UPDATE DetourCommunications SET status='published', published_by=@published_by, published_at=SYSUTCDATETIME(), outcome=@outcome WHERE id=@id AND detour_id=@detour_id AND status IN ('draft', 'failed'); SELECT * FROM DetourCommunications WHERE id=@id AND detour_id=@detour_id");
      const row = result.recordsets[1]?.[0] as CommunicationRow | undefined;
      if (!row) return { status: 409, jsonBody: { error: "Communication was not found or is already published" } };
      return { status: 200, jsonBody: row };
    } catch (err) { context.error("POST detour communication publish failed:", err); return { status: 500, jsonBody: { error: "Internal server error" } }; }
  },
});
