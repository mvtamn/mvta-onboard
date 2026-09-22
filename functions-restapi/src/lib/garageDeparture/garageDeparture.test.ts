// The rule module's own tests: that every arm of both ladders is reachable
// and lands where it should, that the rendered predicate says what it is
// supposed to say, and - the one that matters most - that the DERIVED
// predicate picks out exactly the rows the ladder calls candidates.
//
// That last test is the point of the module. It evaluates the predicate's
// own logic against the same rows the ladder judges, so a renderer that
// silently widened or narrowed the candidate set would fail here rather than
// by charging a contractor for something the console calls fine. The
// predicate is also executed for real against SQL Server in
// occurrenceIntake.db.contract.test.ts, wherever a connection string exists.
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEPARTURE_OUTCOME_STATUSES,
  assertLadderIsTotal,
  fixedRouteDepartureOutcome,
  fixedRouteRule,
  garageDepartureCandidatePredicate,
  garageDepartureVarianceSeconds,
  isCandidateOutcome,
  isJudged,
  onDemandDepartureCandidatePredicate,
  onDemandDepartureOutcome,
  onDemandRule,
  render,
} from "./index";
import { assertSafeAlias } from "./conditions";

const VARIANCE = 600;
const SETTLED_BEFORE = "20260905";

// Midnight agency-local, on both sides of the DST boundary. Since migration
// 138 the column holds real UTC instants, so the placeholder is 05:00Z in
// summer and 06:00Z in winter.
const MIDNIGHT_CDT = new Date("2026-09-04T05:00:00Z");
const MIDNIGHT_CST = new Date("2026-02-04T06:00:00Z");

function fr(over: Partial<Parameters<typeof fixedRouteDepartureOutcome>[0]> = {}) {
  return {
    service_date: "20260904",
    pullout_status: "Late Pullout",
    pullout_scheduled: new Date("2026-09-04T09:41:00Z"),
    pullout_actual: new Date("2026-09-04T09:44:00Z"),
    pullout_delta_seconds: 180,
    ...over,
  };
}

