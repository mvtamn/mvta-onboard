// Placing an Avail incident against a Missed-trip case.
//
// The two systems do not share a key. Avail reports route, stop, day and a
// scheduled start; a case is a trip id on a service date. So this is matching,
// and CONTEXT already says what matching must produce: exact, probable, or
// unmatched - with probable never affecting a case until a reviewer confirms it.
//
// Incidents are matched against CASES, not against the schedule. The schedule is
// overwritten by the daily GTFS sync, so a case from last Tuesday can no longer
// be resolved through it reliably (CONTEXT defines Schedule snapshot as retained;
// nothing implements it yet). The case carries its own scheduled start, stamped
// when it opened, which is the fact Avail is being compared against.
import type { AvailFinding, AvailIncident, CaseCandidate, IncidentMatch } from "./types";

const toMinute = (at: Date) => Math.floor(at.getTime() / 60_000);

function findingOf(incident: AvailIncident): AvailFinding {
  return incident.entire_trip_missed ? "missed_trip" : "partial_service";
}

const unmatched = (incident: AvailIncident, reason: string): IncidentMatch => ({
  confidence: "unmatched", finding: findingOf(incident), trip_id: null, service_date: null, reason,
});

/**
 * Which case this incident is about, and how sure we are.
 *
 * Exact needs three things to agree: the service date, the route, and the
 * scheduled start to the minute - and the first stop Avail names has to be the
 * one the trip starts at. Everything that agrees on time but not on stop is
 * probable: it is very likely the same trip, and a reviewer says so.
 */
export function matchIncident(incident: AvailIncident, cases: readonly CaseCandidate[]): IncidentMatch {
  const finding = findingOf(incident);
  const sameDay = cases.filter((c) =>
    c.service_date.slice(0, 8) === incident.calendar_date &&
    Number(c.route_id) === incident.route_id);
  if (sameDay.length === 0) {
    return unmatched(incident, "No Missed-trip case on that route and service date.");
  }

  if (!incident.departure_trip_start_time) {
    // Without a start time the day and route are all there is. One case is a
    // probable link; several cannot be told apart.
    if (sameDay.length === 1) {
      return { confidence: "probable", finding, trip_id: sameDay[0].trip_id, service_date: sameDay[0].service_date,
        reason: "Avail reported no start time. The route and service date name one case." };
    }
    return unmatched(incident, `Avail reported no start time, and ${sameDay.length} cases share that route and service date.`);
  }

  const minute = toMinute(incident.departure_trip_start_time);
  const sameStart = sameDay.filter((c) => toMinute(c.scheduled_departure_at) === minute);
  if (sameStart.length === 0) {
    return unmatched(incident, "No case on that route and service date starts at the time Avail reported.");
  }
  if (sameStart.length > 1) {
    // A link that cannot name one case is not a link. Saying so beats guessing.
    return unmatched(incident, `${sameStart.length} cases share that route, service date and start time.`);
  }

  const candidate = sameStart[0];
  const placed = { trip_id: candidate.trip_id, service_date: candidate.service_date };
  if (incident.departure_stop_id === null) {
    return { confidence: "probable", finding, ...placed,
      reason: "Route, service date and start time agree. Avail named no departure stop." };
  }
  if (candidate.first_stop_id === null) {
    return { confidence: "probable", finding, ...placed,
      reason: "Route, service date and start time agree. The schedule no longer holds this trip's first stop." };
  }
  if (candidate.first_stop_id !== String(incident.departure_stop_id)) {
    return { confidence: "probable", finding, ...placed,
      reason: `Route, service date and start time agree, but Avail's departure stop (${incident.departure_stop_id}) is not the trip's first stop (${candidate.first_stop_id}).` };
  }
  return { confidence: "exact", finding, ...placed,
    reason: "Route, service date, start time and departure stop all agree." };
}
