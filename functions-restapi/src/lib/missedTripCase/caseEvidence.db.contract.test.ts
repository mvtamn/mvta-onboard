import assert from "node:assert/strict";
import test, { after } from "node:test";
import { parseConnectionString, sql } from "../db";
import { operatedSql, operatedStartAt } from "./adapters/gtfs";
import { readCaseEvidence } from "./caseEvidence";

// The case evidence read against a real SQL Server. caseEvidence.test.ts covers
// what the readings mean; this covers what only the database can show:
//
//   operatedSql and operatedStartAt agree on every kind of reading. The stop
//   record counts with the SQL; the case's own start uses the TypeScript.
//
//   The block and stop records count what they say: the block's trips that
//   day, and every silent no-show at the stop, whatever its date.
//
// Tables are built by hand to the columns the read uses (migrations 011, 027,
// 094/095). See subscriberResend.db.contract.test.ts on why the contract job
// runs one file at a time.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;

const DROP = `
IF OBJECT_ID('dbo.MonitoredMissedTrips','U') IS NOT NULL DROP TABLE dbo.MonitoredMissedTrips;
IF OBJECT_ID('dbo.TripStartLog','U') IS NOT NULL DROP TABLE dbo.TripStartLog;
IF OBJECT_ID('dbo.GtfsTripOperationalEvidence','U') IS NOT NULL DROP TABLE dbo.GtfsTripOperationalEvidence;
`;

const CREATE = `
CREATE TABLE dbo.MonitoredMissedTrips (
  trip_id NVARCHAR(100) NOT NULL, service_date NVARCHAR(20) NOT NULL,
  scheduled_departure_at DATETIME2 NOT NULL, grace_deadline_at DATETIME2 NOT NULL,
  detection_type NVARCHAR(30) NULL, data_quality_status NVARCHAR(30) NOT NULL DEFAULT 'experimental',
  CONSTRAINT PK_MonitoredMissedTrips PRIMARY KEY (trip_id, service_date)
);
CREATE TABLE dbo.TripStartLog (
  service_date CHAR(8) NOT NULL, trip_id NVARCHAR(100) NOT NULL, block_id NVARCHAR(100) NULL,
  origin_stop_id NVARCHAR(100) NULL, origin_stop_name NVARCHAR(200) NULL,
  scheduled_start_at DATETIME2 NOT NULL, actual_start_at DATETIME2 NULL, actual_start_source NVARCHAR(20) NULL,
  predicted_start_at DATETIME2 NULL,
  CONSTRAINT PK_TripStartLog PRIMARY KEY (service_date, trip_id)
);
CREATE TABLE dbo.GtfsTripOperationalEvidence (
  trip_id NVARCHAR(100) NOT NULL, service_date NVARCHAR(20) NOT NULL, vehicle_id NVARCHAR(100) NULL,
  first_vehicle_position_at DATETIME2 NULL, first_underway_at DATETIME2 NULL,
  CONSTRAINT PK_GtfsTripOperationalEvidence PRIMARY KEY (trip_id, service_date)
);
`;

const DAY = "20261016";
const at = (hhmmss: string, day = "2026-10-16") => new Date(`${day}T${hhmmss}Z`);

interface Seed {
  trip: string;
  day?: string;
  block?: string | null;
  stop?: string | null;
  scheduled: Date;
  actual?: Date | null;
  source?: string | null;
  predicted?: Date | null;
  reported?: Date | null;
  underway?: Date | null;
  isCase?: boolean;
  quality?: string;
}