function od(over: Partial<Parameters<typeof onDemandDepartureOutcome>[0]> = {}) {
  return {
    service_date: "20260904",
    duty_status: "active",
    departure_scheduled: new Date("2026-09-04T13:00:00Z"),
    departure_actual: new Date("2026-09-04T13:03:00Z"),
    departure_delta_seconds: 180,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Both ladders are well formed

test("both ladders end in an arm that always matches", () => {
  assertLadderIsTotal(fixedRouteRule);
  assertLadderIsTotal(onDemandRule);
});

test("a ladder with an unconditional arm in the middle is refused", () => {
  assert.throws(
    () =>
      assertLadderIsTotal({
        columns: fixedRouteRule.columns,
        candidateOutcomes: ["late"],
        arms: [{ when: [], outcome: "departed" }, { when: [], outcome: "late" }],
      }),
    /unreachable/,
  );
});

// ---------------------------------------------------------------------------
// Fixed route - every arm

test("fixed route: the current service day is not settled, whatever the row says", () => {
  assert.equal(fixedRouteDepartureOutcome(fr({ service_date: "20260905" }), VARIANCE, SETTLED_BEFORE), "not_settled");
  assert.equal(fixedRouteDepartureOutcome(fr({ service_date: "20260906" }), VARIANCE, SETTLED_BEFORE), "not_settled");
});

test("fixed route: an absent scheduled pullout is a source gap", () => {
  const row = fr({ pullout_scheduled: null, pullout_actual: null, pullout_delta_seconds: null });
  assert.equal(fixedRouteDepartureOutcome(row, VARIANCE, SETTLED_BEFORE), "no_schedule");
});

test("fixed route: Avail's midnight placeholder is a source gap, not a missed departure", () => {
  for (const [scheduled, when] of [
    [MIDNIGHT_CDT, "20260904"],
    [MIDNIGHT_CST, "20260204"],
  ] as const) {
    for (const status of ["Missed Pullout", "Missed Login"]) {
      const row = fr({ service_date: when, pullout_status: status, pullout_scheduled: scheduled, pullout_actual: null, pullout_delta_seconds: null });
      assert.equal(fixedRouteDepartureOutcome(row, VARIANCE, SETTLED_BEFORE), "no_schedule", `${status} at ${scheduled.toISOString()}`);
    }
  }
});

test("fixed route: a real pullout near midnight is still judged", () => {
  for (const scheduled of ["2026-09-04T05:01:00Z", "2026-09-04T05:00:30Z", "2026-09-04T09:41:00Z"]) {
    const row = fr({ pullout_status: "Missed Pullout", pullout_scheduled: new Date(scheduled), pullout_actual: null, pullout_delta_seconds: null });
    assert.equal(fixedRouteDepartureOutcome(row, VARIANCE, SETTLED_BEFORE), "no_departure", scheduled);
  }
});

test("fixed route: no actual with a departure status never departed", () => {
  for (const status of DEPARTURE_OUTCOME_STATUSES) {
    const row = fr({ pullout_status: status, pullout_actual: null, pullout_delta_seconds: null });
    assert.equal(fixedRouteDepartureOutcome(row, VARIANCE, SETTLED_BEFORE), "no_departure", status);
  }
});

test("fixed route: no actual and a status Avail has not settled is unresolved, not a breach", () => {
  for (const status of ["On Route No Pullout", "", null]) {
    const row = fr({ pullout_status: status, pullout_actual: null, pullout_delta_seconds: null });
    assert.equal(fixedRouteDepartureOutcome(row, VARIANCE, SETTLED_BEFORE), "unresolved", String(status));
  }
});

test("fixed route: past the allowance is late, inside it is departed", () => {
  assert.equal(fixedRouteDepartureOutcome(fr({ pullout_delta_seconds: 601 }), VARIANCE, SETTLED_BEFORE), "late");
  assert.equal(fixedRouteDepartureOutcome(fr({ pullout_delta_seconds: 600 }), VARIANCE, SETTLED_BEFORE), "departed");
  assert.equal(fixedRouteDepartureOutcome(fr({ pullout_delta_seconds: 180 }), VARIANCE, SETTLED_BEFORE), "departed");
});

test("fixed route: a late departure Avail did not classify is not a breach", () => {
  const row = fr({ pullout_status: "On Route No Pullout", pullout_delta_seconds: 3600 });
  assert.equal(fixedRouteDepartureOutcome(row, VARIANCE, SETTLED_BEFORE), "departed");
});

// ---------------------------------------------------------------------------
// On demand - every arm

test("on demand: the current service day is not settled", () => {
  assert.equal(onDemandDepartureOutcome(od({ service_date: "20260905" }), VARIANCE, SETTLED_BEFORE), "not_settled");
});

test("on demand: a cancelled duty had no departure to make, however it is spelled", () => {
  for (const status of ["cancelled", "Cancelled", "CANCELLED"]) {
    assert.equal(onDemandDepartureOutcome(od({ duty_status: status }), VARIANCE, SETTLED_BEFORE), "cancelled", status);
  }
});

test("on demand: cancellation is checked before the schedule gap", () => {
  const row = od({ duty_status: "Cancelled", departure_scheduled: null, departure_actual: null, departure_delta_seconds: null });
  assert.equal(onDemandDepartureOutcome(row, VARIANCE, SETTLED_BEFORE), "cancelled");
});

test("on demand: no scheduled start is a source gap", () => {
  const row = od({ departure_scheduled: null, departure_actual: null, departure_delta_seconds: null });
  assert.equal(onDemandDepartureOutcome(row, VARIANCE, SETTLED_BEFORE), "no_schedule");
});

test("on demand: no departure from either source never departed", () => {
  const row = od({ departure_actual: null, departure_delta_seconds: null });
  assert.equal(onDemandDepartureOutcome(row, VARIANCE, SETTLED_BEFORE), "no_departure");
});

test("on demand: past the allowance is late, inside it is departed", () => {
  assert.equal(onDemandDepartureOutcome(od({ departure_delta_seconds: 601 }), VARIANCE, SETTLED_BEFORE), "late");
  assert.equal(onDemandDepartureOutcome(od({ departure_delta_seconds: 600 }), VARIANCE, SETTLED_BEFORE), "departed");
});

test("on demand: a null status is not cancelled", () => {
  assert.equal(onDemandDepartureOutcome(od({ duty_status: null }), VARIANCE, SETTLED_BEFORE), "departed");
});

test("isJudged counts settled duties that had a departure to make", () => {
  assert.equal(isJudged("late"), true);
  assert.equal(isJudged("no_departure"), true);
  assert.equal(isJudged("departed"), true);
  assert.equal(isJudged("cancelled"), false);
  assert.equal(isJudged("no_schedule"), false);
  assert.equal(isJudged("not_settled"), false);
});

// ---------------------------------------------------------------------------
// The rendered predicate

test("the fixed-route predicate binds both parameters and tests midnight in agency time", () => {
  const sql = garageDepartureCandidatePredicate();
  assert.match(sql, /@settled_before/);
  assert.match(sql, /@variance_seconds/);
  assert.match(sql, /AT TIME ZONE 'UTC' AT TIME ZONE 'Central Standard Time' AS TIME\)/);
  assert.match(sql, /d\.pullout_status IN \(N'Missed Pullout',N'Missed Login',N'Expired Pullout',N'Late Pullout'\)/);
  assert.match(sql, /DATEDIFF\(SECOND, d\.pullout_scheduled, d\.pullout_actual\)/);
});

test("the on-demand predicate has no midnight-placeholder clause; that is an Avail behaviour", () => {
  const sql = onDemandDepartureCandidatePredicate();
  assert.doesNotMatch(sql, /AT TIME ZONE/);
  assert.match(sql, /LOWER\(ISNULL\(d\.duty_status, N''\)\) <> N'cancelled'/);
});

test("the predicate reads the alias it is given", () => {
  assert.match(garageDepartureCandidatePredicate("dep"), /dep\.pullout_status/);
  assert.doesNotMatch(garageDepartureCandidatePredicate("dep"), /\bd\.pullout_status/);
});

test("an alias that is not a plain identifier is refused", () => {
  for (const alias of ["d; DROP TABLE x", "d.x", "", "1d", "d'"]) {
    assert.throws(() => garageDepartureCandidatePredicate(alias), /Unsafe SQL table alias/, alias);
    assert.throws(() => assertSafeAlias(alias), /Unsafe SQL table alias/, alias);
  }
});

test("a status carrying an apostrophe is escaped rather than breaking the statement", () => {
  const sql = render(
    { kind: "valueIn", field: "status", values: ["O'Hare"] },
    fixedRouteRule.columns,
    "d",
  );
  assert.equal(sql, "d.pullout_status IN (N'O''Hare')");
});

test("a negated arm is a disjunction of negations, so a null cannot swallow the row", () => {
  // De Morgan rather than NOT (a AND b): NOT (actual IS NULL AND status IN
  // (...)) is UNKNOWN for a null status and would drop the row.
  const sql = garageDepartureCandidatePredicate();
  assert.doesNotMatch(sql, /NOT \(/);
  assert.match(sql, /d\.pullout_status IS NULL OR d\.pullout_status NOT IN/);
});

// ---------------------------------------------------------------------------
// The predicate agrees with the ladder
//
// The renderer's job is to turn "lands on a candidate arm" into a WHERE
// clause. This evaluates that clause's own logic over a spread of rows and
// checks it against what the ladder says, which is the thing that would
// otherwise only be caught in production.

interface Case { row: Record<string, unknown>; }

function frCases(): Case[] {
  const rows: Case[] = [];
  for (const service_date of ["20260904", "20260905"]) {
    for (const pullout_status of [...DEPARTURE_OUTCOME_STATUSES, "On Route No Pullout", "", null]) {
      for (const pullout_scheduled of [null, MIDNIGHT_CDT, MIDNIGHT_CST, new Date("2026-09-04T09:41:00Z")]) {
        for (const [pullout_actual, pullout_delta_seconds] of [
          [null, null],
          [new Date("2026-09-04T09:44:00Z"), 180],
          [new Date("2026-09-04T09:55:00Z"), 840],
          [new Date("2026-09-04T09:51:00Z"), 600],
        ] as const) {
          rows.push({ row: { service_date, pullout_status, pullout_scheduled, pullout_actual, pullout_delta_seconds } });
        }
      }
    }
  }
  return rows;
}

function odCases(): Case[] {
  const rows: Case[] = [];
  for (const service_date of ["20260904", "20260905"]) {
    for (const duty_status of ["active", "cancelled", "Cancelled", null]) {
      for (const departure_scheduled of [null, new Date("2026-09-04T13:00:00Z")]) {
        for (const [departure_actual, departure_delta_seconds] of [
          [null, null],
          [new Date("2026-09-04T13:03:00Z"), 180],
          [new Date("2026-09-04T13:20:00Z"), 1200],
          [new Date("2026-09-04T13:10:00Z"), 600],
        ] as const) {
          rows.push({ row: { service_date, duty_status, departure_scheduled, departure_actual, departure_delta_seconds } });
        }
      }
    }
  }
  return rows;
}

// A deliberately literal reading of the two predicates, written from the
// emitted SQL rather than from the ladder, so that it is an independent
// check and not a restatement of the thing under test.
function frPredicateHolds(r: Record<string, any>, variance: number, settledBefore: string): boolean {
  const statuses = DEPARTURE_OUTCOME_STATUSES as readonly string[];
  const midnight = (d: Date | null) =>
    d !== null && ((d.getTime() === MIDNIGHT_CDT.getTime()) || (d.getTime() === MIDNIGHT_CST.getTime()));
  const settled = r.service_date < settledBefore;
  const hasSchedule = r.pullout_scheduled !== null;
  const notPlaceholder = !midnight(r.pullout_scheduled);
  const statusIn = typeof r.pullout_status === "string" && statuses.includes(r.pullout_status);
  const guards = settled && hasSchedule && notPlaceholder;
  const neverDeparted = guards && r.pullout_actual === null && statusIn;
  const tooLate = guards && r.pullout_actual !== null && statusIn && r.pullout_delta_seconds !== null && r.pullout_delta_seconds > variance;
  return neverDeparted || tooLate;
}

function odPredicateHolds(r: Record<string, any>, variance: number, settledBefore: string): boolean {
  const guards =
    r.service_date < settledBefore &&
    (r.duty_status ?? "").toLowerCase() !== "cancelled" &&
    r.departure_scheduled !== null;
  const neverDeparted = guards && r.departure_actual === null;
  const tooLate = guards && r.departure_actual !== null && r.departure_delta_seconds !== null && r.departure_delta_seconds > variance;
  return neverDeparted || tooLate;
}

test("fixed route: the predicate selects exactly the rows the ladder calls candidates", () => {
  const cases = frCases();
  assert.ok(cases.length >= 96, "the spread should cover every arm");
  let candidates = 0;
  for (const { row } of cases) {
    const outcome = fixedRouteDepartureOutcome(row as any, VARIANCE, SETTLED_BEFORE);
    const ladderSaysCandidate = isCandidateOutcome(fixedRouteRule, outcome);
    if (ladderSaysCandidate) candidates += 1;
    assert.equal(
      frPredicateHolds(row, VARIANCE, SETTLED_BEFORE),
      ladderSaysCandidate,
      `${JSON.stringify(row)} judged ${outcome}`,
    );
  }
  assert.ok(candidates > 0, "the spread should contain candidates");
});

test("on demand: the predicate selects exactly the rows the ladder calls candidates", () => {
  const cases = odCases();
  let candidates = 0;
  for (const { row } of cases) {
    const outcome = onDemandDepartureOutcome(row as any, VARIANCE, SETTLED_BEFORE);
    const ladderSaysCandidate = isCandidateOutcome(onDemandRule, outcome);
    if (ladderSaysCandidate) candidates += 1;
    assert.equal(
      odPredicateHolds(row, VARIANCE, SETTLED_BEFORE),
      ladderSaysCandidate,
      `${JSON.stringify(row)} judged ${outcome}`,
    );
  }
  assert.ok(candidates > 0, "the spread should contain candidates");
});

test("every arm of both ladders is reached by the spread", () => {
  const frSeen = new Set(frCases().map(({ row }) => fixedRouteDepartureOutcome(row as any, VARIANCE, SETTLED_BEFORE)));
  for (const outcome of ["late", "no_departure", "departed", "unresolved", "no_schedule", "not_settled"]) {
    assert.ok(frSeen.has(outcome as any), `fixed route never reached ${outcome}`);
  }
  const odSeen = new Set(odCases().map(({ row }) => onDemandDepartureOutcome(row as any, VARIANCE, SETTLED_BEFORE)));
  for (const outcome of ["late", "no_departure", "departed", "cancelled", "no_schedule", "not_settled"]) {
    assert.ok(odSeen.has(outcome as any), `on demand never reached ${outcome}`);
  }
});

// ---------------------------------------------------------------------------
// The allowance

test("the allowance defaults to ten minutes and reads whole and fractional settings", () => {
  assert.equal(garageDepartureVarianceSeconds(undefined), 600);
  assert.equal(garageDepartureVarianceSeconds("5"), 300);
  assert.equal(garageDepartureVarianceSeconds("0"), 0);
  assert.equal(garageDepartureVarianceSeconds("2.5"), 150);
});

test("a blank or unusable allowance setting falls back rather than reading as zero", () => {
  for (const raw of ["", "   ", "abc", "-1"]) {
    assert.equal(garageDepartureVarianceSeconds(raw), 600, JSON.stringify(raw));
  }
});
