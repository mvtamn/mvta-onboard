import { test } from "node:test";
import assert from "node:assert";
import {
  parseStopsCsv,
  parseTripsCsv,
  parseRoutesCsv,
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
    { trip_id: "t65A-b13B-sl2B-v62", route_id: "425", direction_id: 0, trip_headsign: "North to Walmart/Blackhawk P&R" },
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
    { trip_id: "a", route_id: "436", direction_id: 0, trip_headsign: "North to 46th St Station/MSP" },
    { trip_id: "b", route_id: "436", direction_id: 0, trip_headsign: "46th St Station/MSP" },
  ];
  const resolved = resolveDirectionLabels(trips);
  assert.strictEqual(resolved.find((t) => t.trip_id === "a")!.direction_label, "NB");
  assert.strictEqual(resolved.find((t) => t.trip_id === "b")!.direction_label, "NB");
});

test("resolveDirectionLabels leaves direction_label null when no trip in the group has one", () => {
  const trips = [
    { trip_id: "a", route_id: "999", direction_id: 1, trip_headsign: "Downtown Loop" },
    { trip_id: "b", route_id: "999", direction_id: 1, trip_headsign: "Downtown Loop" },
  ];
  const resolved = resolveDirectionLabels(trips);
  assert.strictEqual(resolved[0].direction_label, null);
  assert.strictEqual(resolved[1].direction_label, null);
});
