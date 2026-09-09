import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { periodRulesRefreshSql, refreshPeriodRules } from "./assessment/ruleRefresh";
import { sql as sqlModule } from "./db";
import { markRulesChanged } from "./assessment/ruleChange";

// The SQL these compose cannot be executed here - it needs a server - so what
// is checked is the shape a reader has to trust: which periods are reachable,
// which are not, and that nothing runs at all before migration 112.

interface Captured { query: string; inputs: Record<string, unknown> }

function fakeExecutor(recordset: unknown[] = [{ staled: 0 }]) {
  const captured: Captured[] = [];
  const request = () => {
    const inputs: Record<string, unknown> = {};
    const self = {
      input(name: string, _type: unknown, value: unknown) { inputs[name] = value; return self; },
      async query(query: string) { captured.push({ query, inputs }); return { recordset }; },
      async batch(query: string) { captured.push({ query, inputs }); return { recordset }; },
    };
    return self;
  };
  return { executor: { request } as never, captured };
}

test("no rule change is recorded before migration 112 has run", async () => {
  const { executor, captured } = fakeExecutor();
  const staled = await markRulesChanged(executor, {}, "someone", false);
  assert.equal(staled, 0);
  // Not merely a no-op result: no statement is issued at all. Without the lock
  // column a finalised period is indistinguishable from a draft, and marking
  // one stale would invite a recompute of a figure already issued.
  assert.equal(captured.length, 0);
});

test("only drafting periods are marked stale", async () => {
  const { executor, captured } = fakeExecutor([{ staled: 2 }]);
  const staled = await markRulesChanged(executor, {}, "someone", true);
  assert.equal(staled, 2);
  const { query } = captured[0];
  assert.match(query, /p\.rules_locked_at IS NULL/);
  for (const status of ["open", "in_review", "in_validation", "stale", "reopened"]) {
    assert.ok(query.includes(`'${status}'`), `${status} should be reachable`);
  }
  // A finalised or issued month keeps the rules its figure was agreed under.
  assert.ok(!query.includes("'finalized'"), query);
  assert.ok(!query.includes("'issued'"), query);
});

test("a rule change records why each period went stale", async () => {
  const { executor, captured } = fakeExecutor([{ staled: 1 }]);
  await markRulesChanged(executor, {}, "someone", true);
  const { query, inputs } = captured[0];
  assert.match(query, /INSERT ComplianceAssessmentAudit/);
  assert.match(query, /'stale_due_to_rule_change'/);
  assert.equal(inputs.actor, "someone");
});

test("an agreement-scoped change does not reach another agreement's periods", async () => {
  const { executor, captured } = fakeExecutor();
  await markRulesChanged(executor, { agreementId: "a-1" }, "someone", true);
  assert.match(captured[0].query, /p\.agreement_id=@agreement/);
  assert.equal(captured[0].inputs.agreement, "a-1");
});

test("a catalog-wide change is scoped to nothing but the drafting state", async () => {
  const { executor, captured } = fakeExecutor();
  await markRulesChanged(executor, {}, "someone", true);
  assert.ok(!captured[0].query.includes("@agreement"), captured[0].query);
  assert.ok(!captured[0].query.includes("@contractor"), captured[0].query);
});

const SCOPE = {
  scoped: true, snapshotsResolver: true, penaltyScaling: true,
  snapshotsSeverity: true, windowModes: true, categorised: true, rulesLock: true,
};

test("refreshing a period's rules replaces the snapshot rather than adding to it", () => {
  const query = periodRulesRefreshSql(SCOPE);
  // Both snapshot tables are cleared first. Inserting over the top would leave
  // a standard that has since been unassigned still scoring.
  assert.match(query, /DELETE FROM AssessmentPeriodTiers WHERE period_id=@period/);
  assert.match(query, /DELETE FROM AssessmentPeriodStandards WHERE period_id=@period/);
  assert.ok(query.indexOf("DELETE FROM AssessmentPeriodStandards")
    < query.indexOf("INSERT AssessmentPeriodStandards"), "the delete must precede the insert");
});

