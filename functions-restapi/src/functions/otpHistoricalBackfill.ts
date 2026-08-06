// One-time (repeatable) admin-triggered backfill of OTP Monthly + Missed
// Trips for months OUTSIDE the daily pollers' 3-month trailing window
// (otpMonthlyFeedPoll.ts/availMissedTripsPoll.ts). Added per Ty's "I should
// be able to see throughout 2026 and beyond" - the trailing window only
// ever self-heals the current month + prior 2, so the months before that
// window (e.g. Jan-May 2026, before this feed's poller existed) never get
// fetched on their own. "And beyond" (future months) needs no new code -
// the daily trailing window already rolls forward automatically as time
// passes; this endpoint only fills the historical gap behind it.
//
// Idempotent either direction: OTP Monthly upserts by (service_month,
// route_id, stop_id, day_of_week); Missed Trips deletes+reloads whole
// months. Re-running for a month already covered (including the current
// trailing window) is harmless, just redundant.
//
//   POST /otp-historical-backfill  body: {from: "YYYYMM", to: "YYYYMM"} - OCC.Admin only
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { requireRole, ADMIN_ROLES } from "../lib/auth";
import { validateOtpHistoricalBackfill, MAX_BACKFILL_MONTHS } from "../lib/validation";
import {
  fetchOtpMonthlyReports,
  mapOtpMonthlyReport,
  monthsBetween,
  upsertOtpMonthlyReport,
} from "../lib/otpMonthlyFeed";
import { fetchMissedTripReports, mapMissedTripReport, replaceMissedTripsForMonths } from "../lib/availMissedTripsFeed";

function monthToDate(yyyymm: string): Date {
  return new Date(Date.UTC(Number(yyyymm.slice(0, 4)), Number(yyyymm.slice(4, 6)) - 1, 1));
}

function lastDayOfMonth(yyyymm: string): Date {
  const start = monthToDate(yyyymm);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
}

app.http("otpHistoricalBackfill", {
  route: "otp-historical-backfill",
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
    const errors = validateOtpHistoricalBackfill(raw as Record<string, unknown>);
    if (errors.length > 0) {
      return { status: 400, jsonBody: { error: "Validation failed", details: errors } };
    }
    const body = raw as { from: string; to: string };

    const months = monthsBetween(body.from, body.to);
    if (months.length > MAX_BACKFILL_MONTHS) {
      return {
        status: 400,
        jsonBody: { error: `Range spans ${months.length} months, exceeding the ${MAX_BACKFILL_MONTHS}-month cap.` },
      };
    }

    const otpBaseUrl = process.env.AVAIL_OTP_MONTHLY_URL;
    const missedBaseUrl = process.env.AVAIL_MISSED_TRIPS_URL;
    const apiKey = process.env.AVAIL_AVL_REPORTS_API_KEY;
    if (!otpBaseUrl || !missedBaseUrl || !apiKey) {
      return {
        status: 500,
        jsonBody: { error: "AVAIL_OTP_MONTHLY_URL/AVAIL_MISSED_TRIPS_URL/AVAIL_AVL_REPORTS_API_KEY are not configured." },
      };
    }

    const pool = await getPool();
    const otpResults: { service_month: string; reports_seen: number; upserted: number; error?: string }[] = [];

    for (const serviceMonth of months) {
      try {
        const reports = await fetchOtpMonthlyReports(otpBaseUrl, apiKey, monthToDate(serviceMonth));
        let upserted = 0;
        for (const report of reports) {
          const mapped = mapOtpMonthlyReport(report, serviceMonth);
          if (!mapped) continue;
          await upsertOtpMonthlyReport(pool, mapped);
          upserted++;
        }
        otpResults.push({ service_month: serviceMonth, reports_seen: reports.length, upserted });
        context.log(`OTP Monthly backfill: ${reports.length} reports seen, ${upserted} rows upserted for ${serviceMonth}.`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        otpResults.push({ service_month: serviceMonth, reports_seen: 0, upserted: 0, error: message });
        context.error(`OTP Monthly backfill failed for ${serviceMonth}:`, err);
      }
    }

    let missedTripsResult: { reports_seen: number; rows_inserted: number; error?: string };
    try {
      const windowStart = monthToDate(months[0]);
      const now = new Date();
      const windowEndCandidate = lastDayOfMonth(months[months.length - 1]);
      const windowEnd = windowEndCandidate.getTime() < now.getTime() ? windowEndCandidate : now;

      const reports = await fetchMissedTripReports(missedBaseUrl, apiKey, windowStart, windowEnd);
      const mapped = reports
        .map((report) => mapMissedTripReport(report))
        .filter((m): m is NonNullable<typeof m> => m !== null);
      await replaceMissedTripsForMonths(pool, months, mapped);
      missedTripsResult = { reports_seen: reports.length, rows_inserted: mapped.length };
      context.log(`Missed Trips backfill: ${reports.length} reports seen, ${mapped.length} rows reloaded across ${months.join(", ")}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      missedTripsResult = { reports_seen: 0, rows_inserted: 0, error: message };
      context.error(`Missed Trips backfill failed for ${months.join(", ")}:`, err);
    }

    return {
      status: 200,
      jsonBody: { months, otp_monthly: otpResults, missed_trips: missedTripsResult },
    };
  },
});
