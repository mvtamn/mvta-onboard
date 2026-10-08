// The Avail links a reviewer acts on.
//
// The adapter (avail.ts) decides how strongly a record ties to a case, and
// corroborates the case when the tie is exact. Two things it deliberately does
// not do belong here, because both need a record that outlives the run:
//
//   - A PROBABLE link changes nothing "until a reviewer confirms it" (ADR-0035,
//     CONTEXT "Evidence-match confidence"). Until now nothing was written down,
//     so the nightly run counted probable links, warned about them, and forgot
//     them: there was never anything to confirm. They are kept here, with the
//     reason they could not be placed, until somebody names the case or says no.
//   - A run that STOPS reporting a record used to say nothing at all. Avail
//     restates its trailing window every night, so a record vanishing is Avail
//     withdrawing it - and if it had corroborated a case, that is the only
//     warning the corroboration is gone.
//
// Links are keyed by the record's own tuple, because AvailMissedTripsRouteStopDay
// is deleted and re-inserted in full on every run.
import { sql } from "../../db";
import { availObservation, type AvailMatch, type AvailMissedTripRow, type MatchableCase, type MatchedAvailReport } from "./avail";
import { observeMissedTrips } from "../index";
import type { EvidenceMatchConfidence } from "../types";

/** One Avail record, how it was placed, and why. */
export interface AvailEvidenceLink {
  calendar_date: string;
  route_id: number;
  departure_stop_name: string | null;
  arrival_stop_name: string | null;
  departure_trip_start_time: Date | null;
  departure_missed: boolean;
  arrival_missed: boolean;
  entire_trip_missed: boolean;
  match_confidence: EvidenceMatchConfidence;
  candidate_count: number;
  match_reason: string;
  trip_id: string | null;
  service_date: string | null;
}

/**
 * Why the match came out the way it did, for the person who has to decide.
 * "Probable" on its own tells a reviewer nothing they can act on; the number of
 * cases it could be, and whether Avail gave a start time at all, does.
 */
export function matchReason(row: AvailMissedTripRow, match: AvailMatch): string {
  if (match.confidence === "exact") {
    return "Route, service date and start time name exactly one case.";
  }
  if (match.confidence === "unmatched") {
    return match.candidates === 0
      ? "No missed-trip case on that route and service date."
      : `${match.candidates} case(s) on that route and service date, none starting at the time Avail reported.`;
  }
  return row.departure_trip_start_time
    ? `${match.candidates} cases share that route, service date and start time.`
    : `Avail reported no start time. ${match.candidates} case(s) share that route and service date.`;
}

export function linkFor(row: AvailMissedTripRow, match: AvailMatch): AvailEvidenceLink {
  return {
    calendar_date: row.calendar_date,
    route_id: row.route_id,
    departure_stop_name: row.departure_stop_name,
    arrival_stop_name: row.arrival_stop_name,
    departure_trip_start_time: row.departure_trip_start_time,
    departure_missed: row.departure_missed,
    arrival_missed: row.arrival_missed,
    entire_trip_missed: row.entire_trip_missed,
    match_confidence: match.confidence,
    candidate_count: match.candidates,
    match_reason: matchReason(row, match),
    trip_id: match.matched?.trip_id ?? null,
    service_date: match.matched?.service_date ?? null,
  };
}

/** Every record in the run, as links. The adapter's matching rule, unchanged. */
export function linksFrom(matches: readonly MatchedAvailReport[]): AvailEvidenceLink[] {
  return matches.map(({ row, match }) => linkFor(row, match));
}

/** Migration 136's table; without it a run records no links and says so. */
export async function availLinksReady(pool: sql.ConnectionPool): Promise<boolean> {
  return (await pool.request().query<{ ready: number }>(
    `SELECT CASE WHEN OBJECT_ID('dbo.AvailEvidenceLinks','U') IS NULL THEN 0 ELSE 1 END ready`))
    .recordset[0]?.ready === 1;
}

export interface LinkWriteReport { written: number; retracted: number }

/**
 * Records this run's links and marks the ones it no longer saw.
 *
 * A reviewer's answer survives a run that found the same thing again. It does
 * not survive a run that places the record differently: that is no longer the
 * link they answered.
 */
