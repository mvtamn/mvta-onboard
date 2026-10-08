// The parts of the queue read that need no database: what a query asks for
// after clamping, and which total the paging footer belongs to. Both used to
// be inline in the GET /missed-trips handler, where the only way to reach them
// was an HTTP call.
//
// The list-and-totals agreement - the invariant the module exists to hold -
// needs real rows, so it lives in missedTripCase.db.contract.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CASE_LIMIT, MAX_CASE_LIMIT, caseQuery, viewCount, type CaseTotals } from "./reads";

test("an empty query asks for the queue", () => {
  assert.deepEqual(caseQuery({}), { view: "queue", limit: DEFAULT_CASE_LIMIT, offset: 0 });
});

test("only the three named views are honoured", () => {
  assert.equal(caseQuery({ view: "history" }).view, "history");
  assert.equal(caseQuery({ view: "all" }).view, "all");
  assert.equal(caseQuery({ view: "queue" }).view, "queue");
  for (const view of ["", "HISTORY", "everything", "reviewed", null]) {
    assert.equal(caseQuery({ view }).view, "queue", `view=${String(view)} falls back to the queue`);
  }
});

test("the limit is clamped rather than refused", () => {
  assert.equal(caseQuery({ limit: "50" }).limit, 50);
  assert.equal(caseQuery({ limit: "0" }).limit, 1, "a page of nothing is not useful");
  assert.equal(caseQuery({ limit: "-10" }).limit, 1);
  assert.equal(caseQuery({ limit: "99999" }).limit, MAX_CASE_LIMIT);
  assert.equal(caseQuery({ limit: String(MAX_CASE_LIMIT) }).limit, MAX_CASE_LIMIT);
});

test("an unreadable limit shows the first page instead of failing", () => {
  // A bookmarked URL with a bad limit should still list cases.
  for (const limit of ["many", "12.5", "NaN"]) {
    assert.equal(caseQuery({ limit }).limit, DEFAULT_CASE_LIMIT, `limit=${limit}`);
  }
});

test("an empty limit asks for one case, as it always has", () => {
  // `?limit=` parses as 0 and clamps to 1, rather than falling back to the
  // default like an unparseable limit does. Carried over unchanged from the
  // handler: preserved, not endorsed.
  assert.equal(caseQuery({ limit: "" }).limit, 1);
});

test("the offset never goes negative", () => {
  assert.equal(caseQuery({ offset: "40" }).offset, 40);
  assert.equal(caseQuery({ offset: "-40" }).offset, 0);
  assert.equal(caseQuery({ offset: "back a bit" }).offset, 0);
});

const totals = { queue_count: 7, history_count: 12, total_count: 31 } as CaseTotals;

test("the paging footer counts the view being shown, not the table", () => {
  assert.equal(viewCount("queue", totals), 7);
  assert.equal(viewCount("history", totals), 12);
  assert.equal(viewCount("all", totals), 31);
});

test("a view of an environment with no cases counts zero, not undefined", () => {
  for (const view of ["queue", "history", "all"] as const) {
    assert.equal(viewCount(view, undefined), 0);
  }
});
