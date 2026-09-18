import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseConnectionString, sql } from "../db";
import { availEvidenceFor, reconcileAvailEvidence } from "./index";

// Retrospective reconciliation against SQL Server: the links are keyed by the
// incident's natural tuple, so a night that rebuilds the whole Avail table
// updates them instead of duplicating them; an incident that stops being
// reported is marked, not deleted; and a link that moves loses the reviewer's
// confirmation with it.
//
// See subscriberResend.db.contract.test.ts on why the contract job runs one
// file at a time.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;

const DROP = `
IF OBJECT_ID('dbo.MissedTripSourceLinks','U') IS NOT NULL DROP TABLE dbo.MissedTripSourceLinks;
IF OBJECT_ID('dbo.AvailMissedTripsRouteStopDay','U') IS NOT NULL DROP TABLE dbo.AvailMissedTripsRouteStopDay;
IF OBJECT_ID('dbo.GtfsScheduledTrips','U') IS NOT NULL DROP TABLE dbo.GtfsScheduledTrips;
IF OBJECT_ID('dbo.MonitoredMissedTrips','U') IS NOT NULL DROP TABLE dbo.MonitoredMissedTrips;
`;

const CREATE = `
CREATE TABLE dbo.MonitoredMissedTrips (
  trip_id NVARCHAR(100) NOT NULL, service_date NVARCHAR(20) NOT NULL, route_id NVARCHAR(50) NOT NULL,
  scheduled_departure_at DATETIME2 NOT NULL, grace_deadline_at DATETIME2 NOT NULL,
  status NVARCHAR(20) NOT NULL DEFAULT 'escalated', source_system NVARCHAR(20) NOT NULL DEFAULT 'gtfs',
  CONSTRAINT PK_MonitoredMissedTrips PRIMARY KEY (trip_id, service_date)
);
CREATE TABLE dbo.GtfsScheduledTrips (
  trip_id NVARCHAR(100) NOT NULL PRIMARY KEY, route_id NVARCHAR(50) NOT NULL,
  service_id NVARCHAR(50) NOT NULL, first_departure_seconds INT NOT NULL, first_stop_id NVARCHAR(100) NULL
);
CREATE TABLE dbo.AvailMissedTripsRouteStopDay (
  id BIGINT IDENTITY(1,1) PRIMARY KEY, service_month CHAR(6) NOT NULL, calendar_date CHAR(8) NOT NULL,
  route_id INT NOT NULL, departure_stop_id INT NULL, arrival_stop_id INT NULL,
  departure_missed BIT NOT NULL DEFAULT 0, arrival_missed BIT NOT NULL DEFAULT 0,
  entire_trip_missed BIT NOT NULL DEFAULT 0, departure_trip_start_time DATETIME2 NULL,
  ingested_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
`;

const MIGRATION = "migration-135-missed-trip-source-links.sql";
const MONTHS = ["202609"];
const DAY = "20260917";
const START = "2026-09-17T14:00:00";

async function applyMigration(pool: sql.ConnectionPool) {
  const text = readFileSync(join(process.cwd(), "sql", MIGRATION), "utf8");
  for (const batch of text.split(/^\s*GO\s*$/gim).map((part) => part.trim()).filter(Boolean)) {
    await pool.request().batch(batch);
  }
}

after(async () => {
  if (!connectionString) return;
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString)).connect();
  try { await pool.request().batch(DROP); } finally { await pool.close(); }
});

const links = async (pool: sql.ConnectionPool) => (await pool.request().query<{
  trip_id: string | null; match_confidence: string; finding: string; confirmation: string | null;
  missing_since: Date | null; incident_departure_stop_id: number | null;
}>(`SELECT trip_id, match_confidence, finding, confirmation, missing_since, incident_departure_stop_id
    FROM dbo.MissedTripSourceLinks ORDER BY incident_departure_stop_id`)).recordset;