export async function recordAvailLinks(
  pool: sql.ConnectionPool,
  links: readonly AvailEvidenceLink[],
  sinceDays: number,
  now = new Date(),
): Promise<LinkWriteReport> {
  const report: LinkWriteReport = { written: 0, retracted: 0 };
  for (const link of links) {
    await pool.request()
      .input("date", sql.Char(8), link.calendar_date)
      .input("route", sql.Int, link.route_id)
      .input("departure_stop", sql.NVarChar(200), link.departure_stop_name)
      .input("arrival_stop", sql.NVarChar(200), link.arrival_stop_name)
      .input("start", sql.DateTime2, link.departure_trip_start_time)
      .input("departure_missed", sql.Bit, link.departure_missed ? 1 : 0)
      .input("arrival_missed", sql.Bit, link.arrival_missed ? 1 : 0)
      .input("entire", sql.Bit, link.entire_trip_missed ? 1 : 0)
      .input("confidence", sql.NVarChar(20), link.match_confidence)
      .input("candidates", sql.Int, link.candidate_count)
      .input("reason", sql.NVarChar(500), link.match_reason)
      .input("trip", sql.NVarChar(100), link.trip_id)
      .input("service_date", sql.NVarChar(20), link.service_date)
      .input("run", sql.DateTime2, now)
      .query(`
        DECLARE @moved BIT;
        UPDATE dbo.AvailEvidenceLinks
        SET @moved = CASE WHEN match_confidence <> @confidence OR ISNULL(trip_id, N'') <> ISNULL(@trip, N'')
                          THEN 1 ELSE 0 END,
            departure_missed = @departure_missed, arrival_missed = @arrival_missed, entire_trip_missed = @entire,
            match_confidence = @confidence, candidate_count = @candidates, match_reason = @reason,
            -- A confirmed link keeps the case the reviewer named; an unresolved
            -- one follows the match.
            trip_id = CASE WHEN resolution = N'confirmed' THEN trip_id ELSE @trip END,
            service_date = CASE WHEN resolution = N'confirmed' THEN service_date ELSE @service_date END,
            resolution = CASE WHEN @moved = 1 THEN NULL ELSE resolution END,
            resolution_note = CASE WHEN @moved = 1 THEN NULL ELSE resolution_note END,
            resolved_by = CASE WHEN @moved = 1 THEN NULL ELSE resolved_by END,
            resolved_at = CASE WHEN @moved = 1 THEN NULL ELSE resolved_at END,
            last_seen_at = @run, retracted_at = NULL
        WHERE calendar_date = @date AND route_id = @route
          AND ISNULL(departure_stop_name, N'') = ISNULL(@departure_stop, N'')
          AND ISNULL(arrival_stop_name, N'') = ISNULL(@arrival_stop, N'')
          AND ((departure_trip_start_time IS NULL AND @start IS NULL) OR departure_trip_start_time = @start);

        IF @@ROWCOUNT = 0
          INSERT INTO dbo.AvailEvidenceLinks
            (calendar_date, route_id, departure_stop_name, arrival_stop_name, departure_trip_start_time,
             departure_missed, arrival_missed, entire_trip_missed, match_confidence, candidate_count,
             match_reason, trip_id, service_date, first_seen_at, last_seen_at)
          VALUES (@date, @route, @departure_stop, @arrival_stop, @start, @departure_missed, @arrival_missed,
                  @entire, @confidence, @candidates, @reason, @trip, @service_date, @run, @run);`);
    report.written++;
  }

  // Anything in the window this run did not stamp, Avail has withdrawn.
  report.retracted = (await pool.request()
    .input("run", sql.DateTime2, now)
    .input("since", sql.Int, sinceDays)
    .query(`
      UPDATE dbo.AvailEvidenceLinks
      SET retracted_at = @run
      WHERE retracted_at IS NULL AND last_seen_at < @run
        AND calendar_date >= CONVERT(CHAR(8), DATEADD(DAY, -@since, @run), 112)`)).rowsAffected[0] ?? 0;
  return report;
}

export interface StoredAvailLink extends AvailEvidenceLink {
  id: number;
  resolution: "confirmed" | "rejected" | null;
  resolution_note: string | null;
  resolved_by: string | null;
  resolved_at: Date | null;
  first_seen_at: Date;
  last_seen_at: Date;
  retracted_at: Date | null;
}

/**
 * The links a reviewer has something to do about: probable ones nobody has
 * answered, and corroboration Avail has since withdrawn.
 */
export async function outstandingAvailLinks(pool: sql.ConnectionPool): Promise<StoredAvailLink[]> {
  if (!(await availLinksReady(pool))) return [];
  return (await pool.request().query<StoredAvailLink>(`
    SELECT id, calendar_date, route_id, departure_stop_name, arrival_stop_name, departure_trip_start_time,
           departure_missed, arrival_missed, entire_trip_missed, match_confidence, candidate_count,
           match_reason, trip_id, service_date, resolution, resolution_note, resolved_by, resolved_at,
           first_seen_at, last_seen_at, retracted_at
    FROM dbo.AvailEvidenceLinks
    WHERE (match_confidence = N'probable' AND resolution IS NULL)
       OR (retracted_at IS NOT NULL AND trip_id IS NOT NULL)
    ORDER BY calendar_date DESC, route_id, departure_trip_start_time`)).recordset;
}