test("a queue row for a standard that dropped out is removed", () => {
  // Left behind it would sit in the reviewer's queue scoring nothing, and
  // invite somebody to act on a standard this contractor is no longer held to.
  assert.match(periodRulesRefreshSql(SCOPE), /DELETE k FROM PeriodKpiAssessments k/);
});

test("the rule-set hash is rewritten from the rules that will be applied", () => {
  // An issued report cites this hash. Refreshing the snapshot and leaving the
  // hash would have it attest to a rule set that no longer exists.
  assert.match(periodRulesRefreshSql(SCOPE), /rule_set_sha256=CONVERT\(char\(64\),HASHBYTES/);
});

test("the refresh only names columns the database has", () => {
  const before102 = {
    scoped: false, snapshotsResolver: false, penaltyScaling: false,
    snapshotsSeverity: false, windowModes: false, categorised: false, rulesLock: true,
  };
  const query = periodRulesRefreshSql(before102);
  // The same guarantee every other composed statement gives: an unknown column
  // fails at parse time and takes the whole batch with it.
  assert.ok(!query.includes("AgreementStandards"), query);
  assert.ok(!query.includes("severity_order"), query);
  assert.ok(!query.includes("resolver_key"), query);
});

// The defect this test exists for: the statement joined on @agreement and
// nothing bound it, so every recompute of a drafting period failed with
// "Must declare the scalar variable @agreement" - on a path only reached once
// somebody had already changed the rules. Asserting on the query text alone
// could not see it, so the parameters are checked against the text that uses
// them.
test("every parameter the refresh names is bound", async () => {
  const bound = new Set<string>();
  const request = {
    input(name: string, _type: unknown, _value: unknown) { bound.add(name); return request; },
    async query(_query: string) { return { recordset: [] }; },
  };
  const fakeTx = { __fake: true } as never;
  const original = sqlModule.Request;
  (sqlModule as { Request: unknown }).Request = function () { return request; };
  try {
    await refreshPeriodRules(fakeTx, SCOPE, { id: "p-1", service_month: "202608", agreement_id: "a-1" });
  } finally {
    (sqlModule as { Request: unknown }).Request = original;
  }
  const named = new Set([...periodRulesRefreshSql(SCOPE).matchAll(/@([a-z_]+)/gi)].map((m) => m[1]));
  named.delete("rules"); // a local DECLARE, not a parameter
  for (const parameter of named) {
    assert.ok(bound.has(parameter), `@${parameter} is used but never bound`);
  }
});

test("the refresh bounds tiers to the month it is scoring", () => {
  const query = periodRulesRefreshSql(SCOPE);
  assert.match(query, /t\.effective_start_date<=CONCAT\(@month,'01'\)/);
  assert.match(query, /t\.effective_end_date IS NULL OR t\.effective_end_date>=CONCAT\(@month,'01'\)/);
});

// The migration says what it does, and the checks a reader would want.
test("migration 112 adds the lock column and backfills conservatively", () => {
  const file = path.join(process.cwd(), "sql", "migration-112a-period-rules-lock.sql");
  const text = readFileSync(file, "utf8");
  assert.match(text, /ADD rules_locked_at DATETIME2 NULL/);
  assert.match(text, /Re-runnable/);
  // Only ever sets the column where it is unset, so a re-run cannot move a
  // lock time that has already been recorded.
  assert.match(text, /WHERE rules_locked_at IS NULL/);
  // Every stage where a figure has been relied upon is locked, including
  // 'reopened' - a correction must recompute the rules it is correcting.
  for (const status of ["finalized", "issued", "reopened"]) {
    assert.ok(text.includes(`'${status}'`), `${status} must be locked by the backfill`);
  }
});
