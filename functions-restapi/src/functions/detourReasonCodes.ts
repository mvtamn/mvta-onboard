// Admin-editable reason categories for the Detour & Closure module.
//
//   GET   /detour-reason-codes?active_only=  - detours.view
//   POST  /detour-reason-codes               - service-configuration.edit
//   PATCH /detour-reason-codes/{id}          - service-configuration.edit
//
// Read is detours.view so the same people who can see a detour can resolve
// its reason_code to a label. Writes are service-configuration.edit: this is a
// controlled vocabulary, not day-to-day detour entry.
//
// The rules themselves live in lib/reasonCodes, which this shares with the
// OTP scope; the only difference between the two tables is that one carries
// an applies_to sub-kind and this does not.
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

app.http("detourReasonCodesList", {
  route: "detour-reason-codes",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = await requireAccess(request, "detours.view");
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }
    try {
      const pool = await getPool();
      // An absent table yields an empty list, not a 500: before migration 025
      // the console should show no reason-code dropdown rather than an error
      // banner on a page that otherwise works.
      const reason_codes = await listReasonCodes(pool, "detour", {
        activeOnly: request.query.get("active_only") === "true",
      });
      return { status: 200, jsonBody: { reason_codes } };
    } catch (err) {
      context.error("GET /detour-reason-codes failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("detourReasonCodesCreate", {
  route: "detour-reason-codes",
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
    const errors = validateCreateReasonCode(raw as Record<string, unknown>, "detour");
    if (errors.length > 0) {
      return { status: 400, jsonBody: { error: "Validation failed", details: errors } };
    }

    try {
      const pool = await getPool();
      const created = await createReasonCode(
        pool,
        "detour",
        raw as CreateReasonCode,
        authResult.principal.userDetails || "system",
      );
      return { status: 201, jsonBody: created };
    } catch (err) {
      if (err instanceof DuplicateReasonCode) {
        return { status: 409, jsonBody: { error: err.message } };
      }
      context.error("POST /detour-reason-codes failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("detourReasonCodesUpdate", {
  route: "detour-reason-codes/{id}",
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
      // `code` stays immutable: Detours.reason_code is a soft, non-FK
      // reference to it, so renaming one would silently orphan every
      // historical detour citing it. Retire with is_active = false instead.
      const updated = await updateReasonCode(
        pool,
        "detour",
        id,
        raw as UpdateReasonCode,
        authResult.principal.userDetails || "system",
      );
      if (!updated) return { status: 404, jsonBody: { error: "Reason code not found" } };
      return { status: 200, jsonBody: updated };
    } catch (err) {
      context.error("PATCH /detour-reason-codes/{id} failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
