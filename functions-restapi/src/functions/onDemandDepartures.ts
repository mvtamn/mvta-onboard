// GET /on-demand-departures - Spare duty departure history, backing the
// On-Demand view of the console's Garage Departures module (Compliance tab).
// The on-demand counterpart of GET /fixed-route-departures, with the same
// diagnostics shape so the console reads both through one state model. Same
// readers; visibility only - all writes come from onDemandDeparturesPoll.ts.
// Accepts an optional ?days= query param to scope the trend window (default 14).
// Every row carries an outcome judged by the same rule the compliance
// candidate poll raises occurrences from (lib/onDemandDepartureOutcome.ts),
// and the diagnostics count by it, with the allowance and the settled-day
// boundary they used.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, STAFF_READ_ROLES } from "../lib/auth";
import { agencyServiceDate } from "../lib/missedTripTime";
import { onDemandDeparturesEnabled } from "../lib/onDemandDepartures";
import { isJudged, onDemandDepartureOutcome, type OnDemandDepartureOutcome } from "../lib/onDemandDepartureOutcome";
import { garageDepartureVarianceSeconds, onDemandDepartureSourceRefSql, settledServiceDateExclusive } from "./complianceCandidatesPoll";

const DEFAULT_TREND_DAYS = 14;

interface OnDemandDepartureRow {
  service_date: string;
  duty_id: string;
  duty_identifier: string | null;
  driver_id: string | null;
  vehicle_id: string | null;
  vehicle_identifier: string | null;
  driver_name: string | null;
  driver_identifier: string | null;
  duty_status: string | null;
  departure_scheduled: Date | null;
  scheduled_source: string | null;
  departure_actual: Date | null;
  departure_source: string | null;
  updated_at: Date;
  departure_delta_seconds: number | null;
  // Scheduled to have left more than the variance allowance ago, and no
  // departure recorded from either source. The same shape as a fixed-route
  // run with no pullout actual.
  no_departure: boolean;
  // Where this duty landed in the performance assessment; null when no
  // occurrence was raised or migration 030 has not run.
  occurrence_id?: string | null;
  occurrence_review_status?: string | null;
  occurrence_attribution?: string | null;
  occurrence_service_month?: string | null;
  occurrence_period_status?: string | null;
}

