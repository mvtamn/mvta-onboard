// POST /missed-trips/validate - the compliance review action for a flagged
// missed trip. Missed Trips is an investigation tool, not a customer-alert
// feed: detection only saves a candidate to MonitoredMissedTrips
// (gtfsMissedTripsPoll.ts); a staff member investigates it and records the
// outcome here (confirmed - it really was a missed trip - or false_positive).
// Preparing a rider notice, if warranted, stays a separate action via the
// existing /suggested-alerts/prepare flow - this endpoint never touches
// SuggestedAlerts. Gated to Publisher/Admin plus the dedicated OCC.Compliance
// role, so a Compliance-only user can complete the review workflow.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, PUBLISH_ROLES } from "../lib/auth";
import { validateMissedTripValidation } from "../lib/validation";

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
    const validationStatus = body.validation_status as string;
    const notes = (body.notes as string | undefined) ?? null;
    const reasonCode = body.reason_code as string;
    const validatedBy = authResult.principal.userDetails ?? "onboard-console";

    try {
      const pool = await getPool();
      const tx = new sql.Transaction(pool);
      await tx.begin();
      try {
        const currentReq = new sql.Request(tx);
        currentReq.input("trip_id", sql.NVarChar, tripId);
        currentReq.input("service_date", sql.NVarChar, serviceDate);
        const current = await currentReq.query<{ validation_status: string }>(`
          SELECT validation_status
          FROM MonitoredMissedTrips WITH (UPDLOCK, HOLDLOCK)
          WHERE trip_id = @trip_id AND service_date = @service_date
        `);
        const previousStatus = current.recordset[0]?.validation_status;
        if (!previousStatus) {
          await tx.rollback();
          return { status: 404, jsonBody: { error: "Missed trip not found" } };
        }
        const writeReq = new sql.Request(tx);
        writeReq.input("trip_id", sql.NVarChar, tripId);
        writeReq.input("service_date", sql.NVarChar, serviceDate);
        writeReq.input("validation_status", sql.NVarChar, validationStatus);
        writeReq.input("validated_by", sql.NVarChar, validatedBy);
        writeReq.input("notes", sql.NVarChar, notes);
        writeReq.input("reason_code", sql.NVarChar(30), reasonCode);
        writeReq.input("previous_validation_status", sql.NVarChar, previousStatus);
        await writeReq.query(`
          UPDATE MonitoredMissedTrips
          SET validation_status = @validation_status,
              validated_by = @validated_by,
              validated_at = SYSUTCDATETIME(),
              notes = @notes,
              reason_code = @reason_code,
              data_quality_status = CASE
                WHEN @validation_status = 'confirmed' THEN 'source_verified'
                ELSE data_quality_status END
          WHERE trip_id = @trip_id AND service_date = @service_date;

          INSERT INTO MissedTripReviewHistory (
            trip_id, service_date, previous_validation_status, validation_status,
            reason_code, notes, reviewed_by
          )
          VALUES (
            @trip_id, @service_date, @previous_validation_status, @validation_status,
            @reason_code, @notes, @validated_by
          );
        `);
        await tx.commit();
      } catch (err) {
        try {
          await tx.rollback();
        } catch {
          /* transaction already completed */
        }
        throw err;
      }
      return {
        status: 200,
        jsonBody: { trip_id: tripId, service_date: serviceDate, validation_status: validationStatus, reason_code: reasonCode },
      };
    } catch (err) {
      context.error("POST /missed-trips/validate failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
