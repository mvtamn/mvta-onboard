import { test } from "node:test";
import assert from "node:assert";
import {
  isHandEntered, KNOWN_SOURCE_SYSTEMS, MEASUREMENT_SOURCES, normalizeMeasurementSource,
} from "./assessment/measurementSource";
import { RESOLVERS, resolversForSource } from "./assessment/resolvers";

test("the four kinds the schema now carries", () => {
  assert.deepStrictEqual([...MEASUREMENT_SOURCES],
    ["api_feed", "onboard_compliance", "manual_entry", "structured_import"]);
});

test("a period snapshotted before migration 104 still computes the way it was finalized", () => {
  // AssessmentPeriodStandards snapshots are deliberately left in the old
  // vocabulary - they record what a month was scored under - so the compute
  // reads both. 'auto' split on standard type, which is what actually
  // distinguished a feed from OnBoard's own occurrences.
  assert.strictEqual(normalizeMeasurementSource("auto", "threshold"), "api_feed");
  assert.strictEqual(normalizeMeasurementSource("auto", "occurrence"), "onboard_compliance");
  assert.strictEqual(normalizeMeasurementSource("manual", "threshold"), "manual_entry");
});

test("a value already in the new vocabulary is left alone", () => {
  for (const source of MEASUREMENT_SOURCES) {
    assert.strictEqual(normalizeMeasurementSource(source, "threshold"), source);
  }
});

test("an unreadable source falls back to hand entry rather than throwing", () => {
  // A standard whose source cannot be read still has a hand-entered figure to
  // fall back on; throwing would take the whole month's compute down for one
  // unrecognised string.
  assert.strictEqual(normalizeMeasurementSource(null, "threshold"), "manual_entry");
  assert.strictEqual(normalizeMeasurementSource("something-else", "occurrence"), "manual_entry");
});

test("both manual kinds read the same hand-entered figure", () => {
  // The difference is provenance, not mechanism - which is why structured
  // import needs no separate storage.
  assert.ok(isHandEntered("manual_entry"));
  assert.ok(isHandEntered("structured_import"));
  assert.ok(!isHandEntered("api_feed"));
  assert.ok(!isHandEntered("onboard_compliance"));
});

test("every registered resolver declares which source kind it serves", () => {
  for (const resolver of RESOLVERS) {
    assert.ok((MEASUREMENT_SOURCES as readonly string[]).includes(resolver.source), `${resolver.key} needs a source`);
    // Only the two automated kinds can have a resolver at all.
    assert.ok(resolver.source === "api_feed" || resolver.source === "onboard_compliance", resolver.key);
  }
});

test("a feed resolver and an OnBoard intake are no longer the same thing", () => {
  // Before migration 104 both were 'auto', and only the registry's appliesTo
  // hinted at the difference.
  assert.deepStrictEqual(resolversForSource("api_feed").map((r) => r.key), ["OTP_FIXED_ROUTE"]);
  assert.deepStrictEqual(resolversForSource("onboard_compliance").map((r) => r.key).sort(),
    ["GARAGE_DEPARTURE", "MISSED_TRIPS_FR"]);
  assert.deepStrictEqual(resolversForSource("manual_entry"), []);
  assert.deepStrictEqual(resolversForSource("structured_import"), []);
});

test("the source systems MVTA reports from are named", () => {
  // Offered as a picker so the same system is not spelled three ways.
  assert.deepStrictEqual(KNOWN_SOURCE_SYSTEMS.map((system) => system.value), ["Nexus", "Asset Works M5"]);
  for (const system of KNOWN_SOURCE_SYSTEMS) assert.ok(system.description.length > 20, system.value);
});