app.http("onDemandDeparturesList", {
  route: "on-demand-departures",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, [...STAFF_READ_ROLES, "OCC.Compliance"]);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }

    const daysParam = Number(request.query.get("days"));
    const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 365) : DEFAULT_TREND_DAYS;
    const varianceSeconds = garageDepartureVarianceSeconds();
    const settledBefore = settledServiceDateExclusive();

    try {
      const pool = await getPool();
      const tableCheck = await pool.request().query<{ table_exists: number; with_vehicle_identifier: number; with_driver_label: number }>(`
        SELECT CASE WHEN OBJECT_ID('dbo.OnDemandDepartures', 'U') IS NULL THEN 0 ELSE 1 END AS table_exists,
               CASE WHEN COL_LENGTH('dbo.OnDemandDepartures', 'vehicle_identifier') IS NULL THEN 0 ELSE 1 END AS with_vehicle_identifier,
               CASE WHEN COL_LENGTH('dbo.OnDemandDepartures', 'driver_name') IS NULL THEN 0 ELSE 1 END AS with_driver_label
      `);
      // Before migration 099 the fleet number is simply absent, and before
      // migration 100 the driver's name is.
      const vehicleIdentifierSql = tableCheck.recordset[0]?.with_vehicle_identifier === 1
        ? "d.vehicle_identifier" : "CAST(NULL AS NVARCHAR(64)) AS vehicle_identifier";
      const driverLabelSql = tableCheck.recordset[0]?.with_driver_label === 1
        ? "d.driver_name, d.driver_identifier" : "CAST(NULL AS NVARCHAR(128)) AS driver_name, CAST(NULL AS NVARCHAR(64)) AS driver_identifier";
      const configured = onDemandDeparturesEnabled() && Boolean(process.env.SPARE_API_KEY?.trim());
      const empty = {
        configured, table_ready: false, record_count: 0, judged_count: 0, late_count: 0, no_departure_count: 0,
        avg_delta_seconds: null as number | null, variance_seconds: varianceSeconds,
        settled_before: settledBefore,
      };
      if (tableCheck.recordset[0]?.table_exists !== 1) {
        return { status: 200, jsonBody: { departures: [], diagnostics: empty } };
      }

      const occurrencesCheck = await pool.request().query<{ ready: number }>(`
        SELECT CASE WHEN OBJECT_ID('dbo.ComplianceOccurrences','U') IS NULL THEN 0 ELSE 1 END ready
      `);
      const occurrencesReady = occurrencesCheck.recordset[0]?.ready === 1;
      // Joined on the same source_ref the candidate poll writes, so a duty's
      // review state here is the one the assessment scores.
      const occurrenceColumns = occurrencesReady
        ? `,
               occ.id AS occurrence_id, occ.review_status AS occurrence_review_status,
               occ.attribution AS occurrence_attribution, occ.service_month AS occurrence_service_month,
               period.status AS occurrence_period_status`
        : "";
      const occurrenceJoin = occurrencesReady
        ? `
        LEFT JOIN ComplianceOccurrences occ ON occ.source_ref = ${onDemandDepartureSourceRefSql()}
        LEFT JOIN AssessmentPeriods period
          ON period.contractor_id = occ.contractor_id AND period.service_month = occ.service_month`
        : "";

      const req = pool.request();
      // Agency-local, to match the service_date the poll stores.
      req.input("cutoff_date", sql.Char(8), agencyServiceDate(new Date(), -days).serviceDate);
      req.input("variance_seconds", sql.Int, varianceSeconds);
      const result = await req.query<OnDemandDepartureRow>(`
        SELECT d.service_date, d.duty_id, d.duty_identifier, d.driver_id, d.vehicle_id,
               ${vehicleIdentifierSql}, ${driverLabelSql}, d.duty_status,
               d.departure_scheduled, d.scheduled_source, d.departure_actual, d.departure_source, d.updated_at,
               CASE WHEN d.departure_scheduled IS NOT NULL AND d.departure_actual IS NOT NULL
                 THEN DATEDIFF(SECOND, d.departure_scheduled, d.departure_actual) ELSE NULL END AS departure_delta_seconds,
               CAST(CASE WHEN d.departure_actual IS NULL AND d.departure_scheduled IS NOT NULL
                 AND DATEADD(SECOND, @variance_seconds, d.departure_scheduled) < SYSUTCDATETIME()
                 AND ISNULL(d.duty_status, '') <> 'cancelled' THEN 1 ELSE 0 END AS BIT) AS no_departure${occurrenceColumns}
        FROM OnDemandDepartures d${occurrenceJoin}
        WHERE d.service_date >= @cutoff_date
        ORDER BY d.service_date DESC, d.departure_scheduled, d.duty_id
      `);
      const departures: Array<OnDemandDepartureRow & { outcome: OnDemandDepartureOutcome }> = result.recordset.map((row) => ({
        ...row,
        outcome: onDemandDepartureOutcome(row, varianceSeconds, settledBefore),
      }));
      const judged = departures.filter((d) => isJudged(d.outcome));
      const withDelta = judged.filter((d) => d.departure_delta_seconds !== null);
      const avgDeltaSeconds = withDelta.length > 0
        ? Math.round(withDelta.reduce((sum, d) => sum + (d.departure_delta_seconds ?? 0), 0) / withDelta.length)
        : null;

      return {
        status: 200,
        jsonBody: {
          departures,
          diagnostics: {
            ...empty,
            table_ready: true,
            record_count: departures.length,
            judged_count: judged.length,
            late_count: judged.filter((d) => d.outcome === "late").length,
            no_departure_count: judged.filter((d) => d.outcome === "no_departure").length,
            avg_delta_seconds: avgDeltaSeconds,
          },
        },
      };
    } catch (err) {
      context.error("GET /on-demand-departures failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
