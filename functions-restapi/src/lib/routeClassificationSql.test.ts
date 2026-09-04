import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("route classification history insert matches its schema", () => {
  const source = readFileSync(join(process.cwd(), "src/functions/routeClassification.ts"), "utf8");
  assert.match(
    source,
    /INSERT INTO RouteClassificationHistory\(route_id,route_category,route_label,route_color,effective_start_date,effective_end_date,is_active,changed_by,changed_at\)\s+SELECT route_id,route_category,route_label,route_color,effective_start_date,effective_end_date,is_active,updated_by,SYSUTCDATETIME\(\)/,
  );
});

test("route color migration defers the new-column constraint and verifies success", () => {
  const source = readFileSync(
    join(process.cwd(), "sql/migration-073-route-classification-colors.sql"),
    "utf8",
  );

  assert.match(source, /sp_executesql[\s\S]*CK_RouteClassification_RouteColor/);
  assert.match(
    source,
    /IF COL_LENGTH\('dbo\.RouteClassification', 'route_color'\) IS NULL[\s\S]*THROW 50074/,
  );
  assert.doesNotMatch(source, /GO\s+PRINT 'Migration 073 applied/);
});

test("vehicle-position evidence records the first position on update, not only on insert", () => {
  // first_vehicle_position_at used to be written only in the MERGE's INSERT
  // branch. Because the TripUpdate poller normally creates the evidence row
  // first, this MERGE almost always takes the MATCHED path, so the column
  // stayed null for trips the position feed was actively reporting - 1 row
  // populated against 174 trips with first_underway_at set, on live data.
  const source = readFileSync(
    join(process.cwd(), "src/functions/gtfsVehiclePositionsPoll.ts"),
    "utf8",
  );

  assert.match(
    source,
    /WHEN MATCHED THEN UPDATE SET[\s\S]*?first_vehicle_position_at = COALESCE\(target\.first_vehicle_position_at, @observed_at\)/,
  );
  // Sticky: an existing first observation is never overwritten by a later one.
  assert.doesNotMatch(
    source,
    /WHEN MATCHED THEN UPDATE SET[\s\S]*?first_vehicle_position_at = @observed_at\b/,
  );
});
