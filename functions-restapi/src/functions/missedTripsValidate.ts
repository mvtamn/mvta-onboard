// POST /missed-trips/validate - the compliance review action for a flagged
// missed trip. Missed Trips is an investigation tool, not a customer-alert
// feed: detection only saves a candidate to MonitoredMissedTrips
// (gtfsMissedTripsPoll.ts); a staff member investigates it and records the
// outcome here: Confirmed missed trip, Timely service, Partial-service failure
// or Indeterminate (older callers' `false_positive` is Timely service). A second
// review of the same case supersedes the first and needs `supersede_reason`; a
// legacy record needs `rereview_reason`.
// Preparing a rider notice, if warranted, stays a separate action via the
// existing /suggested-alerts/prepare flow - this endpoint never touches
// SuggestedAlerts. Gated to compliance-review.review, the action a
// Compliance reviewer holds to complete the review workflow.
//
// The review is an act on the case through the Missed-trip case module, which
// records it and its history and, in the same transaction, hands a confirmed
// trip from a promoted detector to that service month's performance
// assessment. The review records the outcome only: the occurrence it raises
// stays an `undetermined` candidate, which counts for nothing, until a manager
// records Service attribution (PUT /compliance-occurrences/{id}/attribution,
// compliance-review.attribute) - and excusable is the COO's alone
// (compliance-review.excuse). MVTA, 2026-11-06; plan step 0.8; ADR 0048.
// See lib/occurrenceIntake (REVIEW_HANDOFF_EXPLANATIONS) for why the link never fails the review.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { requireAccess } from "../lib/access/require";
import { validateMissedTripValidation } from "../lib/validation";
import { actOnMissedTripCase, handOffExplanation, type CaseAct, type StoredReviewOutcome } from "../lib/missedTripCase";

app.http("missedTripsValidate", {
  route: "missed-trips/validate",
  methods: ["POST"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = await requireAccess(request, "compliance-review.review");
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
    }

    const errors = validateMissedTripValidation(body);
    if (errors.length > 0) {
      return { status: 400, jsonBody: { error: "Validation failed", details: errors } };
    }

    const tripId = body.trip_id as string;
    const serviceDate = body.service_date as string;
    const requested = body.validation_status as string;
    const outcome = (requested === "false_positive" ? "timely_service" : requested) as StoredReviewOutcome;
    const reasonCode = body.reason_code as string;
    const fields = {
      outcome,
      reasonCode,
      notes: (body.notes as string | undefined) ?? null,
    };
    const act: CaseAct = typeof body.supersede_reason === "string"
      ? { act: "supersede_review", reason: body.supersede_reason, ...fields }
      : typeof body.rereview_reason === "string"
        ? { act: "rereview_legacy", reason: body.rereview_reason, ...fields }
        : { act: "record_review", ...fields };
    try {
      const result = await actOnMissedTripCase(await getPool(), { tripId, serviceDate }, act, {
        kind: "person", name: authResult.principal.userDetails ?? "onboard-console",
      });
      if (!result.ok) {
        return {
          status: result.refusal.code === "not_found" ? 404 : 409,
          jsonBody: { error: result.refusal.sentence, code: result.refusal.code },
        };
      }
      const handOff = result.handOff;
      return {
        status: 200,
        jsonBody: {
          trip_id: tripId, service_date: serviceDate, validation_status: outcome, reason_code: reasonCode,
          classification: result.classification,
          assessment: handOff.linked ? handOff : { ...handOff, explanation: handOffExplanation(handOff) },
        },
      };
    } catch (err) {
      context.error("POST /missed-trips/validate failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
