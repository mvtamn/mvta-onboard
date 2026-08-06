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
import { formatDateMmDdYyyy } from "./otpMonthlyFeed";

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

function parseNullableDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
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
    departure_trip_start_time: parseNullableDate(report.DepartureTripStartTime),
  };
}
