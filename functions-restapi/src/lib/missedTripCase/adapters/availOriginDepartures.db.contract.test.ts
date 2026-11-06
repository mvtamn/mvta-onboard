import assert from "node:assert/strict";
import test, { after } from "node:test";
import { parseConnectionString, sql } from "../../db";
import { originHoursSql, type OriginHourRow } from "./availOriginDepartures";

// The origin-hour read against SQL Server: which cases it speaks about, the
// Central hour it puts each Published Trip start in (DST included), the trips
// scheduled from that origin in that hour, and OTP Daily's departures there.
//
// See subscriberResend.db.contract.test.ts on why the contract job runs one
// file at a time.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;

const DROP = `
IF OBJECT_ID('dbo.MonitoredMissedTrips','U') IS NOT NULL DROP TABLE dbo.MonitoredMissedTrips;
IF OBJECT_ID('dbo.TripStartLog','U') IS NOT NULL DROP TABLE dbo.TripStartLog;
IF OBJECT_ID('dbo.OtpDailyRouteStopHour','U') IS NOT NULL DROP TABLE dbo.OtpDailyRouteStopHour;
`;

// The columns the read touches, typed as the migrations declare them.
const CREATE = `
CREATE TABLE dbo.MonitoredMissedTrips (
  trip_id NVARCHAR(100) NOT NULL, service_date NVARCHAR(20) NOT NULL, route_id NVARCHAR(50) NOT NULL,
  scheduled_departure_at DATETIME2 NOT NULL,
  data_quality_status NVARCHAR(30) NOT NULL DEFAULT 'experimental',
  source_system NVARCHAR(20) NOT NULL DEFAULT 'gtfs',
  CONSTRAINT PK_MonitoredMissedTrips PRIMARY KEY (trip_id, service_date)
);
CREATE TABLE dbo.TripStartLog (
  service_date CHAR(8) NOT NULL, trip_id NVARCHAR(100) NOT NULL, route_id NVARCHAR(50) NOT NULL,
  origin_stop_id NVARCHAR(100) NULL, origin_stop_name NVARCHAR(200) NULL, scheduled_start_at DATETIME2 NOT NULL,
  CONSTRAINT PK_TripStartLog PRIMARY KEY (service_date, trip_id)
);
CREATE TABLE dbo.OtpDailyRouteStopHour (
  id BIGINT IDENTITY(1,1) PRIMARY KEY, calendar_date CHAR(8) NOT NULL, hour_of_day TINYINT NOT NULL,
  route_id INT NOT NULL, stop_id INT NOT NULL, direction NVARCHAR(40) NULL, actual_departures INT NULL, missed INT NULL
);
`;

after(async () => {
  if (!connectionString) return;
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString)).connect();
  try { await pool.request().batch(DROP); } finally { await pool.close(); }
});

test("origin-hour read against SQL Server", { skip: !connectionString && "DECISION_MATRIX_TEST_SQL_CONNECTION_STRING not set" }, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await pool.request().batch(DROP);
    await pool.request().batch(CREATE);
    await pool.request().batch(`
      -- 2026-11-04 is CST: 16:05 and 16:40 UTC are both in the 10:00 hour at stop 101.
      INSERT INTO dbo.TripStartLog VALUES
        ('20261104', 'T1', '465', '101', N'Oak St at 4 St / 5 St SE', '2026-11-04T16:05:00'),
        ('20261104', 'T2', '465', '101', N'Oak St at 4 St / 5 St SE', '2026-11-04T16:40:00'),
        ('20261104', 'T3', '465', '101', N'Oak St at 4 St / 5 St SE', '2026-11-04T17:05:00'),
        ('20261104', 'B1', '444', '202', N'Burnsville Center', '2026-11-04T16:00:00'),
        ('20260917', 'S1', '460', '303', N'Apple Valley Transit Station NB', '2026-09-17T14:00:00'),
        ('20261104', 'L1', '465', '101', N'Oak St at 4 St / 5 St SE', '2026-11-04T16:10:00'),
        -- 06:30 UTC on 5 November is 00:30 CST: service date the 4th, Avail's calendar date the 5th.
        ('20261104', 'N1', '495', '404', N'Mystic Lake Casino', '2026-11-05T06:30:00');
      INSERT INTO dbo.MonitoredMissedTrips (trip_id, service_date, route_id, scheduled_departure_at, data_quality_status, source_system) VALUES
        ('T1', '20261104', '465', '2026-11-04T16:05:00', 'experimental', 'gtfs'),
        ('B1', '20261104', '444', '2026-11-04T16:00:00', 'experimental', 'gtfs'),
        ('S1', '20260917', '460', '2026-09-17T14:00:00', 'experimental', 'gtfs'),
        ('L1', '20261104', '465', '2026-11-04T16:10:00', 'legacy_unverified', 'gtfs'),
        ('spare:R1', '20261104', 'Connect', '2026-11-04T16:00:00', 'source_verified', 'spare'),
        ('N1', '20261104', '495', '2026-11-05T06:30:00', 'experimental', 'gtfs');
      -- Two direction rows in one hour are one count; the 09:00 row is a decoy
      -- for a read that forgot DST on 2026-09-17 (CDT, so 14:00 UTC is 09:00).
      INSERT INTO dbo.OtpDailyRouteStopHour (calendar_date, hour_of_day, route_id, stop_id, direction, actual_departures, missed) VALUES
        ('20261104', 10, 465, 101, N'NB', 2, 0), ('20261104', 10, 465, 101, N'SB', 1, 1),
        ('20261104', 10, 465, 999, N'NB', 7, 0),
        ('20260917', 9, 460, 303, N'NB', 1, 0), ('20260917', 8, 460, 303, N'NB', 4, 0),
        ('20261104', 0, 495, 404, N'NB', 9, 0), ('20261105', 0, 495, 404, N'NB', 1, 0);`);

    const rows = (await pool.request().input("since", sql.Int, 3650).query<OriginHourRow>(originHoursSql())).recordset;
    const byTrip = new Map(rows.map((r) => [r.trip_id, r]));

    assert.deepEqual([...byTrip.keys()].sort(), ["B1", "N1", "S1", "T1"], "fixed-route cases only; legacy and Spare are not read");
    const t1 = byTrip.get("T1")!;
    assert.equal(t1.local_hour, 10);
    assert.equal(t1.scheduled, 3, "T1, T2 and L1 are scheduled from stop 101 in the hour - a schedule, not cases; T3 is in the next hour");
    assert.equal(t1.departures, 3, "both direction rows, and not another stop's");
    assert.equal(t1.missed, 1);
    assert.equal(t1.origin_stop_id, "101");
    assert.equal(byTrip.get("S1")!.local_hour, 9, "Central daylight time");
    assert.equal(byTrip.get("S1")!.departures, 1);
    assert.equal(byTrip.get("B1")!.departures, null, "no OTP row is not zero departures");
    assert.equal(byTrip.get("B1")!.scheduled, 1);
    const n1 = byTrip.get("N1")!;
    assert.equal(n1.local_hour, 0);
    assert.equal(n1.departures, 1, "after midnight, Avail's next calendar day - not the service date's 00:00 hour");
    assert.equal(n1.scheduled, 1);
  } finally {
    await pool.close();
  }
});
