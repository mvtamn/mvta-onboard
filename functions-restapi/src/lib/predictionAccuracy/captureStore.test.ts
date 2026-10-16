import { test } from "node:test";
import assert from "node:assert";
import { gunzipSync } from "node:zlib";
import { captureMember, predictionCaptureAccount } from "./captureStore";

test("runs appended as separate gzip members read back as one file, in order", () => {
  const day = Buffer.concat([captureMember(["R,1,,", "V,1,1,4142,t1,425,,3240,53469,1"]), captureMember(["R,31,,"])]);
  assert.strictEqual(gunzipSync(day).toString("utf-8"), "R,1,,\nV,1,1,4142,t1,425,,3240,53469,1\nR,31,,\n");
});

test("the account setting is read trimmed, and an unset or placeholder value means not configured", () => {
  assert.strictEqual(predictionCaptureAccount({ PREDICTION_CAPTURE_STORAGE_ACCOUNT: " stmvtapredcapdev " }), "stmvtapredcapdev");
  assert.strictEqual(predictionCaptureAccount({}), null);
  assert.strictEqual(predictionCaptureAccount({ PREDICTION_CAPTURE_STORAGE_ACCOUNT: "REPLACE_ME" }), null);
});
