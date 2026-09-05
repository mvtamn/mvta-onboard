// Dedicated Spare connectivity receiver. It verifies the configured shared
// secret and event allowlist but intentionally does not retain a payload yet:
// #93 still requires sanitized contract samples before #95 maps state.
//
// Every database touch goes through an intake gate (lib/spareWebhookIntake):
// bounded in-flight work, a time budget per delivery, and a cool-down after a
// failure. Beyond the bound or during the cool-down the delivery is refused
// with 503 at once, which is the answer Spare retries, instead of queueing on
// a pool this receiver once drained for every other function in the app.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { hasSpareWebhookAuthorization, spareWebhookEventType, spareWebhookSchema } from "../lib/spareWebhookPolicy";
import { normalizeOnDemandSpareRequest, normalizeSpareDutyMatchingStatus, normalizeSpareEtaUpdates, normalizeSpareVehicleLocation } from "../lib/onDemandSpareMonitor";
import { loadActiveOperationalZonesCached, storeOnDemandSpareRequest, storeSpareDutyMatching, storeSpareDutyVehicle } from "../lib/onDemandSpareMonitorStore";
import { fetchSpareRequest, type SpareRequestRecord } from "../lib/spareApi";
import { ContractSchemaLog, IntakeGate, VehicleWriteCoalescer } from "../lib/spareWebhookIntake";

// Four of the pool's ten connections at most; the pollers behind the KPI
// feeds need the rest. Eight seconds is generous for one MERGE on a healthy
// pool and short enough that a wedged one is noticed within a delivery or
// two. Fifteen seconds of refusal is enough for the pool to drain.
const gate = new IntakeGate({ maxInFlight: 4, budgetMs: 8_000, cooldownMs: 15_000 });
// A duty's vehicle is re-recorded at most once a minute unless it changes.
const vehicleWrites = new VehicleWriteCoalescer(60_000);
const contractLog = new ContractSchemaLog();

const UNAVAILABLE = {
  status: 503,
  headers: { "Retry-After": "15" },
  jsonBody: { error: "On-demand monitor is temporarily unavailable" },
};

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

    // Deliberately log schema names only: webhook values may contain rider or
    // location data. This temporary diagnostic closes the source-contract gap,
    // and a field set it has already reported teaches nothing new.
    const schema = spareWebhookSchema(payload);
    if (contractLog.isNew(eventType, schema)) {
      context.log(JSON.stringify({ event: "spare_webhook_contract", type: eventType, ...schema }));
    }

    const data = (payload as { data?: unknown }).data;

    // Decide, before touching the gate, whether this delivery has anything to
    // write. Most vehicle locations do not.
    if (eventType === "vehicleLocation") {
      const update = normalizeSpareVehicleLocation(data);
      if (!update) return { status: 202, jsonBody: { status: "accepted" } };
      if (!vehicleWrites.shouldWrite(update.dutyId, update.vehicleId)) {
        return { status: 202, jsonBody: { status: "accepted", coalesced: true } };
      }
      return respond(await gate.run(() => storeSpareDutyVehicle(update)), context, eventType);
    }

    if (eventType === "dutyMatchingStatus") {
      const update = normalizeSpareDutyMatchingStatus(data);
      if (!update) return { status: 202, jsonBody: { status: "accepted" } };
      return respond(await gate.run(() => storeSpareDutyMatching(update)), context, eventType);
    }

    if (eventType === "requestStatus") {
      const normalized = normalizeOnDemandSpareRequest((data ?? {}) as SpareRequestRecord);
      if (!normalized) return { status: 202, jsonBody: { status: "accepted" } };
      return respond(await gate.run(async () => {
        await storeOnDemandSpareRequest(normalized, await loadActiveOperationalZonesCached());
      }), context, eventType);
    }

    // ETA payloads do not contain a source ordering timestamp. Re-read the
    // authoritative request before updating monitor state so retries cannot
    // reverse a newer Request Status or a confirmed pickup. The outbound read
    // sits inside the gate too: it is what the delivery costs.
    const updates = normalizeSpareEtaUpdates(data);
    if (updates.length === 0) return { status: 202, jsonBody: { status: "accepted" } };
    return respond(await gate.run(async () => {
      const activeZones = await loadActiveOperationalZonesCached();
      for (const update of updates) {
        const record = await fetchSpareRequest<SpareRequestRecord>(update.requestId);
        const normalized = normalizeOnDemandSpareRequest(record);
        if (normalized) await storeOnDemandSpareRequest(normalized, activeZones);
      }
    }), context, eventType);
  },
});

function respond(
  outcome: Awaited<ReturnType<IntakeGate["run"]>>,
  context: InvocationContext,
  eventType: string,
) {
  if (outcome.kind === "done") return { status: 202, jsonBody: { status: "accepted" } };
  if (outcome.kind === "shed") {
    // Not an error: the receiver is protecting the app. Warn, and only for
    // the first refusal of a burst, so the log does not become the flood.
    if (outcome.reason === "in_flight" && !gate.state.coolingDown) {
      context.warn(`Spare webhook shed a ${eventType} delivery: ${gate.state.inFlight} already in flight.`);
    }
    return UNAVAILABLE;
  }
  if (outcome.reason === "timeout") {
    context.error(`Spare webhook ${eventType} delivery exceeded its time budget; refusing new deliveries for 15 s.`);
  } else {
    context.error("Spare webhook could not update the on-demand monitor", outcome.error);
  }
  return UNAVAILABLE;
}
