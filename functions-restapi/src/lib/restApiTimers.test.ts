import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// restApiTimersEnabled = false in main-phase1.bicep switches off every timer in
// restApiTimerNames. A timer missing from that list would keep running in an
// environment that is meant to be quiet - polling feeds and writing to a
// database before cutover - so the list has to match what the code registers.

const repoRoot = join(process.cwd(), "..");
const functionsDir = join(repoRoot, "functions-restapi", "src", "functions");

function timersInCode(): string[] {
  const names = new Set<string>();
  for (const file of readdirSync(functionsDir)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
    for (const match of readFileSync(join(functionsDir, file), "utf8").matchAll(/app\.timer\(\s*"([A-Za-z0-9]+)"/g)) {
      names.add(match[1]);
    }
  }
  return [...names].sort();
}

function timersInBicep(): string[] {
  const bicep = readFileSync(join(repoRoot, "infra-phase1", "main-phase1.bicep"), "utf8");
  const block = bicep.match(/var restApiTimerNames = \[([\s\S]*?)\]/);
  assert.ok(block, "main-phase1.bicep declares var restApiTimerNames");
  return [...block[1].matchAll(/'([A-Za-z0-9]+)'/g)].map((m) => m[1]).sort();
}

test("restApiTimerNames lists exactly the timers the REST API registers", () => {
  const code = timersInCode();
  assert.ok(code.length > 0, "found timers in functions-restapi/src/functions");
  assert.deepEqual(timersInBicep(), code);
});
