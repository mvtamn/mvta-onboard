import assert from "node:assert/strict";
import test from "node:test";
import { isLateNotice, outageExclusionSql, outageSystemForSourceRef } from "./relief";

// Attachment G: an excusable-delay claim needs written notice within 24 hours
// of the event; later notice disqualifies relief. The flag is a fact the
// Issuing Authority sees before deciding, not the decision itself.
test("notice more than 24 hours after the event is late", () => {
  const started = new Date("2026-07-12T06:00:00Z");
  assert.equal(isLateNotice(started, new Date("2026-07-13T05:59:00Z")), false);
  assert.equal(isLateNotice(started, new Date("2026-07-13T06:00:00Z")), false);
  assert.equal(isLateNotice(started, new Date("2026-07-13T06:01:00Z")), true);
});

// Which system's outage excuses which observation follows the source the
// occurrence was raised from (ADR 0028 puts the source in source_ref). A
// hand-entered occurrence has no system and no outage can excuse it.
test("the outage system follows the occurrence's source", () => {
  assert.equal(outageSystemForSourceRef("FixedRouteDepartures:avail_pullout:20260904|1305|2"), "Avail_CAD_AVL");
  assert.equal(outageSystemForSourceRef("MonitoredMissedTrips:gtfs:4401|20260712"), "Avail_CAD_AVL");
  assert.equal(outageSystemForSourceRef("MonitoredMissedTrips:spare:abc|20260712"), "Spare");
  assert.equal(outageSystemForSourceRef("OnDemandDepartures:spare_duties:20260904|d1"), "Spare");
  assert.equal(outageSystemForSourceRef(null), null);
  assert.equal(outageSystemForSourceRef("SomethingElse:x"), null);
});

// The same rule in SQL, so scoring and the report exclude the same rows: a
// documented window for the occurrence's system that covers its service date.
test("the SQL fragment names the window's system from source_ref and covers the service date", () => {
  const sql = outageExclusionSql("o");
  assert.match(sql, /FROM SystemOutageWindows w/);
  assert.match(sql, /o\.source_ref LIKE 'FixedRouteDepartures:avail_pullout:%'/);
  assert.match(sql, /o\.source_ref LIKE 'MonitoredMissedTrips:spare:%'/);
  assert.match(sql, /'Avail_CAD_AVL'/);
  assert.match(sql, /'Spare'/);
  assert.match(sql, /CONVERT\(date,w\.started_at\)<=CONVERT\(date,o\.service_date,112\)/);
  assert.match(sql, /w\.ended_at IS NULL OR CONVERT\(date,w\.ended_at\)>=CONVERT\(date,o\.service_date,112\)/);
});
