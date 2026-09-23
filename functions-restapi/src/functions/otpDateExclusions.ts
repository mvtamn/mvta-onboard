// Persisted weather/emergency date exclusions - replaces the Weather page's
// former ephemeral list. Agency-wide or route-specific, with the tracker's
// three staff-visible flags (notified/acknowledged/status) preserved from
// the original design.
//
//   GET /otp-date-exclusions              - compliance-review.view
//   POST /otp-date-exclusions             - compliance-review.review
//   POST /otp-date-exclusions/{id}/approve - compliance-review.review
//
// Approval is what makes a date subtract (ADR 0038). Until migration 140 there
// was no way to reach the 'Approved' state the measurement looks for at all:
// the table defaulted to 'Proposed', had no approved_by/approved_at, and the
// API offered no route to change it. Every weather day ever recorded sat in a
// state nothing read.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireAccess } from "../lib/access/require";
import { validateDateExclusion } from "../lib/validation";
import { refusalMessage, takeDateExclusionSnapshot } from "../lib/otpDateExclusionSnapshot";

interface DateExclusionRow {
  id: string;
  scope: "Agency" | "Route";
  route_id: number | null;
  service_date: string;
  reason_code: string;
  notes: string | null;
  status: "Proposed" | "Approved";
  notified: boolean;
  notified_at: Date | null;
  acknowledged: boolean;
  created_by: string;
  created_at: Date;
  approved_by?: string | null;
  approved_at?: Date | null;
  /** What this exclusion is actually subtracting from the month. */
  excluded_departures?: number;
}

