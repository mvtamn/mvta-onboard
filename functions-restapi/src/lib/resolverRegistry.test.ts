import { test } from "node:test";
import assert from "node:assert";
import type { Transaction } from "mssql";
import { findResolver, RESOLVERS, resolveAutomatedThreshold, resolverKeys } from "./assessment/resolvers";

const context = { tx: {} as Transaction, contractorId: "c1", month: "202608", standardCode: "SOME_STANDARD" };

test("every key migration 030 seeds is registered", () => {
  // The catalog carries these three resolver_key values. A seeded key the
  // registry does not answer to would score the month not assessable, which
  // is a loud failure but still a failure nobody intended.
  for (const key of ["OTP_FIXED_ROUTE", "MISSED_TRIPS_FR", "GARAGE_DEPARTURE"]) {
    assert.ok(findResolver(key), `${key} must be registered`);
  }
});

test("keys are unique, so a lookup cannot be ambiguous", () => {
  assert.strictEqual(new Set(resolverKeys()).size, RESOLVERS.length);
});

test("every registered resolver says what it reads, for the administrator picking one", () => {
  for (const resolver of RESOLVERS) {
    assert.ok(resolver.label.length > 3, `${resolver.key} needs a label`);
    assert.ok(resolver.description.length > 20, `${resolver.key} needs a description`);
  }
});

test("only threshold resolvers carry a measuring function", () => {
  // An occurrence entry names an intake that raises rows; there is nothing to
  // call at compute time, and pretending there is would invite assess.ts to
  // call it.
  for (const resolver of RESOLVERS) {
    if (resolver.appliesTo === "threshold") assert.ok(resolver.resolve, `${resolver.key} must measure something`);
    else assert.strictEqual(resolver.resolve, undefined, `${resolver.key} raises occurrences and must not measure`);
  }
});

test("an unregistered key is not measurable, and says which key was wrong", async () => {
  // The old behaviour fell through to ManualMetricEntries, found nothing, and
  // scored "no data" - indistinguishable on a scorecard from a clean month.
  const result = await resolveAutomatedThreshold("NEXUS_COMPLAINTS", context);
  assert.strictEqual(result.metricValue, null);
  assert.strictEqual(result.completeness, 0);
  assert.match(result.unresolvedReason ?? "", /NEXUS_COMPLAINTS/);
  assert.match(result.unresolvedReason ?? "", /not registered/);
});

test("an automated standard naming no resolver at all says so", async () => {
  const result = await resolveAutomatedThreshold(null, context);
  assert.strictEqual(result.completeness, 0);
  assert.match(result.unresolvedReason ?? "", /names no resolver/);
  assert.match(result.unresolvedReason ?? "", /SOME_STANDARD/);
});

test("an occurrence intake cannot be used to measure a threshold", async () => {
  // MISSED_TRIPS_FR is a real key, so a bare registry lookup would succeed;
  // what it names cannot produce a monthly value.
  const result = await resolveAutomatedThreshold("MISSED_TRIPS_FR", context);
  assert.strictEqual(result.completeness, 0);
  assert.match(result.unresolvedReason ?? "", /raises occurrences rather than measuring/);
});

test("a not-measurable result never carries a number the ladder could match", async () => {
  // completeness 0 is what assess.ts reads as not_assessable; a stray metric
  // or quantity alongside it could still reach matchTier and charge money.
  for (const key of [null, "NOT_A_RESOLVER", "GARAGE_DEPARTURE"]) {
    const result = await resolveAutomatedThreshold(key, context);
    assert.strictEqual(result.metricValue, null);
    assert.strictEqual(result.rawMetricValue, null);
    assert.strictEqual(result.quantity, 0);
    assert.strictEqual(result.occurrenceCount, 0);
    assert.deepStrictEqual(result.sourceRefs, []);
  }
});
