import { agencyMinuteOfDay } from "./missedTripTime";

// When fixed-route trips can be relied on to be running, in agency-local time.
//
// Fixed route operates from 4am to midnight, but the TripUpdate feed's own
// record is what decides where an empty result is suspicious rather than
// normal. Over the seven days to 2026-09-14 (App Insights, gtfsDelaysPoll,
// every poll bucketed by Chicago half-hour):
//   - empty polls happened only between 00:30 and 02:59;
//   - between 04:00 and 21:59 every poll carried at least 7 trips, most far
//     more (65+ at midday);
//   - late in the evening the feed thins to 2-4 trips (22:30-23:59) and in
//     the small hours to 4-6 (02:30-03:59).
// The warning is decided by monitored trips, which can be fewer than the
// feed's entities (not every entity maps to a monitored trip), so the thin
// shoulders are left out: a window reaching 11pm would warn on a quiet
// late-evening poll that is really fine. Inside this window, no monitored
// trips is a problem to check.
export const FIXED_ROUTE_TRIPS_EXPECTED = {
  from: "04:00",
  until: "22:00",
  timeZone: "America/Chicago",
} as const;

function minuteOf(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return hours * 60 + minutes;
}

export function fixedRouteTripsExpected(now: Date): boolean {
  const minute = agencyMinuteOfDay(now);
  return minute >= minuteOf(FIXED_ROUTE_TRIPS_EXPECTED.from) && minute < minuteOf(FIXED_ROUTE_TRIPS_EXPECTED.until);
}