app.http("otpDateExclusionsList", {
  route: "otp-date-exclusions",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = await requireAccess(request, "compliance-review.view");
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }
    try {
      const pool = await getPool();
      const tableCheck = await pool.request().query<{ table_exists: number; approved: number; snapshot: number }>(`
        SELECT CASE WHEN OBJECT_ID('dbo.OtpDateExclusions', 'U') IS NULL THEN 0 ELSE 1 END AS table_exists,
               CASE WHEN COL_LENGTH('dbo.OtpDateExclusions','approved_at') IS NULL THEN 0 ELSE 1 END AS approved,
               CASE WHEN OBJECT_ID('dbo.OtpDateExclusionDepartures','U') IS NULL THEN 0 ELSE 1 END AS snapshot
      `);
      if (tableCheck.recordset[0]?.table_exists !== 1) {
        return { status: 200, jsonBody: { exclusions: [] } };
      }
      // Migration 140 added approval and the snapshot. Before it, the columns
      // are absent and every row reads as unapproved and subtracting nothing,
      // which is exactly what it was.
      const hasApproval = tableCheck.recordset[0]?.approved === 1;
      const hasSnapshot = tableCheck.recordset[0]?.snapshot === 1;

      const result = await pool.request().query<DateExclusionRow>(`
        SELECT e.id, e.scope, e.route_id, e.service_date, e.reason_code, e.notes, e.status,
               e.notified, e.notified_at, e.acknowledged, e.created_by, e.created_at,
               ${hasApproval ? "e.approved_by, e.approved_at" : "CAST(NULL AS NVARCHAR(200)) approved_by, CAST(NULL AS DATETIME2) approved_at"},
               ${hasSnapshot ? `(SELECT ISNULL(SUM(d.total),0) FROM dbo.OtpDateExclusionDepartures d WHERE d.exclusion_id = e.id)` : "0"} excluded_departures
        FROM OtpDateExclusions e
        ORDER BY e.service_date DESC
      `);
      return { status: 200, jsonBody: { exclusions: result.recordset } };
    } catch (err) {
      context.error("GET /otp-date-exclusions failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("otpDateExclusionsCreate", {
  route: "otp-date-exclusions",
  methods: ["POST"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = await requireAccess(request, "compliance-review.review");
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
    }
    const errors = validateDateExclusion(raw as Record<string, unknown>);
    if (errors.length > 0) {
      return { status: 400, jsonBody: { error: "Validation failed", details: errors } };
    }
    const body = raw as {
      scope: "Agency" | "Route";
      route_id?: number | null;
      service_date: string;
      reason_code: string;
      notes?: string | null;
    };
    const createdBy = authResult.principal.userDetails || "system";

    try {
      const pool = await getPool();
      const sqlRequest = pool.request();
      sqlRequest.input("scope", sql.NVarChar(10), body.scope);
      sqlRequest.input("route_id", sql.Int, body.scope === "Route" ? body.route_id ?? null : null);
      sqlRequest.input("service_date", sql.Char(8), body.service_date);
      sqlRequest.input("reason_code", sql.NVarChar, body.reason_code);
      sqlRequest.input("notes", sql.NVarChar, body.notes ?? null);
      sqlRequest.input("created_by", sql.NVarChar, createdBy);

      const result = await sqlRequest.query<DateExclusionRow>(`
        INSERT INTO OtpDateExclusions (scope, route_id, service_date, reason_code, notes, created_by)
        OUTPUT INSERTED.id, INSERTED.scope, INSERTED.route_id, INSERTED.service_date,
               INSERTED.reason_code, INSERTED.notes, INSERTED.status, INSERTED.notified,
               INSERTED.notified_at, INSERTED.acknowledged, INSERTED.created_by, INSERTED.created_at
        VALUES (@scope, @route_id, @service_date, @reason_code, @notes, @created_by)
      `);

      return { status: 201, jsonBody: result.recordset[0] };
    } catch (err) {
      context.error("POST /otp-date-exclusions failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

// Approving a date freezes what it took out, in the same transaction that
// flips the status. The two cannot be allowed to come apart: an approved
// exclusion with no snapshot subtracts nothing while looking authoritative,
// which is precisely the failure the Weather page has had since migration 018.
app.http("otpDateExclusionsApprove", {
  route: "otp-date-exclusions/{id}/approve",
  methods: ["POST"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = await requireAccess(request, "compliance-review.review");
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }
    const id = request.params.id;
    if (!id || !/^[0-9a-fA-F-]{36}$/.test(id)) {
      return { status: 400, jsonBody: { error: "A date exclusion id is required" } };
    }
    const approvedBy = authResult.principal.userDetails || "system";

    let pool;
    try {
      pool = await getPool();
    } catch (err) {
      context.error("POST /otp-date-exclusions/{id}/approve failed to connect:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }

    const ready = await pool.request().query<{ table_exists: number }>(`
      SELECT CASE WHEN OBJECT_ID('dbo.OtpDateExclusionDepartures', 'U') IS NULL THEN 0 ELSE 1 END AS table_exists
    `);
    if (ready.recordset[0]?.table_exists !== 1) {
      return { status: 503, jsonBody: { error: "Migration 140 has not been applied, so an approved date could not subtract anything yet." } };
    }

    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const found = await new sql.Request(tx).input("id", sql.UniqueIdentifier, id).query<{
        service_date: string; scope: string; route_id: number | null; status: string;
      }>("SELECT service_date, scope, route_id, status FROM dbo.OtpDateExclusions WHERE id = @id");
      const exclusion = found.recordset[0];
      if (!exclusion) {
        await tx.rollback();
        return { status: 404, jsonBody: { error: "No such date exclusion" } };
      }

      const snapshot = await takeDateExclusionSnapshot(
        tx, id, exclusion.service_date, exclusion.scope === "Route" ? exclusion.route_id : null,
      );
      if (snapshot.kind === "refused") {
        // Nothing is written. An approval that cannot be evidenced is refused
        // with the reason, rather than recorded as an approval that does
        // nothing.
        await tx.rollback();
        return {
          status: 422,
          jsonBody: { error: refusalMessage(snapshot.reason, exclusion.service_date), reason: snapshot.reason.kind },
        };
      }

      const updated = await new sql.Request(tx)
        .input("id", sql.UniqueIdentifier, id)
        .input("by", sql.NVarChar(200), approvedBy)
        .query<DateExclusionRow>(`
          UPDATE dbo.OtpDateExclusions
          SET status = 'Approved', approved_by = @by, approved_at = SYSUTCDATETIME(),
              snapshot_taken_at = SYSUTCDATETIME()
          OUTPUT INSERTED.id, INSERTED.scope, INSERTED.route_id, INSERTED.service_date,
                 INSERTED.reason_code, INSERTED.notes, INSERTED.status, INSERTED.notified,
                 INSERTED.notified_at, INSERTED.acknowledged, INSERTED.created_by, INSERTED.created_at
          WHERE id = @id
        `);
      await tx.commit();

      return {
        status: 200,
        jsonBody: {
          exclusion: updated.recordset[0],
          snapshot: {
            service_month: snapshot.serviceMonth,
            day_of_week: snapshot.dayOfWeek,
            stops: snapshot.rows,
            departures: snapshot.departures,
          },
        },
      };
    } catch (err) {
      try { await tx.rollback(); } catch { /* the transaction is already gone */ }
      context.error("POST /otp-date-exclusions/{id}/approve failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
