import assert from "node:assert/strict";
import test from "node:test";
import {
  ignoredDetectorNames,
  isPromotedOn,
  promotionWindows,
  promotionWindowsSql,
  type DetectorPromotionEntry,
} from "./promotion";

const entry = (overrides: Partial<DetectorPromotionEntry> = {}): DetectorPromotionEntry => ({
  detector: "gtfs_silent_no_show",
  effective_service_date: "20260901",
  promoted: true,
  reason: "95% precision over a service week",
  measured_precision: 0.95,
  sample_size: 120,
  decided_by: "ops@example.com",
  decided_at: new Date("2026-09-18T12:00:00Z"),
  ...overrides,
});

test("a promotion opens a span that runs from its service date", () => {
  const windows = promotionWindows([entry()]);
  assert.deepEqual(windows, [{ detector: "gtfs_silent_no_show", from: "20260901", until: null }]);
  assert.equal(isPromotedOn(windows, "gtfs_silent_no_show", "20260901"), true);
  assert.equal(isPromotedOn(windows, "gtfs_silent_no_show", "20261231"), true);
  // Promoting today does not rewrite an assessed month.
  assert.equal(isPromotedOn(windows, "gtfs_silent_no_show", "20260831"), false);
  assert.equal(isPromotedOn(windows, "spare", "20260901"), false);
});

test("a demotion closes the span, and the months it was trusted for keep counting", () => {
  const windows = promotionWindows([
    entry(),
    entry({ effective_service_date: "20261001", promoted: false, reason: "misfiring on short turns" }),
  ]);
  assert.deepEqual(windows, [{ detector: "gtfs_silent_no_show", from: "20260901", until: "20261001" }]);
  assert.equal(isPromotedOn(windows, "gtfs_silent_no_show", "20260930"), true);
  assert.equal(isPromotedOn(windows, "gtfs_silent_no_show", "20261001"), false);
});

test("a detector can be promoted again after a demotion", () => {
  const windows = promotionWindows([
    entry(),
    entry({ effective_service_date: "20261001", promoted: false }),
    entry({ effective_service_date: "20261101" }),
  ]);
  assert.equal(windows.length, 2);
  assert.equal(isPromotedOn(windows, "gtfs_silent_no_show", "20261015"), false);
  assert.equal(isPromotedOn(windows, "gtfs_silent_no_show", "20261101"), true);
});

test("a decision that repeats the state it is already in changes nothing", () => {
  assert.deepEqual(
    promotionWindows([entry(), entry({ effective_service_date: "20260915" })]),
    [{ detector: "gtfs_silent_no_show", from: "20260901", until: null }],
  );
});

test("a same-day reversal leaves no span at all", () => {
  assert.deepEqual(
    promotionWindows([entry(), entry({ promoted: false, decided_at: new Date("2026-09-18T13:00:00Z") })]),
    [],
  );
});

test("an unknown or malformed decision promotes nothing", () => {
  assert.deepEqual(promotionWindows([entry({ detector: "typo" as never })]), []);
  assert.deepEqual(promotionWindows([entry({ effective_service_date: "2026-09-01" })]), []);
  assert.deepEqual(ignoredDetectorNames([{ detector: "typo" }, { detector: "spare" }]), ["typo"]);
});

test("an undated case cannot be promoted into an assessment", () => {
  const windows = promotionWindows([entry()]);
  assert.equal(isPromotedOn(windows, "gtfs_silent_no_show", null), false);
  assert.equal(isPromotedOn(windows, "gtfs_silent_no_show", ""), false);
});

test("the SQL says the same thing, as literals", () => {
  const windows = promotionWindows([
    entry(),
    entry({ effective_service_date: "20261001", promoted: false }),
  ]);
  assert.equal(
    promotionWindowsSql("d", "s", windows),
    "(d = N'gtfs_silent_no_show' AND LEFT(s, 8) >= N'20260901' AND LEFT(s, 8) < N'20261001')",
  );
  assert.equal(promotionWindowsSql("d", "s", []), "1 = 0");
  assert.throws(() => promotionWindowsSql("d", "s", [{ detector: "spare", from: "oops", until: null }]), TypeError);
});
