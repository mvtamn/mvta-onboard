import assert from "node:assert/strict";
import test from "node:test";
import {
  departureSourceAllowed,
  garageDepartureCandidatePredicate,
  garageDepartureVarianceSeconds,
  observingSystem,
  observingSystemSql,
  occurrenceSourceRefSql,
  onDemandDepartureCandidatePredicate,
  parseOccurrenceSource,
  settledServiceDateExclusive,
} from "./sources";

test("defaults to the ten-minute variance the integration spec named", () => {
  assert.equal(garageDepartureVarianceSeconds(undefined), 600);
});

test("takes a per-environment override", () => {
  assert.equal(garageDepartureVarianceSeconds("15"), 900);
  assert.equal(garageDepartureVarianceSeconds(" 2 "), 120);
});

test("treats a zero variance as deliberate, not as missing configuration", () => {
  // Zero means every late departure is reviewable. That is a defensible policy
  // choice, so it must not silently fall back to the default.
  assert.equal(garageDepartureVarianceSeconds("0"), 0);
});

test("falls back to the default rather than trusting unusable configuration", () => {
  // A malformed or negative setting must not become a threshold of NaN or a
  // negative one, either of which would make every row a candidate.
  for (const bad of ["", "ten", "-5", "abc10"]) {
    assert.equal(garageDepartureVarianceSeconds(bad), 600, `input: ${JSON.stringify(bad)}`);
  }
});

test("a run only qualifies when it never departed or departed beyond the variance", () => {
  const predicate = garageDepartureCandidatePredicate();
  assert.match(predicate, /pullout_actual IS NULL/, "a run that never departed is a candidate");
  assert.match(
    predicate,
    /DATEDIFF\(SECOND, d\.pullout_scheduled, d\.pullout_actual\) > @variance_seconds/,
    "a run that departed is only a candidate beyond the variance",
  );
  assert.match(predicate, /OR/, "the two cases are alternatives, not both required");
});

test("a run with no scheduled pullout is not a candidate", () => {
  // There is no committed time to have missed, so it is a gap in the source
  // rather than a breach - the same reason the missed-trip detector records
  // unknown_data_gap instead of escalating.
  assert.match(garageDepartureCandidatePredicate(), /pullout_scheduled IS NOT NULL/);
});

test("Avail's midnight placeholder is excluded like an absent schedule", () => {
  // The null check alone never fired: Avail has never sent a NULL scheduled
  // pullout, it sends 00:00:00 instead, and those rows were most of the
  // candidates raised each night. The console applies the same rule in
  // lib/fixedRouteDepartureOutcome.ts, so the two cannot disagree.
  assert.match(
    garageDepartureCandidatePredicate(),
    /AT TIME ZONE 'UTC' AT TIME ZONE 'Central Standard Time' AS TIME\) <> '00:00:00'/,
    "midnight is agency-local; the column holds UTC instants since migration 138",
  );
});

test("matches the statuses that say a departure was missed", () => {
  // Missed Pullout and Missed Login are 408 runs that provably never left the
  // garage, and neither matched the previous list.
  const predicate = garageDepartureCandidatePredicate();
  for (const status of ["Missed Pullout", "Missed Login", "Expired Pullout", "Late Pullout"]) {
    assert.match(predicate, new RegExp(`'${status}'`), `${status} must be a departure outcome`);
  }
});

test("does not match a status MVTA's configuration cannot produce", () => {
  // Avail confirmed MVTA has no operator scheduling package, so it never
  // ingests the data that raises these five. Listing them would read as
  // coverage while providing none - none has ever reached the feed, so there is
  // no spelling to match on either.
  const predicate = garageDepartureCandidatePredicate();
  for (const status of [
    "Missing Operator Assignment",
    "Missing Vehicle Assignment",
    "Invalid Vehicle Assignment",
    "Duplicate Vehicle Assignment",
    "Missed Check-in",
  ]) {
    assert.doesNotMatch(predicate, new RegExp(status), `${status} is unreachable at MVTA`);
  }
});

test("lets the timestamps decide, never the status alone", () => {
  // Expired Pullout is sticky: Avail confirmed it marks a failure to leave ON
  // SCHEDULE, and 232 of 510 such rows carry a real departure. So the status
  // cannot tell a late departure from no departure - only the timestamps can.
  const predicate = garageDepartureCandidatePredicate();
  assert.match(predicate, /'Expired Pullout'/);
  assert.match(predicate, /pullout_actual IS NULL/);
  assert.match(
    predicate,
    /DATEDIFF\(SECOND, d\.pullout_scheduled, d\.pullout_actual\) > @variance_seconds/,
  );
});

