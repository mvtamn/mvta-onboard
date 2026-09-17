import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { DETOUR_WRITE_ROLES, requireRole } from "../lib/auth";
import { isGuid } from "../lib/validation";
import { actorFrom, performDetourAct } from "../lib/detourWorkflow";
import { refusalResponse } from "../lib/detourWorkflowResponse";

app.http("detoursClosure", {
  route: "detours/{id}/close", methods: ["POST"], authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, DETOUR_WRITE_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const id = request.params.id;
    if (!isGuid(id)) return { status: 400, jsonBody: { error: "id must be a GUID" } };
    let body: Record<string, unknown>;
    try { body = (await request.json()) as Record<string, unknown>; } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON" } }; }
    if (typeof body.reason !== "string" || !body.reason.trim()) return { status: 400, jsonBody: { error: "reason is required to close a detour" } };
    if (body.reason.length > 1000) return { status: 400, jsonBody: { error: "reason must be at most 1000 characters" } };
    try {
      const reason = body.reason.trim();
      const outcome = await performDetourAct(await getPool(), id, { act: "close", reason }, actorFrom(auth.principal));
      if (!outcome.ok) return refusalResponse(outcome.refusal);
      return { status: 200, jsonBody: { id, lifecycle_state: outcome.detour.lifecycle_state, closure_reason: reason } };
    } catch (err) { context.error("POST detour close failed:", err); return { status: 500, jsonBody: { error: "Internal server error" } }; }
  },
});
