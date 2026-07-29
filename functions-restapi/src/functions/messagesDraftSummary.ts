// POST /messages/draft-summary - optional Compose action that turns a staff
// member's internal incident/delay report into a rider-friendly draft via
// Claude (lib/anthropic.ts). Never persists or publishes anything itself -
// the result is just returned for staff to review and edit before posting
// through the normal POST /messages flow. Gated the same as message
// creation, since it's part of the same write workflow and spends API calls.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { requireRole, PUBLISH_ROLES } from "../lib/auth";
import { validateDraftSummary } from "../lib/validation";
import { draftRiderSummary, AnthropicNotConfiguredError } from "../lib/anthropic";

app.http("messagesDraftSummary", {
  route: "messages/draft-summary",
  methods: ["POST"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, PUBLISH_ROLES);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
    }

    const errors = validateDraftSummary(body);
    if (errors.length > 0) {
      return { status: 400, jsonBody: { error: "Validation failed", details: errors } };
    }

    try {
      const summary = await draftRiderSummary(
        body.raw_text as string,
        body.category as string,
        body.severity as string,
      );
      return { status: 200, jsonBody: { summary } };
    } catch (err) {
      if (err instanceof AnthropicNotConfiguredError) {
        return {
          status: 503,
          jsonBody: { error: "AI drafting is not configured yet. Write the rider-facing summary by hand." },
        };
      }
      context.error("POST /messages/draft-summary failed:", err);
      return { status: 502, jsonBody: { error: "The AI drafting service could not be reached. Try again or write it by hand." } };
    }
  },
});
