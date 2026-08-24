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
