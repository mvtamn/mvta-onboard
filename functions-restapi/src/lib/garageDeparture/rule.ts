// A garage-departure rule, and the two things derived from it.
//
// A rule is an ordered ladder of arms. Judging a row walks the ladder and
// takes the first arm whose every condition holds - exactly how the hand
// written rule read, because an if-ladder is what it was. The candidate
// predicate is then DERIVED from the same ladder rather than written again:
// a row is a candidate when it lands on an arm whose outcome is a candidate
// outcome, which is that arm's conditions holding while every arm above it
// failed.
//
// So the predicate is the OR, over the candidate arms, of (this arm's
// conditions AND the negation of each earlier arm). That is mechanical, and
// being mechanical is the whole benefit: there is no second place to forget a
// clause. What it costs is verbosity - the generated statement keeps guards a
// person would have simplified away by hand, because it does not know which
// ones imply each other. The DB contract test is what proves the two agree;
// see occurrenceIntake.db.contract.test.ts.
import {
  type ColumnMap,
  type Condition,
  type JudgementParameters,
  type JudgementRow,
  assertSafeAlias,
  evaluate,
  render,
} from "./conditions";

export interface Arm<Outcome extends string> {
  // Conditions are ANDed, and are always stated POSITIVELY. Negation belongs
  // to the renderer, because a hand-written negation is the one thing here
  // that can silently widen the set of rows charged to a contractor -
  // migration 088a had to write exactly that out by hand and annotate it as
  // "the exact negation of the poller's predicate".
  //
  // An empty list always matches and ends the ladder.
  when: readonly Condition[];
  outcome: Outcome;
}

export interface DepartureRule<Outcome extends string> {
  arms: readonly Arm<Outcome>[];
  // The outcomes that are worth raising against the assessment. The renderer
  // reads this to know which arms become disjuncts.
  candidateOutcomes: readonly Outcome[];
  columns: ColumnMap;
}

// Walk the ladder; first arm whose conditions all hold wins.
export function judge<Outcome extends string>(
  rule: DepartureRule<Outcome>,
  row: JudgementRow,
  params: JudgementParameters,
): Outcome {
  for (const arm of rule.arms) {
    if (arm.when.every((condition) => evaluate(condition, row, params))) return arm.outcome;
  }
  // Unreachable for a well-formed rule; assertLadderIsTotal guards it.
  throw new Error("Garage departure rule fell off the end of the ladder");
}

export function isCandidateOutcome<Outcome extends string>(
  rule: DepartureRule<Outcome>,
  outcome: Outcome,
): boolean {
  return rule.candidateOutcomes.includes(outcome);
}

// A rule must end in an arm that always matches, or a row can reach the end
// unjudged. Called by the declarations' own tests rather than at import time.
export function assertLadderIsTotal<Outcome extends string>(rule: DepartureRule<Outcome>): void {
  const last = rule.arms[rule.arms.length - 1];
  if (!last || last.when.length > 0) throw new Error("A garage departure rule must end in an unconditional arm");
  const earlyTotal = rule.arms.findIndex((arm) => arm.when.length === 0);
  if (earlyTotal !== rule.arms.length - 1) {
    throw new Error(`Arm ${earlyTotal} always matches, so every arm after it is unreachable`);
  }
}

// The negation of one arm: "this arm did not match".
function armDidNotMatch<Outcome extends string>(
  arm: Arm<Outcome>,
  columns: ColumnMap,
  alias: string,
): string {
  if (arm.when.length === 1) return render(arm.when[0], columns, alias, true);
  // De Morgan, rather than NOT (c1 AND c2). Each condition already knows how
  // to negate itself in a way that survives a NULL; wrapping the conjunction
  // in NOT would instead lean on three-valued logic - NOT (actual IS NULL AND
  // status IN (...)) is UNKNOWN for a null status, and the row would be
  // dropped rather than kept. That happens to come out right today only
  // because another clause in the same conjunction rules the case out, which
  // is not a property a rule should have to rely on.
  const disjunction = arm.when.map((condition) => render(condition, columns, alias, true)).join(" OR ");
  return `(${disjunction})`;
}

// The candidate predicate, derived from the ladder. `alias` is the table alias
// the caller's FROM clause uses.
//
// Emits `@settled_before` and `@variance_seconds`; a caller must bind both.
export function renderCandidatePredicate<Outcome extends string>(
  rule: DepartureRule<Outcome>,
  alias: string,
): string {
  assertSafeAlias(alias);
  assertLadderIsTotal(rule);
  const disjuncts: string[] = [];
  for (const [index, arm] of rule.arms.entries()) {
    if (!isCandidateOutcome(rule, arm.outcome)) continue;
    const clauses: string[] = [];
    for (const earlier of rule.arms.slice(0, index)) clauses.push(armDidNotMatch(earlier, rule.columns, alias));
    for (const condition of arm.when) clauses.push(render(condition, rule.columns, alias));
    // Two arms can guard on the same thing - the FR ladder reaches
    // `status IN (...)` twice - and repeating a clause in one conjunction
    // changes nothing but noise.
    disjuncts.push([...new Set(clauses)].join("\n              AND "));
  }
  if (disjuncts.length === 0) throw new Error("A garage departure rule must have at least one candidate arm");
  if (disjuncts.length === 1) return disjuncts[0];
  // Wrapped, because callers interpolate this into a longer WHERE clause and
  // AND binds tighter than OR. Unparenthesised, `code='GARAGE_DEPARTURE' AND
  // A OR B` parses as `(code='GARAGE_DEPARTURE' AND A) OR B`: the second arm
  // escapes the standard filter, cross-joins every standard, and the pass
  // inserts the same source_ref once per standard.
  const arms = disjuncts.map((disjunct) => `(\n              ${disjunct}\n            )`).join("\n            OR ");
  return `(\n            ${arms}\n          )`;
}
