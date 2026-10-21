// The nightly score in and out of SQL (migration 147). Only tallies are kept;
// the raw capture stays in Blob storage for 90 days, so a day can be scored
// again (replacing its rows) for as long as its file exists.
import { sql } from "../db";
import type { DayScore } from "./score";

export async function predictionAccuracyReady(pool: sql.ConnectionPool): Promise<boolean> {
  const result = await pool.request().query<{ ready: number }>(
    "SELECT CASE WHEN OBJECT_ID('dbo.PredictionAccuracyDays', 'U') IS NULL THEN 0 ELSE 1 END AS ready",
  );
  return result.recordset[0]?.ready === 1;
}

/** Each trip's GTFS direction_id, from the static sync's reference table. */
export async function loadTripDirections(pool: sql.ConnectionPool): Promise<Map<string, number>> {
  const result = await pool.request().query<{ trip_id: string; direction_id: number }>(
    "SELECT trip_id, direction_id FROM GtfsTripDirections",
  );
  return new Map(result.recordset.map((row) => [row.trip_id, row.direction_id]));
}

/** Service dates (yyyymmdd) from `from` onward that already have a score. */
export async function scoredServiceDates(pool: sql.ConnectionPool, from: string): Promise<Set<string>> {
  const result = await pool.request()
    .input("from", sql.Char(8), from)
    .query<{ service_date: string }>("SELECT service_date FROM dbo.PredictionAccuracyDays WHERE service_date >= @from");
  return new Set(result.recordset.map((row) => row.service_date));
}

/** Replace one service day's score. */
export async function writeDayScore(pool: sql.ConnectionPool, day: DayScore, unreadableLines: number, scoredAt: Date): Promise<void> {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    for (const table of ["PredictionAccuracyRouteHours", "PredictionAccuracyStops", "PredictionAccuracyDays"]) {
      await new sql.Request(tx).input("date", sql.Char(8), day.serviceDate).query(`DELETE FROM dbo.${table} WHERE service_date = @date`);
    }

    await new sql.Request(tx)
      .input("date", sql.Char(8), day.serviceDate)
      .input("scoredAt", sql.DateTime2, scoredAt)
      .input("runs", sql.Int, day.runs)
      .input("staleRuns", sql.Int, day.staleRuns)
      .input("samples", sql.Int, day.samples)
      .input("duplicate", sql.Int, day.duplicate)
      .input("stale", sql.Int, day.stale)
      .input("passed", sql.Int, day.passed)
      .input("outOfRange", sql.Int, day.outOfRange)
      .input("noVehicle", sql.Int, day.noActual.noVehicle)
      .input("unseen", sql.Int, day.noActual.unseen)
      .input("notReached", sql.Int, day.noActual.notReached)
      .input("gap", sql.Int, day.noActual.gap)
      .input("indeterminate", sql.Int, day.indeterminate)
      .input("scored", sql.Int, day.scored)
      .input("actuals", sql.Int, day.actuals)
      .input("compared", sql.Int, day.crossCheck.compared)
      .input("agreed", sql.Int, day.crossCheck.agreed)
      .input("offset", sql.Int, day.crossCheck.medianOffsetSeconds)
      .input("unreadable", sql.Int, unreadableLines)
      .query(`
        INSERT INTO dbo.PredictionAccuracyDays (
          service_date, scored_at, capture_runs, stale_runs, samples, duplicate_samples, stale_samples, passed_samples,
          out_of_range, no_vehicle, no_actual_unseen, no_actual_not_reached, no_actual_gap, indeterminate, scored, actuals,
          cross_check_compared, cross_check_agreed, cross_check_median_offset_seconds, unreadable_lines
        ) VALUES (
          @date, @scoredAt, @runs, @staleRuns, @samples, @duplicate, @stale, @passed,
          @outOfRange, @noVehicle, @unseen, @notReached, @gap, @indeterminate, @scored, @actuals,
          @compared, @agreed, @offset, @unreadable
        )`);

    const hours = new sql.Table("PredictionAccuracyRouteHours");
    hours.columns.add("service_date", sql.Char(8), { nullable: false });
    hours.columns.add("route_id", sql.NVarChar(50), { nullable: false });
    hours.columns.add("direction_id", sql.TinyInt, { nullable: true });
    hours.columns.add("hour_of_day", sql.TinyInt, { nullable: false });
    hours.columns.add("bucket", sql.VarChar(5), { nullable: false });
    for (const c of ["predictions", "accurate", "early", "late", "indeterminate"]) hours.columns.add(c, sql.Int, { nullable: false });
    for (const r of day.routeHours) {
      hours.rows.add(day.serviceDate, r.routeId, r.directionId, r.hour, r.bucket, r.predictions, r.accurate, r.early, r.late, r.indeterminate);
    }
    if (day.routeHours.length > 0) await new sql.Request(tx).bulk(hours);

    const stops = new sql.Table("PredictionAccuracyStops");
    stops.columns.add("service_date", sql.Char(8), { nullable: false });
    stops.columns.add("route_id", sql.NVarChar(50), { nullable: false });
    stops.columns.add("stop_id", sql.NVarChar(50), { nullable: false });
    stops.columns.add("bucket", sql.VarChar(5), { nullable: false });
    for (const c of ["predictions", "accurate", "early", "late", "indeterminate"]) stops.columns.add(c, sql.Int, { nullable: false });
    for (const s of day.stops) {
      stops.rows.add(day.serviceDate, s.routeId, s.stopId, s.bucket, s.predictions, s.accurate, s.early, s.late, s.indeterminate);
    }
    if (day.stops.length > 0) await new sql.Request(tx).bulk(stops);

    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}
