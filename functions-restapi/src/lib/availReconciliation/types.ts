// Vocabulary for reconciling Avail's retrospective missed-trip report with the
// Missed-trip cases OnBoard already holds (CONTEXT.md "Retrospective
// reconciliation", "Evidence-match confidence", "Evidence conflict").

/** One incident row as Avail reported it, at route/stop/day grain. */
export interface AvailIncident {
  /** Service date key (YYYYMMDD). */
  calendar_date: string;
  route_id: number;
  departure_stop_id: number | null;
  /** The scheduled start Avail reports for the trip, in UTC. */
  departure_trip_start_time: Date | null;
  departure_missed: boolean;
  arrival_missed: boolean;
  entire_trip_missed: boolean;
}

/** A Missed-trip case an incident could be about. */
export interface CaseCandidate {
  trip_id: string;
  service_date: string;
  route_id: string;
  scheduled_departure_at: Date;
  /** From the current schedule, when it still has the trip. */
  first_stop_id: string | null;
}

/**
 * CONTEXT: the recorded strength of a cross-system link. Probable links require
 * reviewer confirmation before affecting a case; unmatched links affect nothing
 * but are still recorded, because "Avail reported this and we could not place
 * it" is a fact about the feed.
 */
export type MatchConfidence = "exact" | "probable" | "unmatched";

/** What the incident says happened, in the case module's language. */
export type AvailFinding = "missed_trip" | "partial_service";

export interface IncidentMatch {
  confidence: MatchConfidence;
  finding: AvailFinding;
  /** The case this incident is about; null when nothing could be placed. */
  trip_id: string | null;
  service_date: string | null;
  /** Why it matched the way it did, in words a reviewer can act on. */
  reason: string;
}