async function seed(pool: sql.ConnectionPool, s: Seed): Promise<void> {
  const day = s.day ?? DAY;
  const req = pool.request()
    .input("trip", sql.NVarChar(100), s.trip).input("day", sql.NVarChar(20), day)
    .input("block", sql.NVarChar(100), s.block ?? null).input("stop", sql.NVarChar(100), s.stop ?? null)
    .input("scheduled", sql.DateTime2, s.scheduled).input("actual", sql.DateTime2, s.actual ?? null)
    .input("source", sql.NVarChar(20), s.source ?? null).input("predicted", sql.DateTime2, s.predicted ?? null)
    .input("reported", sql.DateTime2, s.reported ?? null).input("underway", sql.DateTime2, s.underway ?? null)
    .input("quality", sql.NVarChar(30), s.quality ?? "experimental");
  await req.query(`
    INSERT dbo.TripStartLog (service_date, trip_id, block_id, origin_stop_id, origin_stop_name, scheduled_start_at, actual_start_at, actual_start_source, predicted_start_at)
    VALUES (@day, @trip, @block, @stop, CASE WHEN @stop IS NULL THEN NULL ELSE N'Savage Park & Ride' END, @scheduled, @actual, @source, @predicted);
    IF @reported IS NOT NULL OR @underway IS NOT NULL
      INSERT dbo.GtfsTripOperationalEvidence (trip_id, service_date, vehicle_id, first_vehicle_position_at, first_underway_at)
      VALUES (@trip, @day, N'4265', @reported, @underway);
    ${s.isCase === false ? "" : `INSERT dbo.MonitoredMissedTrips (trip_id, service_date, scheduled_departure_at, grace_deadline_at, detection_type, data_quality_status)
      VALUES (@trip, @day, @scheduled, DATEADD(MINUTE, 30, @scheduled), N'silent_no_show', @quality);`}
  `);
}

const skip = { skip: !connectionString && "DECISION_MATRIX_TEST_SQL_CONNECTION_STRING not set" };

after(async () => {
  if (!connectionString) return;
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString)).connect();
  try { await pool.request().batch(DROP); } finally { await pool.close(); }
});

