// Route Classification - the one place MVTA OnBoard itself decides whether
// a bare Avail RouteID is a fixed route, a special event, or on-demand
// service, since no Avail feed carries that distinction itself. Backs the
// Admin page's classification editor and the event-bus filtering added to
// availAvlPoll.ts (Part A2). See detour-and-event-module-implementation-
// plan.md (Part A1).
//
//   GET /route-classification            - any staff role, plus OCC.Compliance
//   PUT /route-classification/{routeId}  - Publisher/Admin (upsert one row)
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, STAFF_READ_ROLES, PUBLISH_ROLES } from "../lib/auth";
import { validateRouteClassification } from "../lib/validation";

interface RouteClassificationRow {
  route_id: number;
  route_category: string;
  route_label: string | null;
  effective_start_date: string | null;
  effective_end_date: string | null;
  is_active: boolean;
  updated_by: string | null;
  updated_at: Date;
}

function toYyyymmdd(isoDate: string | null | undefined): string | null {
  if (!isoDate) return null;
  return isoDate.replace(/-/g, "");
}

function toIsoDate(yyyymmdd: string | null): string | null {
  if (!yyyymmdd) return null;
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

app.http("routeClassificationList", {
  route: "route-classification",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, [...STAFF_READ_ROLES, "OCC.Compliance"]);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }

    try {
      const pool = await getPool();
      const result = await pool.request().query<RouteClassificationRow>(`
        SELECT route_id, route_category, route_label, effective_start_date, effective_end_date,
               is_active, updated_by, updated_at
        FROM RouteClassification
        ORDER BY route_id
      `);
      const rows = result.recordset.map((r) => ({
        ...r,
        effective_start_date: toIsoDate(r.effective_start_date),
        effective_end_date: toIsoDate(r.effective_end_date),
      }));
      return { status: 200, jsonBody: { routes: rows } };
    } catch (err) {
      context.error("GET /route-classification failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("routeClassificationUpsert", {
  route: "route-classification/{routeId}",
  methods: ["PUT"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, PUBLISH_ROLES);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }

    const routeId = Number(request.params.routeId);
    if (!Number.isInteger(routeId)) {
      return { status: 400, jsonBody: { error: "routeId must be an integer" } };
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
    }
    const errors = validateRouteClassification(raw as Record<string, unknown>);
    if (errors.length > 0) {
      return { status: 400, jsonBody: { error: "Validation failed", details: errors } };
    }
    const body = raw as {
      route_category: "FixedRoute" | "SpecialEvent" | "OnDemand";
      route_label?: string | null;
      effective_start_date?: string | null;
      effective_end_date?: string | null;
      is_active?: boolean;
    };

    try {
      const pool = await getPool();
      const sqlRequest = pool.request();
      sqlRequest.input("route_id", sql.Int, routeId);
      sqlRequest.input("route_category", sql.NVarChar, body.route_category);
      sqlRequest.input("route_label", sql.NVarChar, body.route_label ?? null);
      sqlRequest.input("effective_start_date", sql.Char(8), toYyyymmdd(body.effective_start_date));
      sqlRequest.input("effective_end_date", sql.Char(8), toYyyymmdd(body.effective_end_date));
      sqlRequest.input("is_active", sql.Bit, body.is_active ?? true);
      sqlRequest.input("updated_by", sql.NVarChar, authResult.principal.userDetails || "system");

      const result = await sqlRequest.query<RouteClassificationRow>(`
        MERGE RouteClassification WITH (HOLDLOCK) AS target
        USING (SELECT @route_id AS route_id) AS src
        ON target.route_id = src.route_id
        WHEN MATCHED THEN
          UPDATE SET
            route_category = @route_category, route_label = @route_label,
            effective_start_date = @effective_start_date, effective_end_date = @effective_end_date,
            is_active = @is_active, updated_by = @updated_by, updated_at = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN
          INSERT (route_id, route_category, route_label, effective_start_date, effective_end_date, is_active, updated_by)
          VALUES (@route_id, @route_category, @route_label, @effective_start_date, @effective_end_date, @is_active, @updated_by)
        OUTPUT INSERTED.route_id, INSERTED.route_category, INSERTED.route_label,
               INSERTED.effective_start_date, INSERTED.effective_end_date, INSERTED.is_active,
               INSERTED.updated_by, INSERTED.updated_at;
      `);

      const row = result.recordset[0];
      return {
        status: 200,
        jsonBody: {
          ...row,
          effective_start_date: toIsoDate(row.effective_start_date),
          effective_end_date: toIsoDate(row.effective_end_date),
        },
      };
    } catch (err) {
      context.error("PUT /route-classification/{routeId} failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
