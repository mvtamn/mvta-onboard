import assert from "node:assert/strict";
import test from "node:test";
import { monthBoundaryPlan, priorServiceMonth, serviceMonthInChicago } from "./monthBoundary";

// The first of the month, 06:00 UTC, is 01:00 Central: the new month is
// the one that just began in Chicago, and the month to close is the one
// that just ended - not whatever UTC says.
test("the service month is taken in Chicago, not UTC", () => {
  assert.equal(serviceMonthInChicago(new Date("2026-08-01T06:00:00Z")), "202608");
  assert.equal(serviceMonthInChicago(new Date("2026-08-01T04:30:00Z")), "202607");   // 23:30 Central on July 31
  assert.equal(priorServiceMonth("202601"), "202512");
});

// What the timer does is decided by what the period already is. It opens
// what is missing, computes what nobody has touched, drafts what it just
// computed, and leaves alone anything a person is in the middle of.
test("a month nobody has opened is opened, computed, and drafted", () => {
  assert.deepEqual(monthBoundaryPlan({ now: new Date("2026-08-01T06:00:00Z"), priorStatus: null, currentStatus: null }), { openCurrent: "202608", openPrior: "202607", compute: "202607", draft: true, held: null });
});

test("a prior month still open, stale, or reopened is computed and drafted", () => {
  for (const status of ["open", "stale", "reopened"] as const) {
    assert.deepEqual(monthBoundaryPlan({ now: new Date("2026-08-01T06:00:00Z"), priorStatus: status, currentStatus: "open" }), { openCurrent: null, openPrior: null, compute: "202607", draft: true, held: null });
  }
});

test("a prior month in someone's hands is left alone", () => {
  for (const status of ["in_review", "in_validation", "finalized", "issued"] as const) {
    assert.deepEqual(monthBoundaryPlan({ now: new Date("2026-08-01T06:00:00Z"), priorStatus: status, currentStatus: "open" }), { openCurrent: null, openPrior: null, compute: null, draft: false, held: null });
  }
});

test("running twice on the same day does nothing the second time", () => {
  // After the first run: current opened, prior computed -> in_review.
  assert.deepEqual(monthBoundaryPlan({ now: new Date("2026-08-01T06:00:00Z"), priorStatus: "in_review", currentStatus: "open" }), { openCurrent: null, openPrior: null, compute: null, draft: false, held: null });
});

test("a prior month with unreviewed candidates is computed but not drafted", () => {
  assert.deepEqual(monthBoundaryPlan({ now: new Date("2026-08-01T06:00:00Z"), priorStatus: "open", currentStatus: "open", priorCandidates: 3 }), { openCurrent: null, openPrior: null, compute: "202607", draft: false, held: "3 unreviewed candidate occurrences" });
});