export type LinkResolutionRefusal =
  | "not_found"
  | "not_probable"
  | "already_resolved"
  | "case_required"
  | "case_not_a_candidate";

export interface ResolveInput {
  id: number;
  decision: "confirmed" | "rejected";
  /** Which case the record is about. Required to confirm. */
  tripId?: string | null;
  serviceDate?: string | null;
  note?: string | null;
  actor: string;
}

export type ResolveOutcome =
  | { ok: true; link: StoredAvailLink }
  | { ok: false; refusal: LinkResolutionRefusal; sentence: string };

const refuse = (refusal: LinkResolutionRefusal, sentence: string): ResolveOutcome => ({ ok: false, refusal, sentence });

/**
 * A reviewer's answer to a probable link. Confirming names the case, which is
 * the whole point: the adapter refused to guess between candidates, so the
 * person picks. The named case has to be one the record could be about - same
 * route and service date - or the confirmation would invent a link rather than
 * settle one.
 */
export async function resolveAvailLink(pool: sql.ConnectionPool, input: ResolveInput): Promise<ResolveOutcome> {
  const link = (await pool.request().input("id", sql.BigInt, input.id)
    .query<StoredAvailLink>("SELECT * FROM dbo.AvailEvidenceLinks WHERE id = @id")).recordset[0];
  if (!link) return refuse("not_found", "That Avail link was not found.");
  if (link.match_confidence !== "probable") {
    return refuse("not_probable", "Only a probable link waits on a reviewer. An exact link already corroborates its case.");
  }
  if (link.resolution) return refuse("already_resolved", `This link was already ${link.resolution}.`);

  if (input.decision === "rejected") {
    await pool.request()
      .input("id", sql.BigInt, input.id)
      .input("note", sql.NVarChar(500), input.note ?? null)
      .input("actor", sql.NVarChar(200), input.actor)
      .query(`UPDATE dbo.AvailEvidenceLinks
              SET resolution = N'rejected', resolution_note = @note, resolved_by = @actor,
                  resolved_at = SYSUTCDATETIME()
              WHERE id = @id`);
    return { ok: true, link: { ...link, resolution: "rejected", resolved_by: input.actor } };
  }

  if (!input.tripId || !input.serviceDate) {
    return refuse("case_required", "Name the case this Avail record is about.");
  }
  const candidate = (await pool.request()
    .input("trip", sql.NVarChar(100), input.tripId)
    .input("service_date", sql.NVarChar(20), input.serviceDate)
    .input("route", sql.Int, link.route_id)
    .input("date", sql.Char(8), link.calendar_date)
    .query<MatchableCase>(`
      SELECT trip_id, service_date, route_id, scheduled_departure_at FROM dbo.MonitoredMissedTrips
      WHERE trip_id = @trip AND service_date = @service_date
        AND TRY_CONVERT(INT, route_id) = @route AND LEFT(service_date, 8) = @date`)).recordset[0];
  if (!candidate) {
    return refuse("case_not_a_candidate",
      "That case is not on the route and service date this Avail record reports, so it cannot be the one it describes.");
  }

  await pool.request()
    .input("id", sql.BigInt, input.id)
    .input("trip", sql.NVarChar(100), input.tripId)
    .input("service_date", sql.NVarChar(20), input.serviceDate)
    .input("note", sql.NVarChar(500), input.note ?? null)
    .input("actor", sql.NVarChar(200), input.actor)
    .query(`UPDATE dbo.AvailEvidenceLinks
            SET resolution = N'confirmed', trip_id = @trip, service_date = @service_date,
                resolution_note = @note, resolved_by = @actor, resolved_at = SYSUTCDATETIME()
            WHERE id = @id`);

  // Confirming is the point at which the record starts corroborating the case.
  // The evidence says a person placed it, so nothing later reads it as a link
  // the match itself was sure of.
  const observation = availObservation(link, candidate);
  if (observation) {
    await observeMissedTrips(pool, [{
      ...observation,
      evidence: { ...(observation.evidence as Record<string, unknown>), matchConfidence: "probable", confirmedBy: input.actor },
    }]);
  }
  return { ok: true, link: { ...link, resolution: "confirmed", trip_id: input.tripId, service_date: input.serviceDate, resolved_by: input.actor } };
}
