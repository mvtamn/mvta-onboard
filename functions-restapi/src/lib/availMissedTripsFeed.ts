// Avail360 Missed Trips By Route/Stop/Day - the recommended primary Missed
// Trips feed per OTP-Feed-Evaluation-and-Recommendation.md (repo root).
// Unlike otpMonthlyFeed.ts, this returns individual incident records (one
// row per missed departure/arrival/trip), not pre-aggregated percentages,
// over an explicit Start_Date/End_Date range with a real CalendarDate per
// record.
//
// Owner decisions baked into fetchMissedTripReports below: Full Trip Only=0
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
import { formatDateMmDdYyyy } from "./otpMonthlyFeed";
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

export interface AvailMissedTripsEnvelope {
  errors: string[];
  result: {
    missed: AvailMissedTripReport[];
    results?: { RefreshTime: string; Property: string }[];
  };
  success: boolean;
}

const FULL_TRIP_ONLY = 0; // owner decision - broader: either end missed counts
const INCLUDE_DEADHEADS = 0; // owner decision - exclude non-revenue moves

// baseUrl is the agency-level URL with no trailing path segments, e.g.
// "https://avail360-api.myavail.cloud/MissedTripsByRouteStopDay/v1/MVTA".
export async function fetchMissedTripReports(
  baseUrl: string,
  apiKey: string,
  startDate: Date,
  endDate: Date,
): Promise<AvailMissedTripReport[]> {
  const url =
    `${baseUrl.replace(/\/+$/, "")}/${formatDateMmDdYyyy(startDate)}/${formatDateMmDdYyyy(endDate)}` +
    `/${FULL_TRIP_ONLY}/${INCLUDE_DEADHEADS}`;
  const res = await fetch(url, {
    headers: { "Ocp-Apim-Subscription-Key": apiKey },
  });
  if (!res.ok) {
    throw new Error(`Avail Missed Trips request failed: ${res.status}`);
  }
  const payload = (await res.json()) as AvailMissedTripsEnvelope;
  if (!payload.success) {
    throw new Error(
      `Avail Missed Trips API returned success=false: ${payload.errors?.join(", ") || "no error detail"}`,
    );
  }
  const rows = payload.result?.missed;
  if (rows !== undefined) return rows;

  // Kept as a safety net even though the key is now confirmed - if Avail
  // ever changes it again, this stays loud instead of silently returning
  // zero rows.
  const actualKeys = payload.result ? Object.keys(payload.result) : [];
  if (actualKeys.length > 0) {
    throw new Error(
      `Avail Missed Trips response has no "missed" key under result - found [${actualKeys.join(", ")}] instead. Update the guessed key in availMissedTripsFeed.ts.`,
    );
  }
  return [];
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

    for (const m of mapped) {
      const insertReq = new sql.Request(tx);
      insertReq.input("service_month", sql.Char(6), m.service_month);
      insertReq.input("calendar_date", sql.Char(8), m.calendar_date);
      insertReq.input("route_id", sql.Int, m.route_id);
      insertReq.input("route_desc", sql.NVarChar, m.route_desc);
      insertReq.input("route_internet_name", sql.NVarChar, m.route_internet_name);
      insertReq.input("departure_stop_id", sql.Int, m.departure_stop_id);
      insertReq.input("departure_stop_name", sql.NVarChar, m.departure_stop_name);
      insertReq.input("arrival_stop_id", sql.Int, m.arrival_stop_id);
      insertReq.input("arrival_stop_name", sql.NVarChar, m.arrival_stop_name);
      insertReq.input("departure_missed", sql.Bit, m.departure_missed);
      insertReq.input("arrival_missed", sql.Bit, m.arrival_missed);
      insertReq.input("entire_trip_missed", sql.Bit, m.entire_trip_missed);
      insertReq.input("departure_trip_start_time", sql.DateTime2, m.departure_trip_start_time);
      await insertReq.query(`
        INSERT INTO AvailMissedTripsRouteStopDay (
          service_month, calendar_date, route_id, route_desc, route_internet_name,
          departure_stop_id, departure_stop_name, arrival_stop_id, arrival_stop_name,
          departure_missed, arrival_missed, entire_trip_missed, departure_trip_start_time
        )
        VALUES (
          @service_month, @calendar_date, @route_id, @route_desc, @route_internet_name,
          @departure_stop_id, @departure_stop_name, @arrival_stop_id, @arrival_stop_name,
          @departure_missed, @arrival_missed, @entire_trip_missed, @departure_trip_start_time
        )
      `);
    }

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
