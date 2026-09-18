import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// SQL Server compiles a whole batch before running any of it, so an
// `ALTER TABLE ... ADD col` followed by a CHECK naming that column fails at
// compile time with "Invalid column name" and the ENTIRE batch is abandoned -
// nothing added, and quietly enough that the run can look uneventful.
//
// Migration 092 shipped that way and could not be applied to any database that
// lacked the column, which was all of them; it was fixed in PR #353 and given
// a test. The test only read 092, so migration 061 - which had the same defect
// from much earlier - went on failing the same way, and the Detours page 500ed
// on dev for as long as the column was missing. This reads every migration.
//
// The fix in both cases is to run the CHECK through EXEC, whose text is
// compiled when it executes rather than with the batch around it.
const SQL_DIR = join(process.cwd(), "sql");

const TYPES = [
  "NVARCHAR", "VARCHAR", "NCHAR", "CHAR", "DATETIME2", "DATETIME", "DATE",
  "INT", "BIGINT", "SMALLINT", "TINYINT", "BIT", "DECIMAL", "NUMERIC", "FLOAT",
  "REAL", "MONEY", "UNIQUEIDENTIFIER",
].join("|");

/**
 * Batches, with dynamic SQL removed: text inside EXEC(N'...') is compiled when
 * it runs, not with the batch around it, and a doubled quote inside it is an
 * escaped quote rather than the end of the string. Both spellings count:
 * EXEC(N'...') and EXEC sys.sp_executesql N'...'.
 */
function batchesOf(migration: string): string[] {
  return migration
    .split(/^\s*GO\s*$/gim)
    .map((batch) => batch
      .replace(/EXEC\s*\(\s*N?'(?:[^']|'')*'\s*\)/gi, "")
      .replace(/EXEC(?:UTE)?\s+(?:sys\.)?sp_executesql\s+N?'(?:[^']|'')*'/gi, ""));
}

/**
 * Columns added and then named by a CHECK in the SAME batch but a DIFFERENT
 * statement - the shape SQL Server cannot compile.
 *
 * A column-level constraint written into the ADD itself
 * (`ADD c NVARCHAR(10) NULL CONSTRAINT CK CHECK (c IS NULL OR ...)`) is one
 * statement and compiles fine, which is why migration 091 applies cleanly and
 * is not an offender.
 */
export function columnsNamedInTheirOwnBatch(migration: string): string[] {
  const found: string[] = [];
  for (const batch of batchesOf(migration)) {
    const statements = batch.split(";");
    const added = new Set<string>();
    for (const statement of statements) {
      for (const match of statement.matchAll(new RegExp(String.raw`ADD\s+(\w+)\s+(?:${TYPES})\b`, "gi"))) {
        added.add(match[1].toLowerCase());
      }
    }
    for (const statement of statements) {
      // Only a table-level constraint: ADD immediately followed by CONSTRAINT.
      if (!/ADD\s+CONSTRAINT\b/i.test(statement) || !/CHECK\s*\(/i.test(statement)) continue;
      // The columns this statement itself adds are not at risk from itself.
      const ownAdds = new Set(
        [...statement.matchAll(new RegExp(String.raw`ADD\s+(\w+)\s+(?:${TYPES})\b`, "gi"))]
          .map((match) => match[1].toLowerCase()));
      for (const column of added) {
        if (ownAdds.has(column)) continue;
        if (new RegExp(String.raw`CHECK\s*\([^;]*\b${column}\b`, "i").test(statement)) found.push(column);
      }
    }
  }
  return found;
}

test("no migration names a column in a CHECK in the batch that adds it", () => {
  const offenders: string[] = [];
  for (const file of readdirSync(SQL_DIR).filter((name) => /^migration-.*\.sql$/.test(name)).sort()) {
    for (const column of columnsNamedInTheirOwnBatch(readFileSync(join(SQL_DIR, file), "utf8"))) {
      offenders.push(`${file}: ${column}`);
    }
  }
  assert.deepEqual(offenders, [],
    "these batches add a column and name it in a CHECK, so SQL Server abandons the batch before adding anything - run the CHECK through EXEC");
});

test("the check reads batches the way SQL Server does", () => {
  // Same batch: the CHECK compiles against a column that does not exist yet.
  assert.deepEqual(
    columnsNamedInTheirOwnBatch(
      "ALTER TABLE T ADD c NVARCHAR(20) NULL;\nALTER TABLE T ADD CONSTRAINT CK CHECK (c IN ('a'));"),
    ["c"]);
  // Separated by GO: the second batch compiles after the first has run.
  assert.deepEqual(
    columnsNamedInTheirOwnBatch(
      "ALTER TABLE T ADD c NVARCHAR(20) NULL;\nGO\nALTER TABLE T ADD CONSTRAINT CK CHECK (c IN ('a'));"),
    []);
  // Through EXEC: compiled when it runs, doubled quotes and all.
  assert.deepEqual(
    columnsNamedInTheirOwnBatch(
      "ALTER TABLE T ADD c INT NULL;\nEXEC(N'ALTER TABLE T ADD CONSTRAINT CK CHECK (c > 0)');"),
    []);
  assert.deepEqual(
    columnsNamedInTheirOwnBatch(
      "ALTER TABLE T ADD c CHAR(7) NULL;\nEXEC(N'ALTER TABLE T ADD CONSTRAINT CK CHECK (c LIKE ''#a'')');"),
    []);
  // A column-level constraint in the ADD itself is one statement, and legal.
  assert.deepEqual(
    columnsNamedInTheirOwnBatch(
      "ALTER TABLE T ADD c NVARCHAR(MAX) NULL CONSTRAINT CK CHECK (c IS NULL OR ISJSON(c) = 1);"),
    []);
  // A CHECK naming a column that was already there is fine.
  assert.deepEqual(
    columnsNamedInTheirOwnBatch(
      "ALTER TABLE T ADD c INT NULL;\nALTER TABLE T ADD CONSTRAINT CK CHECK (other > 0);"),
    []);
});
