import test from "node:test";
import assert from "node:assert/strict";
import { canonicalLocationKey } from "./eventLocationIdentity.js";

test("canonicalizes location identity for duplicate detection", () => {
  assert.equal(canonicalLocationKey("  Eagan   Bus Garage ", "OTHER"), "eagan bus garage::other");
});
