// The one reading of every detection setting. These rules used to be re-typed
// at each call site, so the cases that matter are the ones a second typing
// would have got subtly wrong: what counts as "true", and what an empty or
// whitespace-only list means.
import assert from "node:assert/strict";
import { test } from "node:test";
import { missedTripDetectionSettings } from "./settings";

test("a detector is on only when its flag spells true", () => {
  for (const [value, expected] of [
    ["true", true],
    ["TRUE", true],
    ["  True  ", true],
    ["1", false],
    ["yes", false],
    ["enabled", false],
    ["", false],
    [undefined, false],
  ] as const) {
    const settings = missedTripDetectionSettings({ GTFS_SILENT_NO_SHOW_ENABLED: value, SPARE_MISSED_TRIPS_ENABLED: value });
    assert.equal(settings.silentNoShowEnabled, expected, `GTFS_SILENT_NO_SHOW_ENABLED=${String(value)}`);
    assert.equal(settings.spareEnabled, expected, `SPARE_MISSED_TRIPS_ENABLED=${String(value)}`);
  }
});

test("the two detectors are gated independently", () => {
  const settings = missedTripDetectionSettings({ GTFS_SILENT_NO_SHOW_ENABLED: "true" });
  assert.equal(settings.silentNoShowEnabled, true);
  assert.equal(settings.spareEnabled, false);
});

test("nothing configured leaves every detector off and every scope empty", () => {
  const settings = missedTripDetectionSettings({});
  assert.equal(settings.silentNoShowEnabled, false);
  assert.equal(settings.spareEnabled, false);
  assert.equal(settings.spareServiceIds.size, 0);
  assert.equal(settings.spareContractorFaultValues.size, 0);
});

test("Spare service ids keep the case Spare spells them in", () => {
  const { spareServiceIds } = missedTripDetectionSettings({ SPARE_MISSED_TRIP_SERVICE_IDS: "Svc-A, svc-b ,SVC-C" });
  assert.deepEqual([...spareServiceIds], ["Svc-A", "svc-b", "SVC-C"]);
});

test("contractor fault values are lowercased, so Spare's spelling does not matter", () => {
  const { spareContractorFaultValues } = missedTripDetectionSettings({ SPARE_CONTRACTOR_FAULT_VALUES: "Driver No Show, VEHICLE_ISSUE" });
  assert.deepEqual([...spareContractorFaultValues], ["driver no show", "vehicle_issue"]);
});

test("a list of nothing but separators is an empty scope, not a configured one", () => {
  // The console reports "spare_service_scope_configured" from this. Reading the
  // raw string for emptiness called " , , " configured, which it is not.
  const { spareServiceIds } = missedTripDetectionSettings({ SPARE_MISSED_TRIP_SERVICE_IDS: " , , " });
  assert.equal(spareServiceIds.size, 0);
});

test("a trailing separator does not add a blank entry", () => {
  const { spareServiceIds } = missedTripDetectionSettings({ SPARE_MISSED_TRIP_SERVICE_IDS: "svc-a,svc-b," });
  assert.deepEqual([...spareServiceIds], ["svc-a", "svc-b"]);
});