test("Missed-trip case evidence against SQL Server", skip, async (t) => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await pool.request().batch(DROP);
    await pool.request().batch(CREATE);

    const scheduled = at("22:30:00");
    // One of each reading, all cases at stop S1. DEPARTED is the case under review.
    const seeds: Seed[] = [
      { trip: "DEPARTED", block: "B14C", stop: "S1", scheduled, actual: at("22:49:42"), source: "trip_update", predicted: at("22:43:00"), reported: at("22:20:00"), underway: at("23:09:30") },
      { trip: "ECHO", block: "B14C", stop: "S1", scheduled: at("21:30:00"), actual: at("21:30:00"), source: "trip_update", predicted: at("21:30:00") },
      { trip: "PREDICTION", stop: "S1", scheduled: at("20:30:00"), actual: at("20:41:00"), source: "trip_update", predicted: at("20:41:00"), reported: at("20:00:00") },
      { trip: "NOBUS", stop: "S1", scheduled: at("19:30:00"), actual: at("19:40:00"), source: "trip_update", predicted: at("19:35:00") },
      { trip: "FALLBACK", stop: "S1", scheduled: at("18:30:00"), actual: at("18:50:00"), source: "vehicle_position", reported: at("18:10:00") },
      { trip: "UNDERWAY", stop: "S1", scheduled: at("17:30:00"), underway: at("17:40:00"), reported: at("17:20:00") },
      { trip: "NOTHING", stop: "S1", scheduled: at("16:30:00") },
      // Other days at the same stop count toward its record.
      { trip: "EARLIER1", day: "20261009", stop: "S1", scheduled: at("22:30:00", "2026-10-09"), underway: at("23:05:00", "2026-10-09"), reported: at("22:00:00", "2026-10-09") },
      { trip: "EARLIER2", day: "20261002", stop: "S1", scheduled: at("22:30:00", "2026-10-02"), actual: at("22:52:00", "2026-10-02"), source: "trip_update", predicted: at("22:50:00", "2026-10-02"), reported: at("22:40:00", "2026-10-02") },
      // Cases the evidence could not judge: retired, and raised while the feed
      // was down. Neither ran, and neither may count against the stop.
      { trip: "RETIRED", day: "20260909", stop: "S1", scheduled: at("22:30:00", "2026-09-09"), quality: "legacy_unverified" },
      { trip: "FEEDGAP", day: "20260910", stop: "S1", scheduled: at("22:30:00", "2026-09-10"), quality: "unknown_data_gap" },
      // A block-mate that is not a case, with a bus; another stop's case.
      { trip: "BLOCKMATE", block: "B14C", stop: "S2", scheduled: at("20:00:00"), reported: at("19:50:00"), isCase: false },
      { trip: "ELSEWHERE", stop: "S2", scheduled: at("15:00:00") },
    ];
    for (const s of seeds) await seed(pool, s);

    await t.test("operatedSql and operatedStartAt agree on every reading", async () => {
      const rows = (await pool.request().query<{
        trip_id: string; service_date: string; sql_operated: number;
        actual_start_at: Date | null; actual_start_source: string | null; predicted_start_at: Date | null; scheduled_start_at: Date;
        first_vehicle_position_at: Date | null; first_underway_at: Date | null;
      }>(`
        SELECT dl.trip_id, CAST(dl.service_date AS NVARCHAR(20)) AS service_date,
               CASE WHEN ${operatedSql("e", "dl")} THEN 1 ELSE 0 END AS sql_operated,
               dl.actual_start_at, dl.actual_start_source, dl.predicted_start_at, dl.scheduled_start_at,
               e.first_vehicle_position_at, e.first_underway_at
        FROM dbo.TripStartLog dl
        LEFT JOIN dbo.GtfsTripOperationalEvidence e ON e.trip_id = dl.trip_id AND e.service_date = CAST(dl.service_date AS NVARCHAR(20))
      `)).recordset;
      assert.equal(rows.length, seeds.length);
      for (const row of rows) {
        const ts = operatedStartAt({
          first_underway_at: row.first_underway_at, first_vehicle_position_at: row.first_vehicle_position_at,
          dispatch_start_at: row.actual_start_at, dispatch_start_source: row.actual_start_source,
          dispatch_predicted_at: row.predicted_start_at, dispatch_scheduled_at: row.scheduled_start_at,
        });
        assert.equal(row.sql_operated === 1, ts !== null, `${row.trip_id} on ${row.service_date}`);
      }
    });

    await t.test("a case's evidence: its departure, its bus, its block and its stop's record", async () => {
      const evidence = await readCaseEvidence(pool, [{ trip_id: "DEPARTED", service_date: DAY, scheduled_departure_at: scheduled, grace_deadline_at: at("23:00:00") }]);
      const e = evidence.get(`DEPARTED|${DAY}`);
      assert.ok(e, "the case has evidence");
      assert.deepEqual(e.departure, { reading: "departed", at: "2026-10-16T22:49:42.000Z" });
      assert.equal(e.started_late_minutes, 19);
      assert.equal(e.started_inside_grace, true);
      assert.deepEqual(e.vehicle, { reported_at: "2026-10-16T22:20:00.000Z", underway_at: "2026-10-16T23:09:30.000Z", vehicle_id: "4265" });
      // DEPARTED, ECHO and BLOCKMATE run block B14C that day; ECHO had no bus.
      assert.deepEqual(e.block, { block_id: "B14C", trips: 3, trips_reported: 2 });
      // Nine judgeable cases at S1 across three days (RETIRED and FEEDGAP are
      // left out); DEPARTED, UNDERWAY, EARLIER1 and EARLIER2 ran. Leaving
      // DEPARTED out: 8 others, 3 of them ran.
      assert.deepEqual(e.origin_stop, { stop_id: "S1", name: "Savage Park & Ride", other_cases: 8, other_cases_ran: 3, likely_dead_zone: false });
    });

    await t.test("a retired case is judged against the stop's whole record, not one short of it", async () => {
      const evidence = await readCaseEvidence(pool, [{ trip_id: "RETIRED", service_date: "20260909", scheduled_departure_at: at("22:30:00", "2026-09-09"), grace_deadline_at: at("23:00:00", "2026-09-09") }]);
      assert.deepEqual(evidence.get("RETIRED|20260909")?.origin_stop, { stop_id: "S1", name: "Savage Park & Ride", other_cases: 9, other_cases_ran: 4, likely_dead_zone: false });
    });

    await t.test("a case the Dispatch Log never logged comes back with nothing to say", async () => {
      await pool.request().query(`INSERT dbo.MonitoredMissedTrips (trip_id, service_date, scheduled_departure_at, grace_deadline_at, detection_type)
        VALUES (N'UNLOGGED', N'${DAY}', '2026-10-16T12:00:00', '2026-10-16T12:30:00', N'silent_no_show')`);
      const evidence = await readCaseEvidence(pool, [{ trip_id: "UNLOGGED", service_date: DAY, scheduled_departure_at: at("12:00:00"), grace_deadline_at: at("12:30:00") }]);
      const e = evidence.get(`UNLOGGED|${DAY}`);
      assert.ok(e);
      assert.equal(e.departure.reading, "not_recorded");
      assert.equal(e.block, null);
      assert.equal(e.origin_stop, null);
    });
  } finally {
    await pool.close();
  }
});
