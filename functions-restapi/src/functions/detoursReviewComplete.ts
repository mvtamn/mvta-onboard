import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { DETOUR_WRITE_ROLES, requireRole } from "../lib/auth";
import { isGuid } from "../lib/validation";
import { actorFrom, performDetourAct } from "../lib/detourWorkflow";
import { refusalResponse } from "../lib/detourWorkflowResponse";

// The only path back from Outstanding re-review. Completing it is audited:
// the reason it was raised and any notes go into the workflow history.
app.http("detoursReviewComplete", {
  route: "detours/{id}/review-complete", methods: ["POST"], authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, DETOUR_WRITE_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const id = request.params.id;
    if (!isGuid(id)) return { status: 400, jsonBody: { error: "id must be a GUID" } };
    let body: Record<string, unknown> = {};
    try { body = ((await request.json()) ?? {}) as Record<string, unknown>; } catch { /* empty body is fine */ }
    if (body.notes !== undefined && body.notes !== null && (typeof body.notes !== "string" || body.notes.length > 1000)) {
      return { status: 400, jsonBody: { error: "notes must be a string of at most 1000 characters if provided" } };
    }
    try {
      const actor = actorFrom(auth.principal);
      const outcome = await performDetourAct(await getPool(), id, { act: "complete_re_review", notes: typeof body.notes === "string" ? body.notes : null }, actor);
      if (!outcome.ok) return refusalResponse(outcome.refusal);
      return { status: 200, jsonBody: { id, review_status: outcome.detour.review_status, reviewed_by: actor.kind === "person" ? actor.name : null } };
    } catch (err) { context.error("POST detour review-complete failed:", err); return { status: 500, jsonBody: { error: "Internal server error" } }; }
  },
});
