import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// Signed in as its managed identity, the REST API can read and write rows but
// alter only the tables infra-stage0/scripts/grant-function-app-sql-users.sql
// names. TRUNCATE TABLE and a bulk copy (sql.Table + .bulk) both need ALTER on
// the table, so a new one that is missing from the script fails on the day it
// first runs, as a permission error in a timer. This keeps the two in step.

const repoRoot = join(process.cwd(), "..");
const srcDir = join(repoRoot, "functions-restapi", "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : [];
  });
}

function tablesNeedingAlter(): string[] {
  const names = new Set<string>();
  for (const file of sourceFiles(srcDir)) {
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(/TRUNCATE TABLE (?:dbo\.)?\[?([A-Za-z0-9_]+)\]?/g)) names.add(m[1]);
    for (const m of source.matchAll(/new sql\.Table\(\s*"(?:dbo\.)?([A-Za-z0-9_]+)"/g)) names.add(m[1]);
  }
  return [...names].sort();
}

function tablesInGrantScript(): string[] {
  const script = readFileSync(join(repoRoot, "infra-stage0", "scripts", "grant-function-app-sql-users.sql"), "utf8");
  const block = script.match(/INSERT @alterTables VALUES([\s\S]*?);/);
  assert.ok(block, "the grant script declares INSERT @alterTables VALUES");
  return [...block[1].matchAll(/N'([A-Za-z0-9_]+)'/g)].map((m) => m[1]).sort();
}

test("the grant script gives ALTER on exactly the tables the REST API truncates or bulk-loads", () => {
  const code = tablesNeedingAlter();
  assert.ok(code.length > 0, "found TRUNCATE TABLE or sql.Table in functions-restapi/src");
  assert.deepEqual(tablesInGrantScript(), code);
});
