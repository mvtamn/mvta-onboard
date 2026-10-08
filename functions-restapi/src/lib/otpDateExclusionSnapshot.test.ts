import assert from "node:assert/strict";
import test from "node:test";
import { matchable, refusalMessage, type DateExclusionDeparture } from "./otpDateExclusionSnapshot";

const departure = (route_id: number, stop_id: number, total = 10): DateExclusionDeparture =>
  ({ route_id, stop_id, total, ontime: 8, early: 1, late: 1, missed: 0 });

test("only departures the month can actually subtract from are frozen", () => {
  const monthly = new Set(["490-13209", "444-31928"]);
  const rows = matchable([departure(490, 13209), departure(444, 31928), departure(999, 1)], monthly);
  assert.deepEqual(rows.map((row) => `${row.route_id}-${row.stop_id}`), ["490-13209", "444-31928"]);
});

test("a snapshot row matching nothing is dropped rather than stored subtracting nothing", () => {
  // Route 999 is Dead Head - classified NonRevenue, and absent from the
  // monthly feed entirely. Storing it would make the approved date look
  // evidenced while moving no figure.
  assert.deepEqual(matchable([departure(999, 1)], new Set(["490-13209"])), []);
  assert.deepEqual(matchable([], new Set(["490-13209"])), []);
});

test("every refusal says what to do about it", () => {
  const noDaily = refusalMessage({ kind: "no_daily_data" }, "20260105");
  assert.match(noDaily, /20260105/);
  // The two real reasons a date is unavailable, both named.
  assert.match(noDaily, /90 days/);
  assert.match(noDaily, /2026-09-14/);

  const absent = refusalMessage({ kind: "day_of_week_absent", dayOfWeek: "Sun" }, "20260920");
  assert.match(absent, /Sun/);
  assert.match(absent, /polled/);

  assert.match(refusalMessage({ kind: "nothing_to_subtract" }, "20260915"), /20260915/);
});
