import { test } from "node:test";
import assert from "node:assert";
import {
  parseStopsCsv,
  parseTripsCsv,
  parseRoutesCsv,
  parseStopTimesCsv,
  parseStopRouteLinksCsv,
  parseCalendarCsv,
  parseCalendarDatesCsv,
  deriveDirectionLabel,
  resolveDirectionLabels,
} from "./gtfsStatic";

test("parseStopsCsv parses a basic stops.txt", () => {
  const csv = "stop_id,stop_name,stop_lat,stop_lon\n56878,Main St & 5th Ave,44.86,-93.20\n";
  const rows = parseStopsCsv(csv);
  assert.deepStrictEqual(rows, [{ stop_id: "56878", stop_name: "Main St & 5th Ave", stop_lat: 44.86, stop_lon: -93.2 }]);
});

test("parseStopsCsv handles a quoted stop name containing a comma", () => {
  const csv = 'stop_id,stop_name,stop_lat,stop_lon\n100,"Main St, Suite 100",44.86,-93.20\n';
  const rows = parseStopsCsv(csv);
  assert.strictEqual(rows[0].stop_name, "Main St, Suite 100");
});

test("parseTripsCsv parses a basic trips.txt", () => {
  const csv =
    "route_id,service_id,trip_id,trip_headsign,direction_id,block_id,shape_id,wheelchair_accessible,bikes_allowed\n" +
    '425,43-v62,t65A-b13B-sl2B-v62,"North to Walmart/Blackhawk P&R",0,315-v62,27105_shp-v62,0,0\n';
  const rows = parseTripsCsv(csv);
  assert.deepStrictEqual(rows, [
    {
      trip_id: "t65A-b13B-sl2B-v62",
      route_id: "425",
      service_id: "43-v62",
      direction_id: 0,
      trip_headsign: "North to Walmart/Blackhawk P&R",
      block_id: "315-v62",
    },
  ]);
});

test("parseTripsCsv skips rows missing required columns", () => {
  const csv = "route_id,service_id,trip_id,trip_headsign,direction_id\n,,,,\n";
  const rows = parseTripsCsv(csv);
  assert.deepStrictEqual(rows, []);
});

test("parseRoutesCsv preserves MVTA route names and display metadata", () => {
  const csv =
    "route_id,agency_id,route_short_name,route_long_name,route_desc,route_type,route_url,route_color,route_text_color,route_sort_order\n" +
    '425,0,"Orange LINK","Orange LINK: Apple Valley-Burnsville-Eag","Rt Orange LINK",3,,c34b18,ffffff,400\n';
  const rows = parseRoutesCsv(csv);
  assert.deepStrictEqual(rows, [
    {
      route_id: "425",
      agency_id: "0",
      route_short_name: "Orange LINK",
      route_long_name: "Orange LINK: Apple Valley-Burnsville-Eag",
      route_desc: "Rt Orange LINK",
      route_type: 3,
      route_url: null,
      route_color: "c34b18",
      route_text_color: "ffffff",
      route_sort_order: 400,
    },
  ]);
});

test("parseRoutesCsv requires an id, a name, and a valid route type", () => {
  const csv =
    "route_id,route_short_name,route_long_name,route_type\n" +
    ",420,Apple Valley,3\n" +
    "421,,,3\n" +
    "422,422,Example,not-a-number\n";
  assert.deepStrictEqual(parseRoutesCsv(csv), []);
});

test("deriveDirectionLabel finds a leading cardinal word", () => {
  assert.strictEqual(deriveDirectionLabel("North to Walmart/Blackhawk P&R"), "NB");
  assert.strictEqual(deriveDirectionLabel("South to DCTC/Rosemount"), "SB");
});

test("deriveDirectionLabel finds a cardinal word after a branding prefix", () => {
  assert.strictEqual(deriveDirectionLabel("4FUN East to MOA/MSP"), "EB");
});

test("deriveDirectionLabel returns null when no cardinal word is present", () => {
  assert.strictEqual(deriveDirectionLabel("46th St Station/MSP"), null);
});

test("deriveDirectionLabel returns null for a null headsign", () => {
  assert.strictEqual(deriveDirectionLabel(null), null);
});

test("resolveDirectionLabels falls back to a sibling trip on the same route+direction", () => {
  const trips = [
    { trip_id: "a", route_id: "436", service_id: "1", direction_id: 0, trip_headsign: "North to 46th St Station/MSP" },
    { trip_id: "b", route_id: "436", service_id: "1", direction_id: 0, trip_headsign: "46th St Station/MSP" },
  ];
  const resolved = resolveDirectionLabels(trips);
  assert.strictEqual(resolved.find((t) => t.trip_id === "a")!.direction_label, "NB");
  assert.strictEqual(resolved.find((t) => t.trip_id === "b")!.direction_label, "NB");
});

