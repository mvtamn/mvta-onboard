// Admin-editable reason categories for the Detour & Closure module -
// Part B6 of detour-module-consolidated-plan.md. Mirrors otpReasonCodes.ts,
// minus `applies_to`: this table only ever serves one consumer.
//
//   GET   /detour-reason-codes?active_only=  - any detour-reading role
//   POST  /detour-reason-codes               - OCC.Admin only
//   PATCH /detour-reason-codes/{id}          - OCC.Admin only
//
// Read is gated on DETOUR_READ_ROLES rather than STAFF_READ_ROLES so the
// same people who can see a detour can resolve its reason_code to a label -
// including OCC.Compliance and OCC.Detour, neither of which is in
// STAFF_READ_ROLES. Writes stay admin-only: this is a controlled vocabulary,
// not day-to-day detour entry.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, DETOUR_READ_ROLES, ADMIN_ROLES } from "../lib/auth";
import {
  validateCreateDetourReasonCode,
  validateUpdateDetourReasonCode,
  isGuid,
} from "../lib/validation";

interface DetourReasonCodeRow {
  id: string;
  code: string;
  label: string;
  is_active: boolean;
  sort_order: number;
  updated_by: string | null;
  updated_at: Date;
}

const SELECT_COLUMNS = "id, code, label, is_active, sort_order, updated_by, updated_at";
const OUTPUT_COLUMNS = [
  "INSERTED.id", "INSERTED.code", "INSERTED.label", "INSERTED.is_active",
  "INSERTED.sort_order", "INSERTED.updated_by", "INSERTED.updated_at",
].join(", ");

app.http("detourReasonCodesList", {
  route: "detour-reason-codes",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, DETOUR_READ_ROLES);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }

    const activeOnly = request.query.get("active_only") === "true";

    try {
      const pool = await getPool();

      // Degrades to an empty list until migration-025 has run, rather than
      // 500ing - same un-run-migration guard detoursList.ts uses for
      // internal_number. The console then shows no reason-code dropdown
      // instead of an error banner on a page that otherwise works.
      const tableCheck = await pool.request().query<{ has_table: number }>(`
        SELECT CASE WHEN OBJECT_ID('dbo.DetourReasonCodes', 'U') IS NULL
               THEN 0 ELSE 1 END AS has_table
      `);
      if (tableCheck.recordset[0]?.has_table !== 1) {
        context.warn("DetourReasonCodes not present (migration-025 not run) - returning an empty list.");
        return { status: 200, jsonBody: { reason_codes: [] } };
      }

      const result = await pool.request().query<DetourReasonCodeRow>(`
        SELECT ${SELECT_COLUMNS}
        FROM DetourReasonCodes
        ${activeOnly ? "WHERE is_active = 1" : ""}
        ORDER BY sort_order, label
      `);
      return { status: 200, jsonBody: { reason_codes: result.recordset } };
    } catch (err) {
      context.error("GET /detour-reason-codes failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("detourReasonCodesCreate", {
  route: "detour-reason-codes",
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
    const errors = validateCreateDetourReasonCode(raw as Record<string, unknown>);
    if (errors.length > 0) {
      return { status: 400, jsonBody: { error: "Validation failed", details: errors } };
    }
    const body = raw as { code: string; label: string; sort_order?: number };

    try {
      const pool = await getPool();
      const req = pool.request();
      req.input("code", sql.NVarChar(30), body.code);
      req.input("label", sql.NVarChar(100), body.label);
      req.input("sort_order", sql.Int, body.sort_order ?? 0);
      req.input("updated_by", sql.NVarChar, authResult.principal.userDetails || "system");

      const result = await req.query<DetourReasonCodeRow>(`
        INSERT INTO DetourReasonCodes (code, label, sort_order, updated_by)
        OUTPUT ${OUTPUT_COLUMNS}
        VALUES (@code, @label, @sort_order, @updated_by)
      `);
      return { status: 201, jsonBody: result.recordset[0] };
    } catch (err) {
      // UX_DetourReasonCodes_Code - a duplicate code is a user error, not a
      // server fault, so it gets a 409 rather than the generic 500 below.
      if (err instanceof Error && /UX_DetourReasonCodes_Code/.test(err.message)) {
        return { status: 409, jsonBody: { error: "That reason code already exists" } };
      }
      context.error("POST /detour-reason-codes failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("detourReasonCodesUpdate", {
  route: "detour-reason-codes/{id}",
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
    const errors = validateUpdateDetourReasonCode(raw as Record<string, unknown>);
    if (errors.length > 0) {
      return { status: 400, jsonBody: { error: "Validation failed", details: errors } };
    }
    const body = raw as { label?: string; is_active?: boolean; sort_order?: number };

    try {
      const pool = await getPool();
      const req = pool.request();
      req.input("id", sql.UniqueIdentifier, id);
      req.input("updated_by", sql.NVarChar, authResult.principal.userDetails || "system");

      const sets: string[] = ["updated_by = @updated_by", "updated_at = SYSUTCDATETIME()"];
      if (body.label !== undefined) {
        sets.push("label = @label");
        req.input("label", sql.NVarChar(100), body.label);
      }
      if (body.is_active !== undefined) {
        sets.push("is_active = @is_active");
        req.input("is_active", sql.Bit, body.is_active);
      }
      if (body.sort_order !== undefined) {
        sets.push("sort_order = @sort_order");
        req.input("sort_order", sql.Int, body.sort_order);
      }

      const result = await req.query<DetourReasonCodeRow>(`
        UPDATE DetourReasonCodes
        SET ${sets.join(", ")}
        OUTPUT ${OUTPUT_COLUMNS}
        WHERE id = @id
      `);

      if (result.recordset.length === 0) {
        return { status: 404, jsonBody: { error: "Reason code not found" } };
      }
      return { status: 200, jsonBody: result.recordset[0] };
    } catch (err) {
      context.error("PATCH /detour-reason-codes/{id} failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
