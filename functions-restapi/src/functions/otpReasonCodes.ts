// Admin-editable reason codes for stop exclusions (OTP Review Queue), date
// exclusions (OTP Weather page), and - since migration 023 - Missed Trips'
// investigation-outcome dropdown (applies_to='missed_trip').
//
// The name is a holdover from when this served OTP alone. It is wrong for a
// table three modules read, and renaming it means a migration, a route, the
// console and three consumers - deliberately not bundled into this change.
//
//   GET /otp-reason-codes?applies_to=&active_only=  - compliance-review.view
//   POST /otp-reason-codes                           - service-configuration.edit
//   PATCH /otp-reason-codes/{id}                     - service-configuration.edit
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { requireAccess } from "../lib/access/require";
import { validateCreateReasonCode, validateUpdateReasonCode, isGuid } from "../lib/validation";
import {
  createReasonCode,
  listReasonCodes,
  updateReasonCode,
  DuplicateReasonCode,
  type CreateReasonCode,
  type UpdateReasonCode,
} from "../lib/reasonCodes";

app.http("otpReasonCodesList", {
  route: "otp-reason-codes",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = await requireAccess(request, "compliance-review.view");
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }
    try {
      const pool = await getPool();
      const reason_codes = await listReasonCodes(pool, "otp", {
        appliesTo: request.query.get("applies_to"),
        activeOnly: request.query.get("active_only") === "true",
      });
      return { status: 200, jsonBody: { reason_codes } };
    } catch (err) {
      context.error("GET /otp-reason-codes failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("otpReasonCodesCreate", {
  route: "otp-reason-codes",
  methods: ["POST"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = await requireAccess(request, "service-configuration.edit");
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
    }
    const errors = validateCreateReasonCode(raw as Record<string, unknown>, "otp");
    if (errors.length > 0) {
      return { status: 400, jsonBody: { error: "Validation failed", details: errors } };
    }

    try {
      const pool = await getPool();
      const created = await createReasonCode(
        pool,
        "otp",
        raw as CreateReasonCode,
        authResult.principal.userDetails || "system",
      );
      return { status: 201, jsonBody: created };
    } catch (err) {
      if (err instanceof DuplicateReasonCode) {
        return { status: 409, jsonBody: { error: err.message } };
      }
      context.error("POST /otp-reason-codes failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("otpReasonCodesUpdate", {
  route: "otp-reason-codes/{id}",
  methods: ["PATCH"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = await requireAccess(request, "service-configuration.edit");
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }

    const id = request.params.id;
    if (!isGuid(id)) {
      return { status: 400, jsonBody: { error: "id must be a GUID" } };
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
    }
    const errors = validateUpdateReasonCode(raw as Record<string, unknown>);
    if (errors.length > 0) {
      return { status: 400, jsonBody: { error: "Validation failed", details: errors } };
    }

    try {
      const pool = await getPool();
      const updated = await updateReasonCode(
        pool,
        "otp",
        id,
        raw as UpdateReasonCode,
        authResult.principal.userDetails || "system",
      );
      if (!updated) return { status: 404, jsonBody: { error: "Reason code not found" } };
      return { status: 200, jsonBody: updated };
    } catch (err) {
      context.error("PATCH /otp-reason-codes/{id} failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
