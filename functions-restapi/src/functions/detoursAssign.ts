import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { requireAccess } from "../lib/access/require";
import { isGuid } from "../lib/validation";
import { actorFrom, performDetourAct } from "../lib/detourWorkflow";
import { refusalResponse } from "../lib/detourWorkflowResponse";

// Who is carrying a Detour. Until this existed, workflow_owner was written once
// - when an intake was promoted, to whoever promoted it - and could never
// change, so every Detour that arrived from the Avail feed was Unassigned
// forever. Detours & Closures asks OCC to run the workflow, which means being
// able to take one and hand it on.
//
// Ownership is not a state: assigning transitions nothing and never raises a
// re-review. `owner: null` hands it back to nobody, which is a real answer.
app.http("detoursAssign", {
  route: "detours/{id}/assign", methods: ["POST"], authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = await requireAccess(request, "detours.edit");
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const id = request.params.id;
    if (!isGuid(id)) return { status: 400, jsonBody: { error: "id must be a GUID" } };
    let body: Record<string, unknown>;
    try { body = (await request.json()) as Record<string, unknown>; } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON" } }; }
    if (body.owner !== null && typeof body.owner !== "string") {
      return { status: 400, jsonBody: { error: "owner must be a name, or null to unassign" } };
    }
    const owner = typeof body.owner === "string" ? body.owner.trim() || null : null;
    try {
      const actor = actorFrom(auth.principal);
      const outcome = await performDetourAct(await getPool(), id, { act: "assign", owner }, actor);
      if (!outcome.ok) return refusalResponse(outcome.refusal);
      return { status: 200, jsonBody: { id, workflow_owner: owner } };
    } catch (err) { context.error("POST detour assign failed:", err); return { status: 500, jsonBody: { error: "Internal server error" } }; }
  },
});
