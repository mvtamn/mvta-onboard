import assert from "node:assert/strict";
import test from "node:test";
import {
  decidePromotion,
  detectorStandings,
  ignoredDetectorNames,
  isPromotedOn,
  promotionWindows,
  promotionWindowsSql,
  type DetectorPromotionEntry,
  type PromotionRequest,
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

// ---------------------------------------------------------------------------
// Making the decision

const ask = (overrides: Partial<PromotionRequest> = {}): PromotionRequest => ({
  detector: "gtfs_silent_no_show",
  effective_service_date: "20261001",
  promoted: true,
  reason: "97.2% precision over the service week of 21 September",
  measured_precision: 0.972,
  sample_size: 143,
  ...overrides,
});

const refusalOf = (input: PromotionRequest, history: DetectorPromotionEntry[] = []) => {
  const decision = decidePromotion(history, input);
  return decision.ok ? "ok" : decision.refusal.code;
};

test("a promotion is recorded when it clears CONTEXT's bar", () => {
  const decision = decidePromotion([], ask());
  assert.ok(decision.ok);
  assert.deepEqual(decision.entry, {
    detector: "gtfs_silent_no_show", effective_service_date: "20261001", promoted: true,
    reason: "97.2% precision over the service week of 21 September",
    measured_precision: 0.972, sample_size: 143,
  });
});

test("a promotion below the bar is refused, and the refusal shows the measurement", () => {
  const decision = decidePromotion([], ask({ measured_precision: 0.88 }));
  assert.ok(!decision.ok);
  assert.equal(decision.refusal.code, "below_precision_bar");
  assert.match(decision.refusal.sentence, /88\.0% precision/);
  assert.match(decision.refusal.sentence, /95%/);
});

test("a promotion says what it measured, and on how much", () => {
  assert.equal(refusalOf(ask({ measured_precision: null })), "evidence_required");
  assert.equal(refusalOf(ask({ sample_size: 0 })), "evidence_required");
  assert.equal(refusalOf(ask({ reason: "   " })), "reason_required");
  assert.equal(refusalOf(ask({ effective_service_date: "October" })), "bad_service_date");
  assert.equal(refusalOf(ask({ detector: "gtfs_silent_noshow" })), "unknown_detector");
});

test("the on-demand detector carries its extra conditions into the record", () => {
  assert.equal(refusalOf(ask({ detector: "spare" })), "on_demand_conditions");
  const decision = decidePromotion([], ask({ detector: "spare", on_demand_conditions_met: true }));
  assert.ok(decision.ok);
  assert.match(decision.entry.reason, /dispatcher agreement/);
});

test("demotion asks for none of the evidence promotion does", () => {
  const history = [entry()];
  const decision = decidePromotion(history, ask({
    promoted: false, effective_service_date: "20261101", reason: "misfiring on short turns",
    measured_precision: null, sample_size: null,
  }));
  assert.ok(decision.ok);
  assert.equal(decision.entry.promoted, false);
});

test("a decision that changes nothing is refused rather than recorded", () => {
  const history = [entry()];
  assert.equal(refusalOf(ask({ effective_service_date: "20261001" }), history), "no_change");
  assert.equal(refusalOf(ask({ promoted: false, effective_service_date: "20260801", reason: "x" }), history), "no_change");
  // Before it was promoted, promoting is a real change.
  assert.equal(refusalOf(ask({ effective_service_date: "20260801" }), history), "ok");
});

test("standings say which detectors count today, and since when", () => {
  const windows = promotionWindows([entry(), entry({ detector: "spare", effective_service_date: "20261001" })]);
  assert.deepEqual(detectorStandings(windows, "20260915"), [
    { detector: "gtfs_cancellation", promoted: false, since: null },
    { detector: "gtfs_silent_no_show", promoted: true, since: "20260901" },
    { detector: "spare", promoted: false, since: null },
  ]);
});
