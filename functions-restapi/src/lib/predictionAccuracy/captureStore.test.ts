import { test } from "node:test";
import assert from "node:assert";
import { gunzipSync } from "node:zlib";
import { captureMember, createWriteGate, notAuthorizedReason, predictionCaptureAccount } from "./captureStore";

test("runs appended as separate gzip members read back as one file, in order", () => {
  const day = Buffer.concat([captureMember(["R,1,,", "V,1,1,4142,t1,425,,3240,53469,1"]), captureMember(["R,31,,"])]);
  assert.strictEqual(gunzipSync(day).toString("utf-8"), "R,1,,\nV,1,1,4142,t1,425,,3240,53469,1\nR,31,,\n");
});

test("the account setting is read trimmed, and an unset or placeholder value means not configured", () => {
  assert.strictEqual(predictionCaptureAccount({ PREDICTION_CAPTURE_STORAGE_ACCOUNT: " stmvtapredcapdev " }), "stmvtapredcapdev");
  assert.strictEqual(predictionCaptureAccount({}), null);
  assert.strictEqual(predictionCaptureAccount({ PREDICTION_CAPTURE_STORAGE_ACCOUNT: "REPLACE_ME" }), null);
});

test("a refused write (403) is named as a missing role; other errors are not", () => {
  const refused = Object.assign(new Error("This request is not authorized to perform this operation."), { statusCode: 403 });
  const reason = notAuthorizedReason(refused, "stmvtapredcapdev");
  assert.ok(reason?.startsWith("stmvtapredcapdev refused the write (403)"));
  assert.match(reason ?? "", /Storage Blob Data Contributor/);
  assert.match(reason ?? "", /15 minutes/);
  assert.strictEqual(notAuthorizedReason(Object.assign(new Error("busy"), { statusCode: 503 }), "a"), null);
  assert.strictEqual(notAuthorizedReason(new Error("socket hang up"), "a"), null);
  assert.strictEqual(notAuthorizedReason(undefined, "a"), null);
});

test("after a refused write the gate stays shut for the retry interval, then opens", () => {
  const gate = createWriteGate(15 * 60_000);
  assert.strictEqual(gate.isOpen(0), true);
  gate.close(1_000);
  assert.strictEqual(gate.isOpen(1_000 + 30_000), false);
  assert.strictEqual(gate.isOpen(1_000 + 15 * 60_000 - 1), false);
  assert.strictEqual(gate.isOpen(1_000 + 15 * 60_000), true);
});
