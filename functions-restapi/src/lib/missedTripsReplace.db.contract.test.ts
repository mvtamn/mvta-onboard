import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseConnectionString, sql } from "./db";
import { replaceMissedTripsForMonths, type MappedMissedTrip } from "./availMissedTripsFeed";

// The Missed Trips month reload against SQL Server, because the reload now
// goes in as one bulk load rather than one INSERT per row and a bulk load is
// exactly the thing a unit test cannot speak for: the column list has to
// match migration-015-avail-missed-trips.sql's own order, and `id`
// (IDENTITY) and `ingested_at` (DEFAULT SYSUTCDATETIME()) are left out of it
// on the understanding that the server still fills them. Nothing but a real
// server can say whether that understanding holds.
//
// The reason it changed: the row-at-a-time loop made a month take long enough
// that the admin backfill's HTTP request timed out at the gateway mid-reload,
// and the response carrying an OTP half that had been written in full never
// reached the browser - dev 2026-10-28 reported "Request failed (504)" and
// "0 OTP Monthly rows upserted" for 202605 and 202606, both of them complete.
//
// See subscriberResend.db.contract.test.ts on why the contract job runs one
// file at a time.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;

const DROP = `
IF OBJECT_ID('dbo.AvailMissedTripsRouteStopDay','U') IS NOT NULL DROP TABLE dbo.AvailMissedTripsRouteStopDay;
`;

const MIGRATION = "migration-015-avail-missed-trips.sql";

const trip = (overrides: Partial<MappedMissedTrip> = {}): MappedMissedTrip => ({
  service_month: "202605",
  calendar_date: "20260519",
  route_id: 465,
  route_desc: "465 Burnsville - Mall of America",
  route_internet_name: "465",
  departure_stop_id: 13209,
  departure_stop_name: "Burnsville Station",
  arrival_stop_id: 14022,
  arrival_stop_name: "Mall of America",
  departure_missed: true,
  arrival_missed: false,
  entire_trip_missed: true,
  departure_trip_start_time: new Date("2026-05-19T14:31:00Z"),
  ...overrides,
});

const stored = async (pool: sql.ConnectionPool, month: string) =>
  (
    await pool.request().input("m", sql.Char(6), month).query<{
      id: number;
      calendar_date: string;
      route_id: number;
      route_desc: string | null;
      departure_stop_id: number | null;
      departure_missed: boolean;
      entire_trip_missed: boolean;
      departure_trip_start_time: Date | null;
      ingested_at: Date | null;
    }>(`SELECT id, calendar_date, route_id, route_desc, departure_stop_id, departure_missed,
               entire_trip_missed, departure_trip_start_time, ingested_at
          FROM dbo.AvailMissedTripsRouteStopDay WHERE service_month = @m ORDER BY calendar_date, route_id`)
  ).recordset;

after(async () => {
  if (!connectionString) return;
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString)).connect();
  try {
    await pool.request().batch(DROP);
  } finally {
    await pool.close();
  }
});

test("Missed Trips month reload against SQL Server", {
  skip: !connectionString && "DECISION_MATRIX_TEST_SQL_CONNECTION_STRING not set",
}, async (t) => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await pool.request().batch(DROP);
    await pool.request().batch(readFileSync(join(process.cwd(), "sql", MIGRATION), "utf8"));

    await t.test("bulk-loads a month, and the server still fills id and ingested_at", async () => {
      await replaceMissedTripsForMonths(pool, ["202605"], [
        trip(),
        trip({ calendar_date: "20260520", route_id: 460, departure_missed: false, arrival_missed: true, entire_trip_missed: false }),
      ]);

      const rows = await stored(pool, "202605");
      assert.equal(rows.length, 2);
      assert.deepEqual(rows.map((r) => r.route_id), [465, 460]);
      // Columns the bulk load deliberately omits.
      assert.equal(new Set(rows.map((r) => r.id)).size, 2, "IDENTITY still numbers each row");
      assert.ok(rows.every((r) => r.ingested_at instanceof Date), "the DEFAULT still stamps ingested_at");
      // And the ones it sends land in the right columns, in migration 015's order.
      assert.equal(rows[0].route_desc, "465 Burnsville - Mall of America");
      assert.equal(rows[0].departure_stop_id, 13209);
      assert.equal(rows[0].departure_missed, true);
      assert.equal(rows[1].departure_missed, false);
      assert.equal(rows[1].entire_trip_missed, false);
      assert.equal(rows[0].departure_trip_start_time?.toISOString(), "2026-05-19T14:31:00.000Z");
    });

    await t.test("carries nulls through as nulls, not as empty strings or zeroes", async () => {
      await replaceMissedTripsForMonths(pool, ["202606"], [
        trip({
          service_month: "202606",
          calendar_date: "20260601",
          route_desc: null,
          route_internet_name: null,
          departure_stop_id: null,
          departure_stop_name: null,
          arrival_stop_id: null,
          arrival_stop_name: null,
          // Nullable even on real incidents, per the feed's own sample.
          departure_trip_start_time: null,
        }),
      ]);

      const rows = await stored(pool, "202606");
      assert.equal(rows.length, 1);
      assert.equal(rows[0].route_desc, null);
      assert.equal(rows[0].departure_stop_id, null);
      assert.equal(rows[0].departure_trip_start_time, null);
    });

    await t.test("replaces only the months it was given, and is idempotent", async () => {
      await replaceMissedTripsForMonths(pool, ["202605"], [trip({ route_id: 470 })]);

      assert.deepEqual((await stored(pool, "202605")).map((r) => r.route_id), [470]);
      // The month it was not asked about is untouched - this is a delete+reload
      // scoped by service_month, not a table-wide one.
      assert.equal((await stored(pool, "202606")).length, 1);

      await replaceMissedTripsForMonths(pool, ["202605"], [trip({ route_id: 470 })]);
      assert.deepEqual((await stored(pool, "202605")).map((r) => r.route_id), [470], "re-running a month doubles nothing");
    });

    await t.test("a month with no reports empties the month rather than failing", async () => {
      await replaceMissedTripsForMonths(pool, ["202606"], []);
      assert.equal((await stored(pool, "202606")).length, 0);
      assert.equal((await stored(pool, "202605")).length, 1);
    });
  } finally {
    await pool.close();
  }
});
