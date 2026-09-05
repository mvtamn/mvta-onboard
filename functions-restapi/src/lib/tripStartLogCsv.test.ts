import test from "node:test";
import assert from "node:assert/strict";
import { TRIP_START_LOG_CSV_HEADERS, csvCell, tripStartLogCsvFilename, tripStartLogToCsv } from "./tripStartLogCsv";
import type { TripStartLogTrip } from "./tripStartLogRead";

const trip: TripStartLogTrip = {
  service_date: "20260908",
  trip_id: "444-2-A-0320",
  block_id: "1",
  route_id: "444-2-A",
  route_short_name: "444",
  direction_id: 0,
  direction_label: "EB",
  origin_stop_id: "51234",
  origin_stop_name: 'Apple Valley Transit Station, Bay "C"',
  scheduled_start_seconds: 25 * 3600 + 10 * 60,
  scheduled_start_at: "2026-09-09T06:10:00.000Z",
  in_rotation: true,
  rotation_day: "tuesday",
  actual_start_at: "2026-09-09T06:12:30.000Z",
  actual_start_source: "trip_update",
  start_delay_seconds: 150,
  start_status: "late",
  predicted_start_at: null,
  verification: { observation: "observed_left_late", verified_by: "ocs@example.org", verified_initials: "JD", verified_at: "2026-09-09T06:13:00.000Z", note: null },
};

test("quotes only the cells that need it and doubles embedded quotes", () => {
  assert.equal(csvCell("444"), "444");
  assert.equal(csvCell('Bay "C", north'), '"Bay ""C"", north"');
  assert.equal(csvCell("two\nlines"), '"two\nlines"');
  assert.equal(csvCell(null), "");
});

test("writes the workbook's columns first, in its order, then what OnBoard adds", () => {
  const csv = tripStartLogToCsv([trip]);
  assert.ok(csv.startsWith("﻿"), "starts with a UTF-8 byte-order mark for Excel");
  const [header, row, trailing] = csv.slice(1).split("\r\n");
  assert.equal(header, TRIP_START_LOG_CSV_HEADERS.join(","));
  assert.equal(header.split(",").slice(0, 7).join(","), "Verified,Day of Week,Start Time,Block,Route,Origin Stop Name,Direction");
  assert.equal(
    row,
    'JD,Tuesday,25:10,1,444,"Apple Valley Transit Station, Bay ""C""",EB,Yes,observed_left_late,2026-09-09T06:13:00.000Z,2026-09-09T06:10:00.000Z,2026-09-09T06:12:30.000Z,trip_update,3,late,20260908,444-2-A-0320',
  );
  assert.equal(trailing, "", "ends with a line break");
});

test("an unverified trip with no actual leaves those cells blank and reads unknown", () => {
  const csv = tripStartLogToCsv([{ ...trip, verification: null, actual_start_at: null, actual_start_source: null, start_delay_seconds: null, start_status: "unknown", in_rotation: false, rotation_day: null }]);
  const row = csv.slice(1).split("\r\n")[1];
  assert.ok(row?.startsWith(",,25:10,1,444,"), row);
  assert.ok(row?.includes(",No,,,2026-09-09T06:10:00.000Z,,,,unknown,"), row);
});

test("names the file by service date", () => {
  assert.equal(tripStartLogCsvFilename("20260908"), "dispatch-log-20260908.csv");
});
