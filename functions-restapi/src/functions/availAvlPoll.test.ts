import test from "node:test";
import assert from "node:assert/strict";
import { eventVehicleProjectionSql } from "./availAvlPoll";

test("projects every fresh AVL vehicle so unassigned vehicles can be shown", () => {
  const sql = eventVehicleProjectionSql();
  assert.match(sql, /FROM AvailAvlVehiclePositions/i);
  assert.match(sql, /report_timestamp >= DATEADD\(SECOND, -@windowSeconds/i);
  assert.doesNotMatch(sql, /EventServicePlanRoutes/i);
});
