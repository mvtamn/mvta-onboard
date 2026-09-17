import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { DETOUR_WRITE_ROLES, requireRole } from "../lib/auth";
import { isGuid, validateAvailEntryConfirmation } from "../lib/validation";
import { actorFrom, performDetourAct, type AvailEntryResult } from "../lib/detourWorkflow";
import { refusalResponse } from "../lib/detourWorkflowResponse";

// Records what happened when someone tried to build the Detour in Avail.
// Confirming it as entered is refused while a conflict is unresolved or an
// OCC re-review is outstanding; recording a failed or deferred attempt is not.
app.http("detoursAvailEntry", {
  route: "detours/{id}/avail-entry",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, DETOUR_WRITE_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const id = request.params.id;
    if (!isGuid(id)) return { status: 400, jsonBody: { error: "id must be a GUID" } };

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
    }
    const errors = validateAvailEntryConfirmation(body);
    if (errors.length) return { status: 400, jsonBody: { error: "Validation failed", details: errors } };

    const result = body.result as AvailEntryResult;
    try {
      const outcome = await performDetourAct(await getPool(), id, {
        act: "avail_entry",
        result,
        externalDetourId: typeof body.external_detour_id === "string" ? body.external_detour_id : null,
        detail: typeof body.detail === "string" ? body.detail : null,
      }, actorFrom(auth.principal));
      if (!outcome.ok) return refusalResponse(outcome.refusal);
      return { status: 200, jsonBody: { id, result, lifecycle_state: outcome.detour.lifecycle_state } };
    } catch (err) {
      context.error("POST /detours/{id}/avail-entry failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
