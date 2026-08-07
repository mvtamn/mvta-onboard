import { test } from "node:test";
import assert from "node:assert";
import { buildDetourImageBlobPath, sasWindow } from "./blobStorage";

// Only the pure path-construction and expiry math are unit-testable here -
// the actual SAS-minting calls need a live storage account, same limitation
// as every other external-API integration in this repo.
test("builds a blob path scoped under the detour's own folder", () => {
  const path = buildDetourImageBlobPath("11111111-1111-1111-1111-111111111111", "signage photo.jpg");
  assert.ok(path.startsWith("detours/11111111-1111-1111-1111-111111111111/"));
  assert.ok(path.endsWith("-signage_photo.jpg"));
});

test("sanitizes unsafe characters out of the file name", () => {
  const path = buildDetourImageBlobPath("d1", "my photo (1)!@#.png");
  assert.ok(!/[()!@# ]/.test(path));
  assert.ok(path.endsWith(".png"));
});

test("two calls for the same file name produce different paths (unique per upload)", () => {
  const a = buildDetourImageBlobPath("d1", "same.jpg");
  const b = buildDetourImageBlobPath("d1", "same.jpg");
  assert.notStrictEqual(a, b);
});

// Azure 403s a SAS that outlives the user-delegation key that signed it, and
// 403s one that isn't valid yet. Both are silent-until-live failures, so the
// window math is pinned down here.
const NOW = new Date("2026-08-06T12:00:00.000Z");

test("the delegation key window fully contains the SAS window", () => {
  const w = sasWindow(NOW);
  assert.ok(w.keyExpiresOn > w.expiresOn, "key must outlive the SAS it signs");
  assert.ok(w.keyStartsOn <= w.startsOn, "key must be valid no later than the SAS");
});

test("the SAS is back-dated to absorb clock skew but still lasts a full 15 minutes", () => {
  const w = sasWindow(NOW);
  assert.ok(w.startsOn < NOW, "startsOn must be in the past");
  assert.strictEqual(w.expiresOn.getTime() - NOW.getTime(), 15 * 60 * 1000);
});
