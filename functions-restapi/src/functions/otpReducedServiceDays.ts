// Declaring the days that did not run a normal schedule (ADR 0040).
//
// Avail's monthly OTP feed groups by day of week, so a holiday running a
// Sunday schedule is added into that weekday's bucket and nothing says so.
// These declarations are what let the console say so.
//
//   GET    /otp-reduced-service-days?month=  - compliance-review.view
//   PUT    /otp-reduced-service-days         - service-configuration.edit
//   DELETE /otp-reduced-service-days/{id}    - service-configuration.edit
//
// Reading is open to any reviewer, because the note is for them. Declaring is
// not: one declaration annotates every reviewer's queue for that month, which
// is the same reason the Early/Late Bias Threshold lives behind the
// Administration gate rather than in the module.
//
// Declaring changes no figure. Taking a day out of the contractor's figure is
// a Weather/Emergency date exclusion, approved on its own evidence (ADR 0038).
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireAccess } from "../lib/access/require";
import { validateReducedServiceDay } from "../lib/validation";
import { availDayOfWeek, serviceMonthOfDate } from "../lib/otpMonth/rules";
import { readReducedServiceMonth } from "../lib/otpServiceDay";
import { serviceMonthOf } from "../lib/otpMonthlyFeed";

function resolveMonth(request: HttpRequest): string {
  const param = request.query.get("month");
  return param && /^\d{6}$/.test(param) ? param : serviceMonthOf(new Date());
}

async function tableReady(): Promise<boolean> {
  const pool = await getPool();
  const probe = await pool.request().query<{ ready: number }>(`
    SELECT CASE WHEN OBJECT_ID('dbo.OtpReducedServiceDays','U') IS NULL THEN 0 ELSE 1 END ready
  `);
  return probe.recordset[0]?.ready === 1;
}

app.http("otpReducedServiceDaysList", {
  route: "otp-reduced-service-days",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = await requireAccess(request, "compliance-review.view");
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }
    try {
      const pool = await getPool();
      // The month's declarations with whatever the daily feed can say about
      // each. A month nobody has declared anything for answers empty, which is
      // the same shape as an ordinary month.
      const month = resolveMonth(request);
      const result = await readReducedServiceMonth(pool, month);
      return { status: 200, jsonBody: { service_month: month, ...result } };
    } catch (err) {
      context.error("GET /otp-reduced-service-days failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("otpReducedServiceDaysUpsert", {
  route: "otp-reduced-service-days",
  methods: ["PUT"],
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
    const errors = validateReducedServiceDay(raw as Record<string, unknown>);
    if (errors.length > 0) {
      return { status: 400, jsonBody: { error: "Validation failed", details: errors } };
    }
    const body = raw as { service_date: string; label: string; schedule_operated: string; notes?: string | null };

    if (!await tableReady()) {
      return { status: 503, jsonBody: { error: "Migration 142 has not been applied, so a reduced service day cannot be recorded yet." } };
    }

    try {
      const pool = await getPool();
      const req = pool.request();
      req.input("service_date", sql.Char(8), body.service_date);
      // Avail's own spelling, stamped here rather than derived on read, so a
      // bucket keeps matching if Avail ever changes it.
      req.input("day_of_week", sql.NVarChar(20), availDayOfWeek(body.service_date));
      req.input("label", sql.NVarChar(120), body.label.trim());
      req.input("schedule_operated", sql.NVarChar(60), body.schedule_operated.trim());
      req.input("notes", sql.NVarChar(500), body.notes?.trim() || null);
      req.input("declared_by", sql.NVarChar(200), authResult.principal.userDetails || "system");

      // Re-declaring a date updates it in place: one day, one label.
      const result = await req.query(`
        MERGE dbo.OtpReducedServiceDays WITH (HOLDLOCK) AS target
        USING (SELECT @service_date AS service_date) AS src
        ON target.service_date = src.service_date
        WHEN MATCHED THEN UPDATE SET
          day_of_week = @day_of_week, label = @label, schedule_operated = @schedule_operated,
          notes = @notes, declared_by = @declared_by, declared_at = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT (service_date, day_of_week, label, schedule_operated, notes, declared_by)
          VALUES (@service_date, @day_of_week, @label, @schedule_operated, @notes, @declared_by)
        OUTPUT INSERTED.id, INSERTED.service_date, INSERTED.day_of_week, INSERTED.label,
               INSERTED.schedule_operated, INSERTED.notes, INSERTED.declared_by, INSERTED.declared_at;
      `);

      return { status: 200, jsonBody: { day: result.recordset[0], service_month: serviceMonthOfDate(body.service_date) } };
    } catch (err) {
      context.error("PUT /otp-reduced-service-days failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("otpReducedServiceDaysDelete", {
  route: "otp-reduced-service-days/{id}",
  methods: ["DELETE"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = await requireAccess(request, "service-configuration.edit");
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }
    const id = request.params.id;
    if (!id || !/^[0-9a-fA-F-]{36}$/.test(id)) {
      return { status: 400, jsonBody: { error: "A reduced service day id is required" } };
    }

    // Hard delete, following RouteClassification: this is a current-state note
    // on a bucket, and nothing references a row here for audit or compliance
    // history the way an exclusion decision is referenced. A day declared by
    // mistake should leave no trace.
    try {
      const pool = await getPool();
      const result = await pool.request().input("id", sql.UniqueIdentifier, id)
        .query("DELETE FROM dbo.OtpReducedServiceDays WHERE id = @id");
      if (result.rowsAffected[0] === 0) {
        return { status: 404, jsonBody: { error: "No such reduced service day" } };
      }
      return { status: 204 };
    } catch (err) {
      context.error("DELETE /otp-reduced-service-days/{id} failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
