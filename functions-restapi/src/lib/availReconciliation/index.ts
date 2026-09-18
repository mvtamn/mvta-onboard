// Retrospective reconciliation: placing Avail's missed-trip report against the
// Missed-trip cases OnBoard holds, and keeping the result.
//
//   matchIncident            - which case an incident is about, and how sure
//                              we are (match.ts; pure)
//   reconcileAvailEvidence   - runs the matcher over a window and records the
//                              links, including the ones that found nothing
//   availEvidenceFor         - the links on one case, for review
//
// Avail never opens a case and never confirms one (ADR-0036). This writes
// links; what a reviewer sees and what an unresolved conflict blocks are the
// increments after this one.
import { sql } from "../db";
import { matchIncident } from "./match";
import type { AvailIncident, CaseCandidate, IncidentMatch, MatchConfidence } from "./types";

export * from "./types";
export { matchIncident } from "./match";

export interface ReconcileReport {
  incidents: number;
  exact: number;
  probable: number;
  unmatched: number;
  /** Links the feed stopped reporting on this run. */
  missing: number;
}

interface IncidentRow extends AvailIncident {
  arrival_stop_id: number | null;
}

/** Migration 135's table; without it there is nothing to reconcile into. */
export async function sourceLinksReady(pool: sql.ConnectionPool): Promise<boolean> {
  return (await pool.request().query<{ ready: number }>(
    `SELECT CASE WHEN OBJECT_ID('dbo.MissedTripSourceLinks','U') IS NULL THEN 0 ELSE 1 END ready`))
    .recordset[0]?.ready === 1;
}

async function readIncidents(pool: sql.ConnectionPool, months: readonly string[]): Promise<IncidentRow[]> {
  const list = months.map((m, i) => `@m${i}`).join(",");
  const request = pool.request();
  months.forEach((m, i) => request.input(`m${i}`, sql.Char(6), m));
  return (await request.query<IncidentRow>(`
    SELECT calendar_date, route_id, departure_stop_id, arrival_stop_id, departure_trip_start_time,
           departure_missed, arrival_missed, entire_trip_missed
    FROM dbo.AvailMissedTripsRouteStopDay
    WHERE service_month IN (${list})`)).recordset;
}

async function readCases(pool: sql.ConnectionPool, months: readonly string[]): Promise<CaseCandidate[]> {
  const list = months.map((m, i) => `@m${i}`).join(",");
  const request = pool.request();
  months.forEach((m, i) => request.input(`m${i}`, sql.Char(6), m));
  // The first stop comes from the current schedule, which the daily sync
  // overwrites. A trip it no longer holds downgrades a match to probable
  // rather than failing it - the case's own scheduled start still stands.
  return (await request.query<CaseCandidate>(`
    SELECT m.trip_id, m.service_date, m.route_id, m.scheduled_departure_at, s.first_stop_id
    FROM dbo.MonitoredMissedTrips m
    LEFT JOIN dbo.GtfsScheduledTrips s ON s.trip_id = m.trip_id
    WHERE LEFT(m.service_date, 6) IN (${list})
      AND ISNULL(m.source_system, N'gtfs') <> N'spare'`)).recordset;
}

/**
 * Matches every Avail incident in the window and records the result.
 *
 * Links are keyed by the incident's natural tuple, because the Avail table is
 * rebuilt in full every night. A run stamps every link it saw; anything in the
 * window it did not see is marked missing rather than deleted, and a link that
 * comes back is un-marked.
 */
