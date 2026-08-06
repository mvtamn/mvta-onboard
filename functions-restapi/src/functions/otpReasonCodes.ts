// Admin-editable reason codes for stop exclusions (OTP Review Queue), date
// exclusions (OTP Weather page), and - since migration-023 - Missed Trips'
// investigation-outcome dropdown (applies_to='missed_trip'). Name is a
// holdover from when this only served OTP; kept as-is rather than renaming
// the table/route for a third, unrelated consumer.
//
//   GET /otp-reason-codes?applies_to=&active_only=  - any staff role, plus OCC.Compliance
//   POST /otp-reason-codes                           - OCC.Admin only
//   PATCH /otp-reason-codes/{id}                     - OCC.Admin only
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, STAFF_READ_ROLES, ADMIN_ROLES } from "../lib/auth";
import { validateCreateReasonCode, validateUpdateReasonCode, isGuid } from "../lib/validation";

interface ReasonCodeRow {
  id: string;
  code: string;
  label: string;
  applies_to: "stop" | "date" | "missed_trip";
  is_active: boolean;
  sort_order: number;
  updated_by: string | null;
  updated_at: Date;
}

app.http("otpReasonCodesList", {
  route: "otp-reason-codes",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, [...STAFF_READ_ROLES, "OCC.Compliance"]);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }

    const appliesTo = request.query.get("applies_to");
    const activeOnly = request.query.get("active_only") === "true";

    try {
      const pool = await getPool();
      const req = pool.request();
      const conditions: string[] = [];
      if (appliesTo === "stop" || appliesTo === "date" || appliesTo === "missed_trip") {
        req.input("applies_to", sql.NVarChar(20), appliesTo);
        conditions.push("applies_to = @applies_to");
      }
      if (activeOnly) conditions.push("is_active = 1");
      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const result = await req.query<ReasonCodeRow>(`
        SELECT id, code, label, applies_to, is_active, sort_order, updated_by, updated_at
        FROM OtpReasonCodes
        ${where}
        ORDER BY applies_to, sort_order
      `);
      return { status: 200, jsonBody: { reason_codes: result.recordset } };
    } catch (err) {
      context.error("GET /otp-reason-codes failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("otpReasonCodesCreate", {
  route: "otp-reason-codes",
  methods: ["POST"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, ADMIN_ROLES);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
    }
    const errors = validateCreateReasonCode(raw as Record<string, unknown>);
    if (errors.length > 0) {
      return { status: 400, jsonBody: { error: "Validation failed", details: errors } };
    }
    const body = raw as { code: string; label: string; applies_to: "stop" | "date" | "missed_trip" };

    try {
      const pool = await getPool();
      const sqlRequest = pool.request();
      sqlRequest.input("code", sql.NVarChar, body.code);
      sqlRequest.input("label", sql.NVarChar, body.label);
      sqlRequest.input("applies_to", sql.NVarChar(20), body.applies_to);
      sqlRequest.input("updated_by", sql.NVarChar, authResult.principal.userDetails || "system");

      const result = await sqlRequest.query<ReasonCodeRow>(`
        INSERT INTO OtpReasonCodes (code, label, applies_to, updated_by)
        OUTPUT INSERTED.id, INSERTED.code, INSERTED.label, INSERTED.applies_to,
               INSERTED.is_active, INSERTED.sort_order, INSERTED.updated_by, INSERTED.updated_at
        VALUES (@code, @label, @applies_to, @updated_by)
      `);
      return { status: 201, jsonBody: result.recordset[0] };
    } catch (err) {
      context.error("POST /otp-reason-codes failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("otpReasonCodesUpdate", {
  route: "otp-reason-codes/{id}",
  methods: ["PATCH"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, ADMIN_ROLES);
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
    const body = raw as { label?: string; is_active?: boolean; sort_order?: number };

    try {
      const pool = await getPool();
      const sqlRequest = pool.request();
      sqlRequest.input("id", sql.UniqueIdentifier, id);
      sqlRequest.input("updated_by", sql.NVarChar, authResult.principal.userDetails || "system");

      const sets: string[] = ["updated_by = @updated_by", "updated_at = SYSUTCDATETIME()"];
      if (body.label !== undefined) {
        sets.push("label = @label");
        sqlRequest.input("label", sql.NVarChar, body.label);
      }
      if (body.is_active !== undefined) {
        sets.push("is_active = @is_active");
        sqlRequest.input("is_active", sql.Bit, body.is_active);
      }
      if (body.sort_order !== undefined) {
        sets.push("sort_order = @sort_order");
        sqlRequest.input("sort_order", sql.Int, body.sort_order);
      }

      const result = await sqlRequest.query<ReasonCodeRow>(`
        UPDATE OtpReasonCodes
        SET ${sets.join(", ")}
        OUTPUT INSERTED.id, INSERTED.code, INSERTED.label, INSERTED.applies_to,
               INSERTED.is_active, INSERTED.sort_order, INSERTED.updated_by, INSERTED.updated_at
        WHERE id = @id
      `);

      if (result.recordset.length === 0) {
        return { status: 404, jsonBody: { error: "Reason code not found" } };
      }
      return { status: 200, jsonBody: result.recordset[0] };
    } catch (err) {
      context.error("PATCH /otp-reason-codes/{id} failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
