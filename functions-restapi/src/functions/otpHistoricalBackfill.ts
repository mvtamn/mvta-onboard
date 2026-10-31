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
// ONE month per request, not a range - CONFIRMED live 2026-08-06: a 5-month
// range in a single request hit a 504 gateway timeout. Missed Trips alone
// has separately been observed to take 15+ minutes for just 3 months (see
// availMissedTripsPoll.ts's own comment on sequential single-row inserts),
// so any multi-month synchronous HTTP request is fundamentally unsafe
// behind a gateway with a real timeout. The console (OtpModule.tsx's
// OtpHistoricalBackfillPanel) loops one request per month client-side
// instead, so each request stays bounded and the UI shows real per-month
// progress rather than one opaque multi-minute spinner that eventually
// 504s with nothing to show for it.
//
// ONE PHASE per request as well, for the same reason one level down. The
// two feeds used to run back to back in a single invocation: OTP Monthly
// first (13-30 s for a month), then Missed Trips. The 200 carrying the OTP
// result was not written until both had finished, so a month whose Missed
// Trips reload outran the gateway reported failure for an OTP half that had
// been written in full - observed on dev 2026-10-28, where 202605 and
// 202606 both showed "Request failed (504)" and "0 OTP Monthly rows
// upserted" against months that had in fact been written completely. A
// faster Missed Trips reload (availMissedTripsFeed.ts now bulk-loads) makes
// that less likely; asking for one phase at a time is what makes it
// impossible, because no phase's result waits on another's work.
//
// Idempotent either direction: OTP Monthly upserts by (service_month,
// route_id, stop_id, day_of_week); Missed Trips deletes+reloads the whole
// month. Re-running for a month already covered (including the current
// trailing window) is harmless, just redundant.
//
//   POST /otp-historical-backfill
//     body: {month: "YYYYMM", phase?: "otp_monthly" | "missed_trips"}
//     - integrations-health.edit
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { requireAccess } from "../lib/access/require";
import { validateOtpHistoricalBackfill } from "../lib/validation";
import { availConfig, fetchAvail } from "../lib/availClient";
import {
  collapseOtpMonthlyReports,
  describeOtpMonthlyCollision,
  mapOtpMonthlyReport,
  measurementStampReady,
  restatementLedgerReady,
  serviceMonthOf,
  upsertOtpMonthlyReport,
  type OtpMonthlyCandidate,
} from "../lib/otpMonthlyFeed";
import { readParametersInForce } from "../lib/otpMeasurementParameters";
import { mapMissedTripReport, replaceMissedTripsForMonths } from "../lib/availMissedTripsFeed";

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
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = await requireAccess(request, "integrations-health.edit");
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
    const { month, phase } = raw as { month: string; phase?: "otp_monthly" | "missed_trips" };
    const runOtp = phase === undefined || phase === "otp_monthly";
    const runMissedTrips = phase === undefined || phase === "missed_trips";

    // Only the feed being asked for has to be configured - a request for one
    // phase must not fail over the other phase's settings.
    const otp = availConfig("otp_monthly");
    const missed = availConfig("missed_trips");
    if ((runOtp && !otp.config) || (runMissedTrips && !missed.config)) {
      const unset = [
        ...new Set([
          ...(runOtp && !otp.config ? (otp.missing ?? []) : []),
          ...(runMissedTrips && !missed.config ? (missed.missing ?? []) : []),
        ]),
      ];
      return {
        status: 500,
        jsonBody: { error: `${unset.join("/")} not configured.` },
      };
    }

    const pool = await getPool();

    let otpResult: {
      reports_seen: number;
      upserted: number;
      duplicate_keys?: number;
      duplicate_key_detail?: string[];
      measurement_parameters?: string;
      error?: string;
    } | undefined;
    if (runOtp) {
      // Read only by the phase that needs it: a Missed Trips request has no
      // business reading the measurement register.
      const ledgerReady = await restatementLedgerReady(pool);
      const stampReady = await measurementStampReady(pool);
      const currentServiceMonth = serviceMonthOf(new Date());
      // This is the one action that restates a closed month on purpose, which
      // is why ADR 0042 leaves re-pulling to a human rather than doing it on a
      // declaration: the month comes back measured at whatever is in force
      // now, and that is what the rows will say they were measured at.
      const parameters = await readParametersInForce(pool);
      try {
        const reports = await fetchAvail("otp_monthly", { month: monthToDate(month), parameters: parameters.segments }, otp.config!);
        const candidates: OtpMonthlyCandidate[] = [];
        for (const report of reports) {
          const mapped = mapOtpMonthlyReport(report, month);
          if (!mapped) continue;
          candidates.push({ mapped, source: report });
        }
        // A month that holds two schedule patterns comes back as two records on
        // one key. Summing them before the upsert is the only way the backfill
        // stores the month Avail published rather than whichever half of it the
        // MERGE happened to write last - 2026-03 lost 855 departures this way.
        const { rows, collisions } = collapseOtpMonthlyReports(candidates);
        const duplicateKeyDetail = collisions.map((collision) => describeOtpMonthlyCollision(collision));
        for (const line of duplicateKeyDetail) context.warn(`OTP Monthly backfill: ${line}`);
        let upserted = 0;
        for (const { row } of rows) {
          // A backfill that changes an already-ingested past month is a
          // restatement like any other, and is recorded as one.
          await upsertOtpMonthlyReport(pool, row, {
            ledgerReady,
            currentServiceMonth,
            measurementParameters: parameters.segments,
            stampReady,
          });
          upserted++;
        }
        otpResult = {
          reports_seen: reports.length,
          upserted,
          duplicate_keys: collisions.length,
          // Returned, not only logged: the console's backfill panel is where an
          // admin watches a month come back, and "1,108 records became 1,081
          // rows" is a fact about that month worth seeing there.
          duplicate_key_detail: duplicateKeyDetail,
          measurement_parameters: parameters.segments,
        };
        context.log(
          `OTP Monthly backfill: ${reports.length} reports seen, ${upserted} rows upserted for ${month}` +
            `${collisions.length > 0 ? ` (${collisions.length} keys carried more than one record)` : ""}.`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        otpResult = { reports_seen: 0, upserted: 0, error: message };
        context.error(`OTP Monthly backfill failed for ${month}:`, err);
      }
    }

    let missedTripsResult: { reports_seen: number; rows_inserted: number; error?: string } | undefined;
    if (runMissedTrips) {
      try {
        const windowStart = monthToDate(month);
        const now = new Date();
        const windowEndCandidate = lastDayOfMonth(month);
        const windowEnd = windowEndCandidate.getTime() < now.getTime() ? windowEndCandidate : now;

        const reports = await fetchAvail("missed_trips", { start: windowStart, end: windowEnd }, missed.config!);
        const mapped = reports
          .map((report) => mapMissedTripReport(report))
          .filter((m): m is NonNullable<typeof m> => m !== null);
        await replaceMissedTripsForMonths(pool, [month], mapped);
        missedTripsResult = { reports_seen: reports.length, rows_inserted: mapped.length };
        context.log(`Missed Trips backfill: ${reports.length} reports seen, ${mapped.length} rows reloaded for ${month}.`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        missedTripsResult = { reports_seen: 0, rows_inserted: 0, error: message };
        context.error(`Missed Trips backfill failed for ${month}:`, err);
      }
    }

    return {
      status: 200,
      jsonBody: {
        service_month: month,
        ...(otpResult ? { otp_monthly: otpResult } : {}),
        ...(missedTripsResult ? { missed_trips: missedTripsResult } : {}),
      },
    };
  },
});
