import { test } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Compiled to dist-test/src/functions; three levels up is functions-restapi.
const projectRoot = path.resolve(__dirname, "../../..");
const script = path.join(projectRoot, "scripts", "registered-functions.cjs");

function registrations(entry: string): string[] {
  const output = execFileSync(process.execPath, [script, "--entry", entry], { encoding: "utf8" });
  return JSON.parse(output.trim().split("\n").pop() as string);
}

// The receiver's app must run the receiver and nothing else. Anything more
// from the REST API - a timer especially - would run twice, once on each app.
test("the Spare webhook receiver's entry point registers only the receiver and a health check", () => {
  assert.deepStrictEqual(registrations(path.resolve(__dirname, "../spareWebhookEntry.js")), ["health", "onDemandSpareWebhook"]);
});

test("the recorder sees what a function file registers, so an empty result cannot pass by accident", () => {
  assert.deepStrictEqual(registrations(path.resolve(__dirname, "gtfsDelaysPoll.js")), ["gtfsDelaysPoll"]);
});

// The REST app loads dist/src/functions/*.js. The entry sits beside that
// directory, not in it, so the REST app can never load it too.
test("the REST app's function glob cannot load the receiver's entry point", () => {
  const pkg = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  assert.strictEqual(pkg.main, "dist/src/functions/*.js");
  assert.ok(existsSync(path.join(projectRoot, "src", "spareWebhookEntry.ts")));
  assert.ok(!existsSync(path.join(projectRoot, "src", "functions", "spareWebhookEntry.ts")));
});
