import assert from "node:assert/strict";
import test from "node:test";
import { figure, routeFigures, total, type RouteRow } from "./figures";

// The arithmetic a contractor is assessed on. None of this could be checked
// without a SQL Server until it came out of measureOtpMonth: it was private
// helpers reachable only through the db contract test, which skips without a
// connection, and ADR 0038 then added the stop/date split to the same code.

const row = (over: Partial<RouteRow> = {}): RouteRow => ({
  service_month: "202609", route_id: 460, route_label: "460", route_category: "FixedRoute",
  raw_total: 100, raw_ontime: 80,
  before_dates_total: 100, before_dates_ontime: 80,
  total: 100, ontime: 80,
  ...over,
});

test("a share is on-time over departures, and nothing over nothing is not a share", () => {
  assert.deepEqual(figure(100, 85), { departures: 100, ontime: 85, pct: 0.85 });
  // Not 0, and not 1: a route with no departures has no on-time percentage,
  // and reporting 0% would read as total failure.
  assert.deepEqual(figure(0, 0), { departures: 0, ontime: 0, pct: null });
});

test("a route with nothing assessable is neither below target nor above it", () => {
  // A special-event route is outside the fixed-route standard. Saying "meets"
  // would put it in the same column as a route that genuinely hit 95%.
  const [special] = routeFigures([row({ route_category: "SpecialEvent", total: 0, ontime: 0, before_dates_total: 0, before_dates_ontime: 0 })], 0.85);
  assert.equal(special?.below_target, null);
  assert.equal(special?.assessable.pct, null);
});

test("below target is strictly below, so a route exactly on it meets", () => {
  const at = routeFigures([row({ total: 100, ontime: 85 })], 0.85)[0];
  assert.equal(at?.below_target, false);
  const under = routeFigures([row({ total: 100, ontime: 84 })], 0.85)[0];
  assert.equal(under?.below_target, true);
});

test("excluded is what the two rules took out between them", () => {
  // 100 raw; the stop rule removes 20; an approved date removes 30 more.
  const [r] = routeFigures([row({
    raw_total: 100, raw_ontime: 80,
    before_dates_total: 80, before_dates_ontime: 64,
    total: 50, ontime: 40,
  })], 0.85);
  assert.deepEqual([r!.raw.departures, r!.assessable.departures], [100, 50]);
  assert.equal(r!.excluded.departures, 50);
  assert.equal(r!.stop_excluded.departures, 20);
  assert.equal(r!.date_excluded.departures, 30);
  // The halves are differences between successive stages of one query, so
  // they add up to the whole and cannot overlap.
  assert.equal(r!.stop_excluded.departures + r!.date_excluded.departures, r!.excluded.departures);
  assert.equal(r!.stop_excluded.ontime + r!.date_excluded.ontime, r!.excluded.ontime);
});

test("a date cannot remove a row the stop rule already removed", () => {
  // Everything the stop rule took out is gone before the date rule looks:
  // before_dates equals assessable, so the date half is zero rather than
  // double-counting the same departures.
  const [r] = routeFigures([row({
    raw_total: 100, raw_ontime: 80,
    before_dates_total: 60, before_dates_ontime: 48,
    total: 60, ontime: 48,
  })], 0.85);
  assert.equal(r!.stop_excluded.departures, 40);
  assert.equal(r!.date_excluded.departures, 0);
  assert.equal(r!.excluded.departures, 40);
});

test("a route nothing was taken from reports no exclusions at all", () => {
  const [r] = routeFigures([row()], 0.85);
  assert.equal(r!.excluded.departures, 0);
  assert.equal(r!.stop_excluded.departures, 0);
  assert.equal(r!.date_excluded.departures, 0);
  assert.equal(r!.excluded.pct, null, "nothing excluded has no share");
});

test("the agency line is the routes added up, not an average of their shares", () => {
  // 100 at 90% and 900 at 50% is 54%, not 70%. Averaging the percentages
  // would let a tiny route carry the same weight as a trunk route.
  const routes = routeFigures([
    row({ route_id: 1, raw_total: 100, raw_ontime: 90, before_dates_total: 100, before_dates_ontime: 90, total: 100, ontime: 90 }),
    row({ route_id: 2, raw_total: 900, raw_ontime: 450, before_dates_total: 900, before_dates_ontime: 450, total: 900, ontime: 450 }),
  ], 0.85);
  const agency = total(routes, (r) => r.assessable);
  assert.deepEqual([agency.departures, agency.ontime], [1000, 540]);
  assert.equal(agency.pct, 0.54);
});

test("the agency line over no routes is empty rather than zero per cent", () => {
  assert.deepEqual(total([], (r) => r.assessable), { departures: 0, ontime: 0, pct: null });
});

test("counts arriving as strings from the driver are still added, not concatenated", () => {
  // mssql can hand back a SUM as a string; "100" + "900" would be "100900".
  const routes = routeFigures([
    row({ raw_total: "100" as unknown as number, raw_ontime: "90" as unknown as number,
          before_dates_total: "100" as unknown as number, before_dates_ontime: "90" as unknown as number,
          total: "100" as unknown as number, ontime: "90" as unknown as number }),
  ], 0.85);
  assert.equal(routes[0]!.raw.departures, 100);
  assert.equal(total(routes, (r) => r.raw).departures, 100);
});