test("applies the same guards to every listed status", () => {
  // The Red conditions are added to the status list, not to a separate branch,
  // so the settled-day and scheduled-pullout guards cover them too.
  //
  // The predicate is now DERIVED from the ladder in lib/garageDeparture, which
  // gives one disjunct per candidate arm - never departed, and departed too
  // late - rather than the single conjunction this test was written against.
  // So the guard is no longer "there is exactly one of each clause"; it is
  // that EVERY disjunct carries every guard, which is what stops an unsettled
  // row slipping through one arm. Equivalence with the ladder itself is
  // proved in lib/garageDeparture/garageDeparture.test.ts and executed
  // against SQL Server in occurrenceIntake.db.contract.test.ts.
  const disjuncts = garageDepartureCandidatePredicate()
    .split(/\n\s*OR\s*\(/)
    .filter((part) => part.trim().length > 0);
  assert.equal(disjuncts.length, 2, "one disjunct per candidate arm");
  for (const [index, disjunct] of disjuncts.entries()) {
    assert.match(disjunct, /pullout_status IN \(/, `disjunct ${index} carries the status list`);
    assert.match(disjunct, /service_date < @settled_before/, `disjunct ${index} carries the settled-day guard`);
    assert.match(disjunct, /pullout_scheduled IS NOT NULL/, `disjunct ${index} carries the schedule guard`);
    assert.match(disjunct, /AS TIME\) <> '00:00:00'/, `disjunct ${index} carries the placeholder guard`);
  }
});

test("does not match a status the feed has never emitted", () => {
  // 'Late Relief' headed the list and appears in no row of 22 days of data. It
  // came from the one sample payload the fixtures were built from.
  assert.doesNotMatch(garageDepartureCandidatePredicate(), /Late Relief/);
});

test("never treats a pull-in outcome as a departure", () => {
  // Nearly 1,900 rows describe a run's RETURN to the garage, which means its
  // departure already happened. Matching one would score a completed run.
  const predicate = garageDepartureCandidatePredicate();
  assert.doesNotMatch(predicate, /Pullin/);
});

test("leaves an unclassified run alone", () => {
  // A blank status is a run Avail is still resolving - every blank row seen was
  // from the current service day.
  const predicate = garageDepartureCandidatePredicate();
  assert.match(predicate, /pullout_status IN \(/, "an explicit list is what excludes unjudged runs");
  assert.doesNotMatch(predicate, /''/, "a blank status must not be listed");
});

test("only judges a run once its service day is over", () => {
  // PulloutStatus is a precedence ladder that moves as a run progresses: Avail
  // documents that Missed Login can become Waiting for Pullout or Late Login,
  // and that Missed Pullout stops applying once the vehicle is seen on route.
  // Reading either mid-day catches a value that has not settled.
  assert.match(garageDepartureCandidatePredicate(), /d\.service_date < @settled_before/);
});

test("excludes the current service day, in agency time", () => {
  // 01:20 agency-local, when this poll runs. The UTC date has already rolled to
  // the 5th; the service day that just ended is the 4th, and today's runs have
  // barely started - so the boundary must be the local date, not the UTC one.
  assert.equal(settledServiceDateExclusive(new Date("2026-09-05T06:20:00Z")), "20260905");
  // 20:00 agency-local on the 4th: mid-service, UTC already on the 5th. A UTC
  // boundary here would declare the in-flight day settled and judge it.
  assert.equal(settledServiceDateExclusive(new Date("2026-09-05T01:00:00Z")), "20260904");
});

test("leaves On Route No Pullout for investigation rather than penalty", () => {
  // Twelve of its thirteen rows have no departure, but the name says the
  // vehicle IS running - a missing pullout record, not a missing departure.
  assert.doesNotMatch(garageDepartureCandidatePredicate(), /On Route No Pullout/);
});


test("an on-demand duty qualifies only when settled, scheduled, not cancelled, and undeparted or late", () => {
  const predicate = onDemandDepartureCandidatePredicate();
  assert.match(predicate, /d\.service_date < @settled_before/, "judged only once its day is over");
  assert.match(predicate, /departure_scheduled IS NOT NULL/, "no committed start means a gap, not a breach");
  assert.match(predicate, /LOWER\(ISNULL\(d\.duty_status, N''\)\) <> N'cancelled'/, "a cancelled duty had no departure to make");
  assert.match(predicate, /departure_actual IS NULL/, "a duty that never departed is a candidate");
  assert.match(
    predicate,
    /DATEDIFF\(SECOND, d\.departure_scheduled, d\.departure_actual\) > @variance_seconds/,
    "a departed duty is only a candidate beyond the same variance as fixed route",
  );
});

test("source references name their source system so one departure cannot score twice", () => {
  // ADR 0028. Migration 097 rewrote the pre-existing fixed-route references
  // into this shape; the on-demand one is keyed by duty id alone because a
  // duty is one departure however its service date is later revised.
  assert.match(occurrenceSourceRefSql("fixed_route_departure", "d"), /^CONCAT\(N'FixedRouteDepartures:avail_pullout:',d\.service_date,N'\|',d\.block,N'\|',d\.run\)$/);
  assert.match(occurrenceSourceRefSql("on_demand_departure", "d"), /^CONCAT\(N'OnDemandDepartures:spare_duties:',d\.duty_id\)$/);
});

test("a departure feed raises candidates when current or current-but-empty, and never otherwise", () => {
  // The poll runs at 01:20 agency-local, when a departures feed has had
  // nothing to report for hours; that quiet is not distrust. Stale, absent, or
  // unknown is, because a candidate is never withdrawn.
  assert.equal(departureSourceAllowed("current"), true);
  assert.equal(departureSourceAllowed("current_but_empty"), true);
  assert.equal(departureSourceAllowed("stale"), false);
  assert.equal(departureSourceAllowed("unavailable"), false);
  assert.equal(departureSourceAllowed(undefined), false);
});

test("a stored reference reads back as the source that built it", () => {
  assert.deepEqual(parseOccurrenceSource("FixedRouteDepartures:avail_pullout:20260904|1305|2"),
    { kind: "fixed_route_departure", service_date: "20260904", block: "1305", run: "2" });
  assert.deepEqual(parseOccurrenceSource("MonitoredMissedTrips:gtfs:4401|20260712"),
    { kind: "missed_trip", system: "gtfs", record_id: "4401", service_date: "20260712" });
  assert.deepEqual(parseOccurrenceSource("MonitoredMissedTrips:spare:req:9|20260712"),
    { kind: "missed_trip", system: "spare", record_id: "req:9", service_date: "20260712" });
  assert.deepEqual(parseOccurrenceSource("OnDemandDepartures:spare_duties:d-1"), { kind: "on_demand_departure", duty_id: "d-1" });
  for (const ref of [null, undefined, "", "test:20260712", "MonitoredMissedTrips:other:1|20260712", "FixedRouteDepartures:avail_pullout:20260904"]) {
    assert.equal(parseOccurrenceSource(ref), null, String(ref));
  }
});

test("the observing system follows the source, in TypeScript and SQL alike", () => {
  const cases: [string, string | null][] = [
    ["FixedRouteDepartures:avail_pullout:20260904|1305|2", "Avail_CAD_AVL"],
    ["MonitoredMissedTrips:gtfs:4401|20260712", "Avail_CAD_AVL"],
    ["MonitoredMissedTrips:spare:abc|20260712", "Spare"],
    ["OnDemandDepartures:spare_duties:d1", "Spare"],
  ];
  const sqlCase = observingSystemSql("o.source_ref");
  for (const [ref, system] of cases) {
    assert.equal(observingSystem(parseOccurrenceSource(ref)), system);
    const prefix = ref.slice(0, ref.indexOf(":", ref.indexOf(":") + 1) + 1);
    assert.ok(sqlCase.includes(`LIKE '${prefix}%' THEN '${system}'`), `${prefix} in SQL`);
  }
  assert.equal(observingSystem(null), null);
});

test("reference aliases are checked before they reach SQL", () => {
  assert.throws(() => occurrenceSourceRefSql("fixed_route_departure", "d; DROP"), TypeError);
  assert.match(occurrenceSourceRefSql("missed_trip", "m"), /^CONCAT\(N'MonitoredMissedTrips:',ISNULL\(m\.source_system,N'gtfs'\)/);
});
