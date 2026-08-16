import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { DETOUR_READ_ROLES, DETOUR_WRITE_ROLES, requireRole } from "../lib/auth";
import { isGuid, validateDetourCommunication } from "../lib/validation";

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
    try {
      const pool = await getPool();
      const req = pool.request().input("id", sql.UniqueIdentifier, communicationId).input("detour_id", sql.UniqueIdentifier, id).input("published_by", sql.NVarChar(200), auth.principal.userDetails || "system").input("outcome", sql.NVarChar(500), body.outcome ?? "Published by Operations");
      const result = await req.query<CommunicationRow>("UPDATE DetourCommunications SET status='published', published_by=@published_by, published_at=SYSUTCDATETIME(), outcome=@outcome WHERE id=@id AND detour_id=@detour_id AND status='draft'; SELECT * FROM DetourCommunications WHERE id=@id AND detour_id=@detour_id");
      const row = result.recordsets[1]?.[0] as CommunicationRow | undefined;
      if (!row) return { status: 409, jsonBody: { error: "Communication was not found or is already published" } };
      return { status: 200, jsonBody: row };
    } catch (err) { context.error("POST detour communication publish failed:", err); return { status: 500, jsonBody: { error: "Internal server error" } }; }
  },
});
