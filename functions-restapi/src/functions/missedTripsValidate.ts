// POST /missed-trips/validate - the compliance review action for a flagged
// missed trip. Missed Trips is an investigation tool, not a customer-alert
// feed: detection only saves a candidate to MonitoredMissedTrips
// (gtfsMissedTripsPoll.ts); a staff member investigates it and records the
// outcome here (confirmed - it really was a missed trip - or false_positive).
// Preparing a rider notice, if warranted, stays a separate action via the
// existing /suggested-alerts/prepare flow - this endpoint never touches
// SuggestedAlerts. Gated to Publisher/Admin plus the dedicated OCC.Compliance
// role, so a Compliance-only user can complete the review workflow.
//
// The review is an act on the case through the Missed-trip case module, which
// records it and its history and, in the same transaction, hands a confirmed
// trip from a promoted detector to that service month's performance
// assessment. The reviewer's `attribution` answers
// the second question Attachment G needs - was this the contractor's error, an
// excusable delay, or MVTA-directed - so one sitting settles both, instead of
// the old path where the candidate poll raised an `undetermined` row minutes
// later and someone re-reviewed it in a different module. See
// lib/assessment/occurrenceIntake.ts for why the link never fails the review.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { requireRole, PUBLISH_ROLES } from "../lib/auth";
import { validateMissedTripValidation } from "../lib/validation";
import type { OccurrenceAttribution } from "../lib/assessment/occurrenceIntake";
import { actOnMissedTripCase, handOffExplanation } from "../lib/missedTripCase";

app.http("missedTripsValidate", {
  route: "missed-trips/validate",
  methods: ["POST"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, [...PUBLISH_ROLES, "OCC.Compliance"]);
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
    const validationStatus = body.validation_status as "confirmed" | "false_positive";
    const reasonCode = body.reason_code as string;
    try {
      const outcome = await actOnMissedTripCase(await getPool(), { tripId, serviceDate }, {
        act: "record_review",
        outcome: validationStatus,
        reasonCode,
        notes: (body.notes as string | undefined) ?? null,
        attribution: (body.attribution as OccurrenceAttribution | undefined) ?? "undetermined",
      }, { kind: "person", name: authResult.principal.userDetails ?? "onboard-console" });
      if (!outcome.ok) return { status: 404, jsonBody: { error: "Missed trip not found" } };
      const handOff = outcome.handOff;
      return {
        status: 200,
        jsonBody: {
          trip_id: tripId, service_date: serviceDate, validation_status: validationStatus, reason_code: reasonCode,
          classification: outcome.classification,
          assessment: !handOff || handOff.linked ? handOff : { ...handOff, explanation: handOffExplanation(handOff) },
        },
      };
    } catch (err) {
      context.error("POST /missed-trips/validate failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
