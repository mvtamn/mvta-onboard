// Dedicated Spare connectivity receiver. It verifies the configured shared
// secret and event allowlist but intentionally does not retain a payload yet:
// #93 still requires sanitized contract samples before #95 maps state.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { hasSpareWebhookAuthorization, spareWebhookEventType, spareWebhookSchema } from "../lib/spareWebhookPolicy";

app.http("onDemandSpareWebhook", {
  route: "on-demand-webhooks/spare",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const secret = process.env.SPARE_WEBHOOK_AUTH_SECRET?.trim();
    if (!secret) return { status: 503, jsonBody: { error: "Spare webhook receiver is not configured" } };
    if (!hasSpareWebhookAuthorization(request.headers.get("authorization"), secret)) {
      return { status: 401, jsonBody: { error: "Unauthorized" } };
    }
    let payload: unknown;
    try { payload = await request.json(); } catch {
      return { status: 400, jsonBody: { error: "Webhook payload must be valid JSON" } };
    }
    const eventType = spareWebhookEventType(payload);
    if (!eventType) return { status: 422, jsonBody: { error: "Webhook event type is not supported" } };

    const schema = spareWebhookSchema(payload);
    // Deliberately log schema names only: webhook values may contain rider or
    // location data. This temporary diagnostic closes the source-contract gap.
    context.log(JSON.stringify({ event: "spare_webhook_contract", type: eventType, ...schema }));
    return { status: 202, jsonBody: { status: "accepted" } };
  },
});
