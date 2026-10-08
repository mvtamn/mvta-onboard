// The rule that decides whether this database has the schema the deployed
// code expects. Pure over a set of what is present, so the cases that matter -
// a column missing from a table that exists, which is the shape that actually
// bit on 2026-09-18 - are testable without a database.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SCHEMA_REQUIREMENTS,
  missingRequirements,
  requirementKey,
  schemaChecks,
  type SchemaRequirement,
} from "./schemaDrift";

const TABLE_ONLY: SchemaRequirement = { migration: "200", table: "Widgets", breaks: "Widgets do not work" };
const COLUMN: SchemaRequirement = { migration: "201", table: "Widgets", column: "colour", breaks: "Widgets lose their colour" };

function present(...keys: string[]): ReadonlySet<string> {
  return new Set(keys.map((k) => k.toLowerCase()));
}

test("a requirement that is present is not reported", () => {
  assert.deepEqual(missingRequirements(present("Widgets", "Widgets.colour"), [TABLE_ONLY, COLUMN]), []);
});

test("a missing table is reported", () => {
  assert.deepEqual(missingRequirements(present(), [TABLE_ONLY]), [TABLE_ONLY]);
});

test("a missing column on a table that exists is reported", () => {
  // The failure this exists for. Every OBJECT_ID guard in the handlers asks
  // whether the TABLE is there, and a column added later sails through them.
  assert.deepEqual(missingRequirements(present("Widgets"), [COLUMN]), [COLUMN]);
});

test("a column on an absent table is reported once, as the table", () => {
  // Otherwise one unapplied migration sends someone chasing two problems.
  assert.deepEqual(missingRequirements(present(), [TABLE_ONLY, COLUMN]), [TABLE_ONLY]);
});

test("case does not decide whether a column exists", () => {
  assert.deepEqual(missingRequirements(present("widgets", "widgets.COLOUR"), [TABLE_ONLY, COLUMN]), []);
  assert.equal(requirementKey(COLUMN), "widgets.colour");
});

test("requirements are reported in the order their migrations run", () => {
  const a: SchemaRequirement = { migration: "100", table: "A", breaks: "a" };
  const b: SchemaRequirement = { migration: "101", table: "B", breaks: "b" };
  assert.deepEqual(missingRequirements(present(), [a, b]).map((r) => r.migration), ["100", "101"]);
});

// --- what the health page is handed ------------------------------------------

test("a satisfied migration reads as fine, with no error", () => {
  const [check] = schemaChecks([], [TABLE_ONLY]);
  assert.equal(check.configured, true);
  assert.equal(check.error, undefined);
  assert.match(check.name, /migration 200/);
});

test("a missing migration names what is absent, what breaks, and the file to run", () => {
  const [check] = schemaChecks([COLUMN], [COLUMN]);
  assert.equal(check.configured, true, "the feature is configured; the database is behind");
  assert.match(check.error ?? "", /Widgets\.colour is missing/);
  assert.match(check.error ?? "", /Widgets lose their colour/);
  assert.match(check.error ?? "", /sql\/migration-201-\*\.sql/);
});

test("one migration is one row, however many things it adds", () => {
  const first: SchemaRequirement = { migration: "202", table: "T", column: "a", breaks: "x" };
  const second: SchemaRequirement = { migration: "202", table: "T", column: "b", breaks: "x" };
  const checks = schemaChecks([first, second], [first, second]);
  assert.equal(checks.length, 1);
  assert.match(checks[0].error ?? "", /T\.a, T\.b is missing/);
});

test("a partly applied migration still reads as failed", () => {
  const applied: SchemaRequirement = { migration: "203", table: "T", column: "a", breaks: "x" };
  const absent: SchemaRequirement = { migration: "203", table: "T", column: "b", breaks: "x" };
  const [check] = schemaChecks([absent], [applied, absent]);
  assert.match(check.error ?? "", /T\.b is missing/);
  assert.doesNotMatch(check.error ?? "", /T\.a is missing/);
});

// --- the declared set ---------------------------------------------------------

test("every declared requirement names a migration file that exists", async () => {
  const { readdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  // CommonJS output, so resolve from the working directory the test script uses.
  const files = readdirSync(join(process.cwd(), "sql"));
  for (const requirement of SCHEMA_REQUIREMENTS) {
    assert.ok(
      files.some((f) => f.startsWith(`migration-${requirement.migration}-`)),
      `migration ${requirement.migration} is declared but sql/migration-${requirement.migration}-*.sql does not exist`,
    );
  }
});

test("every declared requirement says what breaks without it", () => {
  for (const requirement of SCHEMA_REQUIREMENTS) {
    assert.ok(requirement.breaks.length > 10, `${requirementKey(requirement)} needs a real explanation`);
    assert.ok(requirement.table.length > 0);
  }
});

test("the missed-trip columns that failed in production are declared", () => {
  // 2026-09-18: code shipped reading these against a database without them,
  // and four timers threw for an hour. Regression guard on the declaration.
  for (const column of ["evidence_conflict_at", "evidence_conflict_reason"]) {
    assert.ok(
      SCHEMA_REQUIREMENTS.some((r) => r.table === "MonitoredMissedTrips" && r.column === column),
      `${column} must stay declared`,
    );
  }
});