export async function reconcileAvailEvidence(
  pool: sql.ConnectionPool,
  months: readonly string[],
  now = new Date(),
): Promise<ReconcileReport> {
  const report: ReconcileReport = { incidents: 0, exact: 0, probable: 0, unmatched: 0, missing: 0 };
  if (months.length === 0) return report;
  const [incidents, cases] = await Promise.all([readIncidents(pool, months), readCases(pool, months)]);
  report.incidents = incidents.length;

  for (const incident of incidents) {
    const match: IncidentMatch = matchIncident(incident, cases);
    report[match.confidence as MatchConfidence]++;
    await pool.request()
      .input("date", sql.Char(8), incident.calendar_date)
      .input("route", sql.Int, incident.route_id)
      .input("departure_stop", sql.Int, incident.departure_stop_id)
      .input("arrival_stop", sql.Int, incident.arrival_stop_id)
      .input("start", sql.DateTime2, incident.departure_trip_start_time)
      .input("trip", sql.NVarChar(100), match.trip_id)
      .input("service_date", sql.NVarChar(20), match.service_date)
      .input("confidence", sql.NVarChar(20), match.confidence)
      .input("finding", sql.NVarChar(30), match.finding)
      .input("reason", sql.NVarChar(500), match.reason)
      .input("run", sql.DateTime2, now)
      .query(`
        UPDATE dbo.MissedTripSourceLinks
        SET trip_id = @trip, service_date = @service_date, match_confidence = @confidence,
            finding = @finding, match_reason = @reason, last_seen_at = @run, missing_since = NULL,
            -- A link that now points somewhere else is not the link the
            -- reviewer agreed to, so their confirmation does not carry over.
            confirmation = CASE WHEN ISNULL(trip_id, N'') <> ISNULL(@trip, N'') OR match_confidence <> @confidence
                                THEN NULL ELSE confirmation END,
            confirmed_by = CASE WHEN ISNULL(trip_id, N'') <> ISNULL(@trip, N'') OR match_confidence <> @confidence
                                THEN NULL ELSE confirmed_by END,
            confirmed_at = CASE WHEN ISNULL(trip_id, N'') <> ISNULL(@trip, N'') OR match_confidence <> @confidence
                                THEN NULL ELSE confirmed_at END
        WHERE source = N'avail' AND incident_service_date = @date AND incident_route_id = @route
          AND ISNULL(incident_departure_stop_id, -1) = ISNULL(@departure_stop, -1)
          AND ISNULL(incident_arrival_stop_id, -1) = ISNULL(@arrival_stop, -1)
          AND ((incident_start_at IS NULL AND @start IS NULL) OR incident_start_at = @start);

        IF @@ROWCOUNT = 0
          INSERT INTO dbo.MissedTripSourceLinks
            (source, incident_service_date, incident_route_id, incident_departure_stop_id,
             incident_arrival_stop_id, incident_start_at, trip_id, service_date,
             match_confidence, finding, match_reason, first_seen_at, last_seen_at)
          VALUES (N'avail', @date, @route, @departure_stop, @arrival_stop, @start, @trip, @service_date,
                  @confidence, @finding, @reason, @run, @run);`);
  }

  // Anything in the window this run did not stamp is no longer reported.
  const list = months.map((m, i) => `@m${i}`).join(",");
  const sweep = pool.request().input("run", sql.DateTime2, now);
  months.forEach((m, i) => sweep.input(`m${i}`, sql.Char(6), m));
  report.missing = (await sweep.query(`
    UPDATE dbo.MissedTripSourceLinks
    SET missing_since = @run
    WHERE source = N'avail' AND LEFT(incident_service_date, 6) IN (${list})
      AND last_seen_at < @run AND missing_since IS NULL`)).rowsAffected[0] ?? 0;

  return report;
}

export interface CaseEvidenceLink {
  match_confidence: MatchConfidence;
  finding: string;
  match_reason: string;
  confirmation: "confirmed" | "rejected" | null;
  confirmed_by: string | null;
  confirmed_at: Date | null;
  incident_route_id: number;
  incident_start_at: Date | null;
  last_seen_at: Date;
  missing_since: Date | null;
}

/** The Avail evidence on one case, for the reviewer looking at it. */
export async function availEvidenceFor(
  pool: sql.ConnectionPool,
  tripId: string,
  serviceDate: string,
): Promise<CaseEvidenceLink[]> {
  if (!(await sourceLinksReady(pool))) return [];
  return (await pool.request()
    .input("trip", sql.NVarChar(100), tripId)
    .input("service_date", sql.NVarChar(20), serviceDate)
    .query<CaseEvidenceLink>(`
      SELECT match_confidence, finding, match_reason, confirmation, confirmed_by, confirmed_at,
             incident_route_id, incident_start_at, last_seen_at, missing_since
      FROM dbo.MissedTripSourceLinks
      WHERE source = N'avail' AND trip_id = @trip AND service_date = @service_date
      ORDER BY CASE match_confidence WHEN N'exact' THEN 0 ELSE 1 END, incident_start_at`)).recordset;
}