test("Avail reconciliation against SQL Server", {
  skip: !connectionString && "DECISION_MATRIX_TEST_SQL_CONNECTION_STRING not set",
}, async (t) => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await pool.request().batch(DROP);
    await pool.request().batch(CREATE);
    await applyMigration(pool);
    await applyMigration(pool); // re-runnable

    await pool.request().query(`
      INSERT dbo.MonitoredMissedTrips (trip_id, service_date, route_id, scheduled_departure_at, grace_deadline_at)
        VALUES ('T1', '${DAY}', '460', '${START}', '2026-09-17T14:30:00');
      INSERT dbo.GtfsScheduledTrips (trip_id, route_id, service_id, first_departure_seconds, first_stop_id)
        VALUES ('T1', '460', 'wk', 50400, '1201');
      INSERT dbo.AvailMissedTripsRouteStopDay (service_month, calendar_date, route_id, departure_stop_id, arrival_stop_id, entire_trip_missed, departure_trip_start_time)
        VALUES ('202609', '${DAY}', 460, 1201, 1290, 1, '${START}'),
               ('202609', '${DAY}', 460, 1399, 1290, 0, '${START}'),
               ('202609', '${DAY}', 777, 1500, 1590, 1, '${START}');`);

    await t.test("one link per incident, each carrying how sure the match is", async () => {
      const report = await reconcileAvailEvidence(pool, MONTHS, new Date("2026-09-18T03:30:00Z"));
      assert.deepEqual(report, { incidents: 3, exact: 1, probable: 1, unmatched: 1, missing: 0 });
      assert.deepEqual((await links(pool)).map((l) => [l.incident_departure_stop_id, l.match_confidence, l.trip_id, l.finding]), [
        [1201, "exact", "T1", "missed_trip"],
        [1399, "probable", "T1", "partial_service"],
        [1500, "unmatched", null, "missed_trip"],
      ]);
    });

    await t.test("a second run over a rebuilt feed updates the same links", async () => {
      const report = await reconcileAvailEvidence(pool, MONTHS, new Date("2026-09-19T03:30:00Z"));
      assert.deepEqual(report, { incidents: 3, exact: 1, probable: 1, unmatched: 1, missing: 0 });
      assert.equal((await links(pool)).length, 3);
    });

    await t.test("a reviewer's confirmation survives a run that changes nothing", async () => {
      await pool.request().query(
        `UPDATE dbo.MissedTripSourceLinks SET confirmation = N'confirmed', confirmed_by = N'ops@example.com',
         confirmed_at = SYSUTCDATETIME() WHERE incident_departure_stop_id = 1399`);
      await reconcileAvailEvidence(pool, MONTHS, new Date("2026-09-20T03:30:00Z"));
      assert.equal((await links(pool)).find((l) => l.incident_departure_stop_id === 1399)?.confirmation, "confirmed");
    });

    await t.test("a link that moves loses the confirmation it was given", async () => {
      // The case's scheduled start is corrected, so the 14:00 incidents no
      // longer place against it. What the reviewer agreed to is gone with it.
      await pool.request().query(
        `UPDATE dbo.MonitoredMissedTrips SET scheduled_departure_at = '2026-09-17T15:00:00' WHERE trip_id = 'T1'`);
      const report = await reconcileAvailEvidence(pool, MONTHS, new Date("2026-09-21T03:30:00Z"));
      assert.equal(report.unmatched, 3);
      const moved = (await links(pool)).find((l) => l.incident_departure_stop_id === 1399);
      assert.equal(moved?.confirmation, null);
      assert.equal(moved?.trip_id, null);
      await pool.request().query(
        `UPDATE dbo.MonitoredMissedTrips SET scheduled_departure_at = '${START}' WHERE trip_id = 'T1'`);
    });

    await t.test("an incident the feed stops reporting is marked, not deleted", async () => {
      await pool.request().query("DELETE dbo.AvailMissedTripsRouteStopDay WHERE departure_stop_id = 1399");
      const report = await reconcileAvailEvidence(pool, MONTHS, new Date("2026-09-22T03:30:00Z"));
      assert.equal(report.missing, 1);
      const gone = (await links(pool)).find((l) => l.incident_departure_stop_id === 1399);
      assert.ok(gone?.missing_since, "the link is kept and marked");

      // And it comes back when the feed reports it again.
      await pool.request().query(`INSERT dbo.AvailMissedTripsRouteStopDay
        (service_month, calendar_date, route_id, departure_stop_id, arrival_stop_id, entire_trip_missed, departure_trip_start_time)
        VALUES ('202609', '${DAY}', 460, 1399, 1290, 0, '${START}')`);
      await reconcileAvailEvidence(pool, MONTHS, new Date("2026-09-23T03:30:00Z"));
      assert.equal((await links(pool)).find((l) => l.incident_departure_stop_id === 1399)?.missing_since, null);
      assert.equal((await links(pool)).length, 3, "no duplicate was created");
    });

    await t.test("the evidence on a case reads back, exact first", async () => {
      const evidence = await availEvidenceFor(pool, "T1", DAY);
      assert.deepEqual(evidence.map((e) => e.match_confidence), ["exact", "probable"]);
      assert.match(evidence[0].match_reason, /all agree/);
    });
  } finally {
    await pool.close();
  }
});