test("resolveDirectionLabels leaves direction_label null when no trip in the group has one", () => {
  const trips = [
    { trip_id: "a", route_id: "999", service_id: "1", direction_id: 1, trip_headsign: "Downtown Loop" },
    { trip_id: "b", route_id: "999", service_id: "1", direction_id: 1, trip_headsign: "Downtown Loop" },
  ];
  const resolved = resolveDirectionLabels(trips);
  assert.strictEqual(resolved[0].direction_label, null);
  assert.strictEqual(resolved[1].direction_label, null);
});

test("parseStopTimesCsv reduces to the earliest stop_sequence's departure per trip", () => {
  const csv =
    "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n" +
    "t1,08:00:00,08:00:00,100,2\n" +
    "t1,07:55:00,07:55:00,99,1\n" +
    "t1,08:10:00,08:10:00,101,3\n";
  const rows = parseStopTimesCsv(csv);
  assert.deepStrictEqual(rows, [{
    trip_id: "t1",
    first_departure_seconds: 7 * 3600 + 55 * 60,
    first_stop_id: "99",
    first_stop_sequence: 1,
  }]);
});

test("parseStopTimesCsv handles GTFS past-midnight times over 24:00:00", () => {
  const csv = "trip_id,departure_time,stop_id,stop_sequence\nt2,25:10:00,50,1\n";
  const rows = parseStopTimesCsv(csv);
  assert.deepStrictEqual(rows, [{
    trip_id: "t2",
    first_departure_seconds: 25 * 3600 + 10 * 60,
    first_stop_id: "50",
    first_stop_sequence: 1,
  }]);
});

test("parseStopTimesCsv skips rows missing required values", () => {
  const csv = "trip_id,departure_time,stop_id,stop_sequence\n,,,\n";
  assert.deepStrictEqual(parseStopTimesCsv(csv), []);
});

test("parseCalendarCsv parses a basic calendar.txt", () => {
  const csv =
    "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n" +
    "43-v62,1,1,1,1,1,0,0,20260101,20261231\n";
  const rows = parseCalendarCsv(csv);
  assert.deepStrictEqual(rows, [
    {
      service_id: "43-v62",
      monday: true,
      tuesday: true,
      wednesday: true,
      thursday: true,
      friday: true,
      saturday: false,
      sunday: false,
      start_date: "20260101",
      end_date: "20261231",
    },
  ]);
});

test("parseCalendarCsv skips rows missing required columns", () => {
  const csv =
    "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n" +
    ",1,1,1,1,1,0,0,,\n";
  assert.deepStrictEqual(parseCalendarCsv(csv), []);
});

test("parseCalendarDatesCsv parses added and removed service exceptions", () => {
  const csv = "service_id,date,exception_type\n43-v62,20260704,2\n44-v62,20260705,1\n";
  const rows = parseCalendarDatesCsv(csv);
  assert.deepStrictEqual(rows, [
    { service_id: "43-v62", service_date: "20260704", exception_type: 2 },
    { service_id: "44-v62", service_date: "20260705", exception_type: 1 },
  ]);
});

test("parseCalendarDatesCsv skips rows with an invalid exception_type", () => {
  const csv = "service_id,date,exception_type\n43-v62,20260704,3\n";
  assert.deepStrictEqual(parseCalendarDatesCsv(csv), []);
});

test("parseStopRouteLinksCsv yields each stop/route pair once, via trips", () => {
  const stopTimes = "trip_id,arrival_time,departure_time,stop_id,stop_sequence\nT1,06:00:00,06:00:00,S1,1\nT1,06:05:00,06:05:00,S2,2\nT2,07:00:00,07:00:00,S1,1\nT3,07:00:00,07:00:00,S9,1\nTX,08:00:00,08:00:00,S1,1\n";
  const trips = [{ trip_id: "T1", route_id: "460" }, { trip_id: "T2", route_id: "460" }, { trip_id: "T3", route_id: "440" }];
  assert.deepStrictEqual(parseStopRouteLinksCsv(stopTimes, trips), [
    { stop_id: "S1", route_id: "460" }, { stop_id: "S2", route_id: "460" }, { stop_id: "S9", route_id: "440" },
  ]);
});
