import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parseConnectionString, sql } from "./db";

// Migration 165 against a real SQL Server (the CI contract job's container):
// it moves back only the rows whose position was stamped 30-60 minutes after
// the write that stored it, moves a case's arrival time only where it came from
// such a row, keeps the old values, and changes nothing when run again.
//
// Tables are built by hand to the columns the migration uses (migrations 011,
// 027). See subscriberResend.db.contract.test.ts on why the contract job runs
// one file at a time.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;

const DROP = `
IF OBJECT_ID('dbo.MonitoredMissedTrips','U') IS NOT NULL DROP TABLE dbo.MonitoredMissedTrips;
IF OBJECT_ID('dbo.GtfsTripOperationalEvidence','U') IS NOT NULL DROP TABLE dbo.GtfsTripOperationalEvidence;
IF OBJECT_ID('dbo.GtfsTripOperationalEvidenceClockSkew','U') IS NOT NULL DROP TABLE dbo.GtfsTripOperationalEvidenceClockSkew;
`;

const CREATE = `
CREATE TABLE dbo.GtfsTripOperationalEvidence (
  trip_id NVARCHAR(100) NOT NULL, service_date NVARCHAR(20) NOT NULL, vehicle_id NVARCHAR(100) NULL,
  first_vehicle_position_at DATETIME2 NULL, last_vehicle_position_at DATETIME2 NULL, first_underway_at DATETIME2 NULL,
  source_timestamp_at DATETIME2 NULL, updated_at DATETIME2 NULL,
  CONSTRAINT PK_GtfsTripOperationalEvidence PRIMARY KEY (trip_id, service_date)
);
CREATE TABLE dbo.MonitoredMissedTrips (
  trip_id NVARCHAR(100) NOT NULL, service_date NVARCHAR(20) NOT NULL, detected_late_arrival_at DATETIME2 NULL,
  CONSTRAINT PK_MonitoredMissedTrips PRIMARY KEY (trip_id, service_date)
);
`;

async function applyMigration(pool: sql.ConnectionPool) {
  const migration = readFileSync(join(process.cwd(), "sql", "migration-165-repair-future-stamped-vehicle-evidence.sql"), "utf8");
  for (const batch of migration.split(/^\s*GO\s*$/m)) {
    if (batch.trim()) await pool.request().batch(batch);
  }
}

const at = (iso: string) => new Date(`2026-11-03T${iso}Z`);
const DAY = "20261103";

interface Row { trip: string; firstVp: Date; lastVp: Date; underway: Date | null; updated: Date }

// SKEWED is t483-b4-sl1C-v65's row as dev held it.
const ROWS: Row[] = [
  { trip: "SKEWED", firstVp: at("19:09:46"), lastVp: at("19:19:45"), underway: at("19:09:46"), updated: at("18:35:15") },
  { trip: "NORMAL", firstVp: at("18:09:38"), lastVp: at("18:19:38"), underway: at("18:09:38"), updated: at("18:20:07") },
  // Ten minutes ahead is not an hour-off clock; the migration leaves it.
  { trip: "FAST", firstVp: at("17:30:00"), lastVp: at("17:45:00"), underway: null, updated: at("17:35:00") },
];

test("migration 165 moves back only future-stamped evidence, once", { skip: !connectionString }, async () => {
  if (!connectionString) return;
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString)).connect();
  try {
    await pool.request().batch(DROP);
    await pool.request().batch(CREATE);
    for (const r of ROWS) {
      await pool.request()
        .input("trip", sql.NVarChar(100), r.trip).input("day", sql.NVarChar(20), DAY)
        .input("first", sql.DateTime2, r.firstVp).input("last", sql.DateTime2, r.lastVp)
        .input("underway", sql.DateTime2, r.underway).input("updated", sql.DateTime2, r.updated)
        .query(`INSERT dbo.GtfsTripOperationalEvidence (trip_id, service_date, vehicle_id, first_vehicle_position_at, last_vehicle_position_at, first_underway_at, source_timestamp_at, updated_at)
                VALUES (@trip, @day, N'4850', @first, @last, @underway, @last, @updated)`);
    }
    // SKEWED's case took its arrival from the skewed underway; NORMAL's did not.
    await pool.request().input("day", sql.NVarChar(20), DAY).input("a", sql.DateTime2, at("19:09:46")).input("b", sql.DateTime2, at("19:30:00"))
      .query(`INSERT dbo.MonitoredMissedTrips (trip_id, service_date, detected_late_arrival_at) VALUES (N'SKEWED', @day, @a), (N'NORMAL', @day, @b)`);

    await applyMigration(pool);
    await applyMigration(pool);

    const evidence = new Map((await pool.request().query<{
      trip_id: string; first_vehicle_position_at: Date; last_vehicle_position_at: Date; first_underway_at: Date | null; source_timestamp_at: Date;
    }>("SELECT trip_id, first_vehicle_position_at, last_vehicle_position_at, first_underway_at, source_timestamp_at FROM dbo.GtfsTripOperationalEvidence")).recordset.map((r) => [r.trip_id, r]));

    assert.deepEqual(evidence.get("SKEWED"), {
      trip_id: "SKEWED",
      first_vehicle_position_at: at("18:09:46"),
      last_vehicle_position_at: at("18:19:45"),
      first_underway_at: at("18:09:46"),
      source_timestamp_at: at("18:19:45"),
    }, "moved back an hour exactly, and only once");
    assert.deepEqual(evidence.get("NORMAL")?.first_underway_at, at("18:09:38"));
    assert.deepEqual(evidence.get("FAST")?.last_vehicle_position_at, at("17:45:00"));

    const cases = new Map((await pool.request().query<{ trip_id: string; detected_late_arrival_at: Date }>(
      "SELECT trip_id, detected_late_arrival_at FROM dbo.MonitoredMissedTrips")).recordset.map((r) => [r.trip_id, r.detected_late_arrival_at]));
    assert.deepEqual(cases.get("SKEWED"), at("18:09:46"));
    assert.deepEqual(cases.get("NORMAL"), at("19:30:00"));

    const audit = (await pool.request().query<{ trip_id: string; first_underway_at: Date; shifted_seconds: number }>(
      "SELECT trip_id, first_underway_at, shifted_seconds FROM dbo.GtfsTripOperationalEvidenceClockSkew")).recordset;
    assert.deepEqual(audit, [{ trip_id: "SKEWED", first_underway_at: at("19:09:46"), shifted_seconds: 3600 }]);
  } finally {
    await pool.request().batch(DROP);
    await pool.close();
  }
});
