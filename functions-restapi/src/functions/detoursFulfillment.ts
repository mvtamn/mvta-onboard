import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { requireAccess } from "../lib/access/require";
import { isGuid, validateDetourFulfillmentChange } from "../lib/validation";
import { actorFrom, performDetourAct } from "../lib/detourWorkflow";
import { refusalResponse } from "../lib/detourWorkflowResponse";

// Manual fallback after an Avail conflict: the Detour becomes a fixed-route
// manual Detour and is fulfilled.
app.http("detoursFulfillment", {
  route: "detours/{id}/fulfillment",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = await requireAccess(request, "detours.edit");
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const id = request.params.id;
    if (!isGuid(id)) return { status: 400, jsonBody: { error: "id must be a GUID" } };
    let body: Record<string, unknown>;
    try { body = (await request.json()) as Record<string, unknown>; } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON" } }; }
    const errors = validateDetourFulfillmentChange(body);
    if (errors.length) return { status: 400, jsonBody: { error: "Validation failed", details: errors } };
    if (body.fulfillment_mode !== "fixed_route_manual") {
      return { status: 409, jsonBody: { error: "Only fixed-route manual fallback is supported after an Avail conflict" } };
    }
    try {
      const outcome = await performDetourAct(await getPool(), id, { act: "manual_fallback", reason: body.reason as string }, actorFrom(auth.principal));
      if (!outcome.ok) return refusalResponse(outcome.refusal);
      const { detour } = outcome;
      return { status: 200, jsonBody: { id, fulfillment_mode: detour.fulfillment_mode, lifecycle_state: detour.lifecycle_state, readiness: "ready_for_manual_operations" } };
    } catch (err) {
      context.error("POST /detours/{id}/fulfillment failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
