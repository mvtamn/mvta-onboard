import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { isKnownAction } from "./catalog";

// Guards the conversion in increment 2: handlers ask for a Module Action, and
// the action they ask for exists. A role name left behind in a handler is how
// the console and the API drifted apart in the first place - one side kept a
// list the other had changed - so it fails here rather than in production.
//
// Since the cutover there is no requireRole anywhere to fall back to: auth.ts
// answers who the caller is, and nothing about what they may do.
const FUNCTIONS = join(process.cwd(), "src", "functions");

function handlerFiles(): string[] {
  return readdirSync(FUNCTIONS).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
}

test("every handler gates on an action, not a role name", () => {
  const offenders = handlerFiles().filter((name) =>
    /\brequireRole\s*\(/.test(readFileSync(join(FUNCTIONS, name), "utf8")),
  );
  assert.deepEqual(offenders, []);
});

test("no handler names an OCC app role", () => {
  // OCC.* in a handler means a role list survived the conversion. System.Ingestion
  // is the one app role that stays, and it is checked through the access helpers.
  const offenders = handlerFiles().filter((name) => /"OCC\.[A-Za-z]+"/.test(readFileSync(join(FUNCTIONS, name), "utf8")));
  assert.deepEqual(offenders, []);
});

test("every action a handler requires exists in the catalog", () => {
  const unknown: string[] = [];
  for (const name of handlerFiles()) {
    const source = readFileSync(join(FUNCTIONS, name), "utf8");
    for (const match of source.matchAll(/require(?:Access|AccessOrIngestion)\(\s*\w+\s*,\s*([\s\S]*?)\)\s*;/g)) {
      for (const literal of match[1].matchAll(/"([a-z-]+\.[a-z-]+)"/g)) {
        if (!isKnownAction(literal[1])) unknown.push(`${name}: ${literal[1]}`);
      }
    }
  }
  assert.deepEqual(unknown, []);
});
