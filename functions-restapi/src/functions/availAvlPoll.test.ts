import test from "node:test";
import assert from "node:assert/strict";
import { avlHealthOutcome, eventVehicleProjectionSql } from "./availAvlPoll";

test("projects every fresh AVL vehicle so unassigned vehicles can be shown", () => {
  const sql = eventVehicleProjectionSql();
  assert.match(sql, /FROM AvailAvlVehiclePositions/i);
  assert.match(sql, /report_timestamp >= DATEADD\(SECOND, -@windowSeconds/i);
  assert.doesNotMatch(sql, /EventServicePlanRoutes/i);
});

// --- feed health -----------------------------------------------------------
// avail_avl is the only required feed behind event_avl. Its ledger row used to
// carry the fetched count, which asserted a full delivery whatever became of
// it. These fix what the run may claim, and - just as importantly - what it may
// not call a failure.

test("counts the positions that were stored, not the reports that were fetched", () => {
  assert.deepEqual(avlHealthOutcome(120, 120, 120, 118), {
    kind: "health",
    entityCount: 118,
    unstoredCount: 2,
  });
});

test("declining out-of-order observations is not a loss", () => {
  // shouldAcceptObservation rejects anything no newer than the stored row. On a
  // latest-state table that is the poller working, so those reports never enter
  // the attempted count and cannot make the run look degraded.
  assert.deepEqual(avlHealthOutcome(120, 120, 40, 40), {
    kind: "health",
    entityCount: 40,
    unstoredCount: 0,
  });
});

test("a run that declined every report is empty, not failed", () => {
  // The comparison is >=, so an unchanged position is still written. Every
  // report being declined means every one arrived out of order - worth showing
  // as an empty run, but not a feed failure.
  assert.deepEqual(avlHealthOutcome(120, 120, 0, 0), {
    kind: "health",
    entityCount: 0,
    unstoredCount: 0,
  });
});

test("attempting writes and landing none is a failure", () => {
  const outcome = avlHealthOutcome(120, 120, 120, 0);
  assert.equal(outcome.kind, "failure");
  assert.match(outcome.kind === "failure" ? outcome.reason : "", /Fetched 120 AVL positions but stored none/);
});

test("a delivery carrying no usable position is a source failure", () => {
  // These reports never become an attempt, so without this they would read as
  // an attempt-free success - a feed serving nothing usable, recorded as fine.
  const outcome = avlHealthOutcome(120, 0, 0, 0);
  assert.equal(outcome.kind, "failure");
  assert.match(
    outcome.kind === "failure" ? outcome.reason : "",
    /Fetched 120 AVL reports but none carried usable position data/,
  );
});

test("an empty fetch stays a healthy empty run", () => {
  assert.deepEqual(avlHealthOutcome(0, 0, 0, 0), { kind: "health", entityCount: 0, unstoredCount: 0 });
});
