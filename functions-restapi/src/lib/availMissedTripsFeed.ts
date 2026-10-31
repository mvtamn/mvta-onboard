// Avail360 Missed Trips By Route/Stop/Day - the recommended primary Missed
// Trips feed per OTP-Feed-Evaluation-and-Recommendation.md (repo root).
// Unlike otpMonthlyFeed.ts, this returns individual incident records (one
// row per missed departure/arrival/trip), not pre-aggregated percentages,
// over an explicit Start_Date/End_Date range with a real CalendarDate per
// record.
//
// Owner decisions baked into the request (availClient.ts): Full Trip Only=0
// (count a trip as missed if either the departure or arrival stop was
// missed - the broader reading, matching the owner's own stated definition
// of a contractor-fault missed trip) and Include Deadheads=0 (excluded,
// matching the doc's own recommendation).
//
// CONFIRMED live 2026-08-06 (see plans/otp-compliance-live-data-rethink.md):
// the guessed PascalCase key was wrong the whole time. Real key is
// lowercase "missed", with a sibling "results" metadata array - same
// pattern as otpMonthlyFeed.ts ("OtpByRouteStopDayAgg" -> "otp") and
// Detours ("Detours" -> "detours"). This feed was never actually empty.
import sql from "mssql";
import { calendarDateAndTimeToUtc } from "./missedTripTime";

export interface AvailMissedTripReport {
  DepartureStopID: number | null;
  DepartureStopName: string | null;
  ArrivalStopID: number | null;
  ArrivalStopName: string | null;
  RouteID: number;
  RouteDesc: string | null;
  RouteInternetName: string | null;
  CalendarDate: string;
  DepartureMissed: number;
  ArrivalMissed: number;
  EntireTripMissed: number;
  DepartureTripStartTime: string | null;
}

export interface MappedMissedTrip {
  service_month: string;
  calendar_date: string;
  route_id: number;
  route_desc: string | null;
  route_internet_name: string | null;
  departure_stop_id: number | null;
  departure_stop_name: string | null;
  arrival_stop_id: number | null;
  arrival_stop_name: string | null;
  departure_missed: boolean;
  arrival_missed: boolean;
  entire_trip_missed: boolean;
  departure_trip_start_time: Date | null;
}

function parseCalendarDate(value: string): { calendar_date: string; service_month: string } | null {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return { calendar_date: `${y}${m}${day}`, service_month: `${y}${m}` };
}

// Guard clause, not a throw - a single malformed report shouldn't abort the
// whole poll (same convention as mapAvlReport/mapPulloutReport).
export function mapMissedTripReport(report: AvailMissedTripReport): MappedMissedTrip | null {
  if (typeof report.RouteID !== "number" || !report.CalendarDate) {
    return null;
  }
  const parsedDate = parseCalendarDate(report.CalendarDate);
  if (!parsedDate) return null;

  return {
    ...parsedDate,
    route_id: report.RouteID,
    route_desc: report.RouteDesc ?? null,
    route_internet_name: report.RouteInternetName ?? null,
    departure_stop_id: report.DepartureStopID ?? null,
    departure_stop_name: report.DepartureStopName ?? null,
    arrival_stop_id: report.ArrivalStopID ?? null,
    arrival_stop_name: report.ArrivalStopName ?? null,
    departure_missed: Boolean(report.DepartureMissed),
    arrival_missed: Boolean(report.ArrivalMissed),
    entire_trip_missed: Boolean(report.EntireTripMissed),
    // Live Avail data sends a time-only agency-local value such as "14:31",
    // not an ISO timestamp. Combine it with CalendarDate in America/Chicago;
    // new Date("14:31") is Invalid Date and previously discarded every
    // populated start time as NULL.
    departure_trip_start_time: calendarDateAndTimeToUtc(
      report.CalendarDate,
      report.DepartureTripStartTime,
    ),
  };
}

// Shared delete+reload, extracted from availMissedTripsPoll.ts so
// otpHistoricalBackfill.ts (arbitrary past months, admin-triggered) can
// reuse the identical replace instead of duplicating it. Same
// no-natural-key situation as the daily poller - safe and idempotent to
// re-run for months already backfilled.
//
// One bulk load per call, not one INSERT per row. The row-at-a-time loop
// this replaces is what made a three-month reload take 15+ minutes: every
// row cost a full round trip to Azure SQL, and a month of missed trips runs
// to thousands of them. That slowness was not merely slow - it timed the
// admin backfill's HTTP request out at the gateway mid-reload, so a run
// whose OTP half had already been written in full reported failure with a
// zero row count (observed on dev 2026-10-28 for 202605 and 202606). Same
// `sql.Table` + `.bulk()` shape as predictionAccuracy/store.ts and
// gtfsStopsSync.ts, still inside the one transaction, so a killed request
// still rolls the whole month back rather than leaving it half-reloaded.
//
// Column names, order and lengths are migration-015-avail-missed-trips.sql's.
// `id` (IDENTITY) and `ingested_at` (DEFAULT SYSUTCDATETIME()) are left out
// of the column list so the server fills them exactly as it did for the
// row-by-row inserts.
export async function replaceMissedTripsForMonths(
  pool: sql.ConnectionPool,
  targetMonths: string[],
  mapped: MappedMissedTrip[],
): Promise<void> {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    for (const serviceMonth of targetMonths) {
      const deleteReq = new sql.Request(tx);
      deleteReq.input("service_month", sql.Char(6), serviceMonth);
      await deleteReq.query("DELETE FROM AvailMissedTripsRouteStopDay WHERE service_month = @service_month");
    }

    const table = new sql.Table("AvailMissedTripsRouteStopDay");
    table.columns.add("service_month", sql.Char(6), { nullable: false });
    table.columns.add("calendar_date", sql.Char(8), { nullable: false });
    table.columns.add("route_id", sql.Int, { nullable: false });
    table.columns.add("route_desc", sql.NVarChar(200), { nullable: true });
    table.columns.add("route_internet_name", sql.NVarChar(200), { nullable: true });
    table.columns.add("departure_stop_id", sql.Int, { nullable: true });
    table.columns.add("departure_stop_name", sql.NVarChar(200), { nullable: true });
    table.columns.add("arrival_stop_id", sql.Int, { nullable: true });
    table.columns.add("arrival_stop_name", sql.NVarChar(200), { nullable: true });
    table.columns.add("departure_missed", sql.Bit, { nullable: false });
    table.columns.add("arrival_missed", sql.Bit, { nullable: false });
    table.columns.add("entire_trip_missed", sql.Bit, { nullable: false });
    table.columns.add("departure_trip_start_time", sql.DateTime2, { nullable: true });
    for (const m of mapped) {
      table.rows.add(
        m.service_month,
        m.calendar_date,
        m.route_id,
        m.route_desc,
        m.route_internet_name,
        m.departure_stop_id,
        m.departure_stop_name,
        m.arrival_stop_id,
        m.arrival_stop_name,
        m.departure_missed,
        m.arrival_missed,
        m.entire_trip_missed,
        m.departure_trip_start_time,
      );
    }
    if (mapped.length > 0) await new sql.Request(tx).bulk(table);

    await tx.commit();
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      /* already rolled back / not begun */
    }
    throw err;
  }
}
