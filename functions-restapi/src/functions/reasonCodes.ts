// Admin-editable reason codes for stop exclusions (OTP Review Queue), date
// exclusions (OTP Weather page), and - since migration 023 - Missed Trips'
// investigation-outcome dropdown (applies_to='missed_trip').
//
//   GET /reason-codes?applies_to=&active_only=  - compliance-review.view
//   POST /reason-codes                           - service-configuration.edit
//   PATCH /reason-codes/{id}                     - service-configuration.edit
//
// These answered on /otp-reason-codes until 1.5.303. The name was a holdover
// from when OTP was the only consumer; three modules read them now. The old
// routes are still registered at the bottom of this file so a console loaded
// before the rename keeps working, and they come out one release later.
//
// The TABLE is still OtpReasonCodes. Four reporting views join it (migrations
// 106, 135, 137) and those feed Power BI, so renaming it means recreating
// them - not worth doing while the OTP figures are being validated, and worth
// nothing to anyone outside this repo.
import { app, type HttpHandler, type HttpRequest, type InvocationContext } from "@azure/functions";
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

const listHandler = async (request: HttpRequest, context: InvocationContext) => {
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
      context.error("GET /reason-codes failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  };


const createHandler = async (request: HttpRequest, context: InvocationContext) => {
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
      context.error("POST /reason-codes failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  };


const updateHandler = async (request: HttpRequest, context: InvocationContext) => {
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
      context.error("PATCH /reason-codes/{id} failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  };

// The route each one answers on, new name first. "otp-reason-codes" is kept
// so a console loaded before 1.5.303 keeps working rather than silently
// showing an empty reason dropdown - both pages swallow a failed fetch as
// "graceful", so a 404 here would read as "nobody has configured any".
//
// REMOVE THE LEGACY ROUTES ONE RELEASE AFTER THIS ONE. They are three
// registrations and a one-line PR.
const ROUTES: { name: string; route: string; methods: ("GET" | "POST" | "PATCH")[]; handler: HttpHandler }[] = [
  { name: "reasonCodesList", route: "reason-codes", methods: ["GET"], handler: listHandler },
  { name: "reasonCodesCreate", route: "reason-codes", methods: ["POST"], handler: createHandler },
  { name: "reasonCodesUpdate", route: "reason-codes/{id}", methods: ["PATCH"], handler: updateHandler },
  { name: "otpReasonCodesList", route: "otp-reason-codes", methods: ["GET"], handler: listHandler },
  { name: "otpReasonCodesCreate", route: "otp-reason-codes", methods: ["POST"], handler: createHandler },
  { name: "otpReasonCodesUpdate", route: "otp-reason-codes/{id}", methods: ["PATCH"], handler: updateHandler },
];

for (const { name, route, methods, handler } of ROUTES) {
  app.http(name, { route, methods, authLevel: "anonymous", handler });
}
