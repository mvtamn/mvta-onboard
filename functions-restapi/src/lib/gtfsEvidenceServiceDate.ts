// Which service date a GTFS-RT observation belongs to when the feed does not say.
//
// MVTA's VehiclePosition feed often sends a trip with no start_date. Dating
// the evidence from the moment it was observed files a late trip's
// after-midnight reports under the next service date: route 495's 23:02 run
// still reporting at 00:04 wrote a first_underway_at about 23 hours ahead of
// the next day's own 23:02 run (45 rows on dev, 2026-09-11..10-22). That made
// the Dispatch Log show those runs as started ~23 hours early, and the
// missed-trip detector would read a genuinely missed late-night run as started.
//
// A trip_id is one scheduled run per service day, so the observation belongs
// to whichever run of that trip_id - on the day before, the day of, or the day
// after the observation, among the days its service runs - starts nearest to
// it. A trip the schedule does not know, or one whose service runs on none of
// those days, keeps the observation's date, as before.
import { sql } from "./db";
import { activeServiceIdsToday } from "./gtfsScheduleHorizon";
import { agencyServiceDate, serviceDateAndGtfsSecondsToUtc } from "./missedTripTime";

export interface ScheduledTripTiming {
  first_departure_seconds: number;
  service_id: string;
}

/** Whether `serviceId` runs on `serviceDate` (YYYYMMDD). */
export type ServiceRunsOn = (serviceDate: string, serviceId: string) => boolean;

const CANDIDATE_DAY_OFFSETS = [-1, 0, 1] as const;

export function evidenceServiceDate(
  observedAt: Date,
  trip: ScheduledTripTiming | null,
  runsOn: ServiceRunsOn,
): string {
  const observedDate = agencyServiceDate(observedAt).serviceDate;
  if (!trip) return observedDate;
  let best: { date: string; distance: number } | null = null;
  for (const offset of CANDIDATE_DAY_OFFSETS) {
    const date = agencyServiceDate(observedAt, offset).serviceDate;
    if (!runsOn(date, trip.service_id)) continue;
    const start = serviceDateAndGtfsSecondsToUtc(date, trip.first_departure_seconds);
    if (!start) continue;
    const distance = Math.abs(start.getTime() - observedAt.getTime());
    if (!best || distance < best.distance) best = { date, distance };
  }
  return best?.date ?? observedDate;
}

/**
 * Loads what evidenceServiceDate needs for one feed delivery and returns it
 * bound: the schedule timing of the observed trip ids, and the active service
 * ids of each candidate date, read once per date.
 */
export async function loadEvidenceServiceDates(
  pool: sql.ConnectionPool,
  observations: ReadonlyArray<{ trip_id: string; observedAt: Date }>,
): Promise<(tripId: string, observedAt: Date) => string> {
  const timings = new Map<string, ScheduledTripTiming>();
  const tripIds = [...new Set(observations.map((o) => o.trip_id))];
  // Batched well under SQL Server's 2,100-parameter limit.
  for (let i = 0; i < tripIds.length; i += 500) {
    const batch = tripIds.slice(i, i + 500);
    const req = pool.request();
    batch.forEach((id, j) => req.input(`t${j}`, sql.NVarChar, id));
    const result = await req.query<ScheduledTripTiming & { trip_id: string }>(`
      SELECT trip_id, service_id, first_departure_seconds
      FROM GtfsScheduledTrips
      WHERE trip_id IN (${batch.map((_, j) => `@t${j}`).join(", ")})
    `);
    for (const r of result.recordset) timings.set(r.trip_id, r);
  }

  const activeByDate = new Map<string, Set<string>>();
  for (const { observedAt } of observations) {
    for (const offset of CANDIDATE_DAY_OFFSETS) {
      const { serviceDate, dow } = agencyServiceDate(observedAt, offset);
      if (activeByDate.has(serviceDate)) continue;
      activeByDate.set(serviceDate, new Set(await activeServiceIdsToday(pool, serviceDate, dow)));
    }
  }
  const runsOn: ServiceRunsOn = (date, serviceId) => activeByDate.get(date)?.has(serviceId) ?? false;
  return (tripId, observedAt) => evidenceServiceDate(observedAt, timings.get(tripId) ?? null, runsOn);
}
