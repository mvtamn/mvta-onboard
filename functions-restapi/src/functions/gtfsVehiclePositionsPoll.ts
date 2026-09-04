// Timer-triggered ingestion of MVTA's GTFS-Realtime VehiclePosition feed.
//
// Purely monitoring data (live GPS, speed, occupancy, stop status) - no
// alerting concept, nothing here ever escalates into SuggestedAlerts.
// Updates the same MonitoredTripDelays row gtfsDelaysPoll.ts maintains
// (matched by trip_id, since both feeds cover the identical set of active
// trips), but only UPDATEs its own position/occupancy columns - never
// inserts. If a position reading arrives before TripUpdate has created the
// row for that trip, it's skipped: inserting here would need a placeholder
// delay_seconds that could misleadingly look like a verified on-time
// reading.
import { app, type InvocationContext, type Timer } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { fetchVehiclePositionFeed, mapVehiclePositionEntity } from "../lib/gtfsVehiclePositions";
import { agencyServiceDate } from "../lib/missedTripTime";
import { feedHealthOutcome, recordFeedFailure, recordFeedHealth } from "../lib/kpiFeedHealth";

app.timer("gtfsVehiclePositionsPoll", {
  schedule: "0 */5 * * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    const feedUrl = process.env.GTFS_RT_VEHICLE_URL;
    if (!feedUrl) {
      context.warn("GTFS_RT_VEHICLE_URL is not configured - skipping this run.");
      return;
    }

    let feed;
    try {
      feed = await fetchVehiclePositionFeed(feedUrl);
    } catch (err) {
      // Returning without recording leaves the ledger on its last success, so
      // a feed that has been failing for hours reads exactly like one that is
      // merely between runs. gtfs_vehicle_positions is required by the
      // fixed-route missed-trip contract, and it supplies the underway
      // evidence that keeps a running trip from being called a no-show.
      context.error("Failed to fetch GTFS-RT VehiclePosition feed:", err);
      try {
        await recordFeedFailure(await getPool(), "gtfs_vehicle_positions", err);
      } catch (healthError) {
        context.error("Failed to record VehiclePosition feed failure:", healthError);
      }
      return;
    }

    const pool = await getPool();
    const evidenceCheck = await pool.request().query<{ table_exists: number }>(`
      SELECT CASE WHEN OBJECT_ID('dbo.GtfsTripOperationalEvidence', 'U') IS NULL THEN 0 ELSE 1 END AS table_exists
    `);
    const evidenceTableExists = evidenceCheck.recordset[0]?.table_exists === 1;
    let updatedCount = 0;
    let evidenceCount = 0;
    // mapVehiclePositionEntity returns null without a Trip, so every mapped
    // entity is one this run was expected to record evidence for. A deadheading
    // vehicle never reaches this count.
    let evidenceEligible = 0;

    for (const entity of feed.Entities) {
      let mapped;
      try {
        mapped = mapVehiclePositionEntity(entity);
      } catch (err) {
        context.error(`Failed to map GTFS-RT vehicle position entity ${entity.Id}:`, err);
        continue;
      }
      if (!mapped) continue;

      if (evidenceTableExists) {
        evidenceEligible++;
        try {
          const observedAt = mapped.source_timestamp_at ?? new Date();
          const serviceDate = mapped.service_date ?? agencyServiceDate(observedAt).serviceDate;
          const evidenceReq = pool.request();
          evidenceReq.input("trip_id", sql.NVarChar, mapped.trip_id);
          evidenceReq.input("service_date", sql.NVarChar, serviceDate);
          evidenceReq.input("route_id", sql.NVarChar, mapped.route_id);
          evidenceReq.input("vehicle_id", sql.NVarChar, mapped.vehicle_id);
          evidenceReq.input("observed_at", sql.DateTime2, observedAt);
          evidenceReq.input("current_stop_sequence", sql.Int, mapped.current_stop_sequence);
          evidenceReq.input("current_stop_id", sql.NVarChar, mapped.current_stop_id);
          evidenceReq.input("current_status", sql.Int, mapped.current_status);
          await evidenceReq.query(`
            DECLARE @first_stop_sequence INT = (
              SELECT first_stop_sequence FROM GtfsScheduledTrips WHERE trip_id = @trip_id
            );
            DECLARE @is_underway BIT = CASE
              WHEN @first_stop_sequence IS NOT NULL
                AND @current_stop_sequence IS NOT NULL
                AND @current_stop_sequence > @first_stop_sequence
              THEN 1 ELSE 0 END;

            MERGE GtfsTripOperationalEvidence WITH (HOLDLOCK) AS target
            USING (SELECT @trip_id AS trip_id, @service_date AS service_date) AS src
            ON target.trip_id = src.trip_id AND target.service_date = src.service_date
            WHEN MATCHED THEN UPDATE SET
              route_id = @route_id,
              vehicle_id = COALESCE(@vehicle_id, target.vehicle_id),
              -- Sticky, like first_underway_at below. Setting this only in the
              -- INSERT branch left it null on almost every row: the TripUpdate
              -- poller usually creates the evidence row first (predictions
              -- precede movement), so this MERGE lands here rather than there
              -- and the column recorded nothing even while positions flowed.
              first_vehicle_position_at = COALESCE(target.first_vehicle_position_at, @observed_at),
              last_vehicle_position_at = @observed_at,
              first_underway_at = CASE
                WHEN target.first_underway_at IS NOT NULL THEN target.first_underway_at
                WHEN @is_underway = 1 THEN @observed_at
                ELSE NULL END,
              current_stop_sequence = @current_stop_sequence,
              current_stop_id = @current_stop_id,
              current_status = @current_status,
              source_timestamp_at = @observed_at,
              updated_at = SYSUTCDATETIME()
            WHEN NOT MATCHED THEN INSERT (
              trip_id, service_date, route_id, vehicle_id,
              first_vehicle_position_at, last_vehicle_position_at, first_underway_at,
              current_stop_sequence, current_stop_id, current_status, source_timestamp_at
            ) VALUES (
              @trip_id, @service_date, @route_id, @vehicle_id,
              @observed_at, @observed_at, CASE WHEN @is_underway = 1 THEN @observed_at ELSE NULL END,
              @current_stop_sequence, @current_stop_id, @current_status, @observed_at
            );
          `);
          evidenceCount++;
        } catch (err) {
          context.error(`Failed to record vehicle-position evidence for trip ${mapped.trip_id}:`, err);
        }
      }

      try {
        const request = pool.request();
        request.input("trip_id", sql.NVarChar, mapped.trip_id);
        request.input("latitude", sql.Float, mapped.latitude);
        request.input("longitude", sql.Float, mapped.longitude);
        request.input("bearing", sql.Float, mapped.bearing);
        request.input("speed_mps", sql.Float, mapped.speed_mps);
        request.input("occupancy_status", sql.Int, mapped.occupancy_status);
        request.input("current_status", sql.Int, mapped.current_status);
        const result = await request.query(`
          UPDATE MonitoredTripDelays
          SET latitude = @latitude,
              longitude = @longitude,
              bearing = @bearing,
              speed_mps = @speed_mps,
              occupancy_status = @occupancy_status,
              current_status = @current_status,
              position_updated_at = SYSUTCDATETIME()
          WHERE trip_id = @trip_id
        `);
        if (result.rowsAffected[0] > 0) updatedCount++;
      } catch (err) {
        context.error(`Failed to update position for trip ${mapped.trip_id}:`, err);
      }
    }

    context.log(
      `GTFS-RT VehiclePosition poll: ${feed.Entities.length} entities seen, ${updatedCount} delay rows updated, ` +
        `${evidenceCount} operational-evidence rows recorded.`,
    );
    if (!evidenceTableExists) {
      context.warn("GtfsTripOperationalEvidence does not exist; apply migration 027 to capture missed-trip start evidence.");
    }

    // This ledger row is not just a delivery receipt. underwayEvidenceCoverage
    // resolves it to decide whether the silent-no-show detector may treat
    // missing evidence as a real no-show, so recording success here asserts
    // that the evidence this run was supposed to write exists. It used to be
    // recorded before the write loop ran, from the entity count, which asserted
    // that regardless of whether a single evidence row landed - and a run whose
    // evidence writes all failed would leave coverage proven while the table
    // stood still, turning every unstarted trip into a manufactured no-show.
    // That is the failure the coverage guard was added to prevent.
    //
    // Failing closed instead makes coverage unproven, so those trips are
    // recorded as unknown_data_gap and wait for evidence. gtfs_vehicle_positions
    // is only supporting for fixed_route_delay, so the delay stream keeps its
    // reduced context rather than being invalidated.
    const outcome = evidenceTableExists
      ? feedHealthOutcome(evidenceEligible, evidenceCount, "vehicle positions")
      : ({ kind: "health", entityCount: feed.Entities.length, unstoredCount: 0 } as const);
    if (outcome.kind === "failure") {
      context.error(`GTFS-RT VehiclePosition poll: ${outcome.reason}`);
      try {
        await recordFeedFailure(pool, "gtfs_vehicle_positions", new Error(outcome.reason));
      } catch (healthError) {
        context.error("Failed to record VehiclePosition feed failure:", healthError);
      }
      return;
    }
    if (outcome.unstoredCount > 0) {
      context.warn(`GTFS-RT VehiclePosition poll: evidence was not recorded for ${outcome.unstoredCount} of ${evidenceEligible} positions.`);
    }
    try {
      await recordFeedHealth(
        pool,
        "gtfs_vehicle_positions",
        outcome.entityCount,
        feed.Header?.Timestamp ?? null,
      );
    } catch (err) {
      context.error("Failed to update VehiclePosition feed health:", err);
    }
  },
});
