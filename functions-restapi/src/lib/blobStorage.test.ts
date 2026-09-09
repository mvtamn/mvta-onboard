import { test } from "node:test";
import assert from "node:assert";
import { buildComplianceEvidenceBlobPath, buildDetourImageBlobPath, isEvidenceStagingPath, sasWindow, sealedComplianceEvidencePath } from "./blobStorage";

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

// Evidence is uploaded by staff under a create+write SAS scoped to a staging
// path, verified, then copied by the app to a sealed path the SAS cannot name
// (ADR 0013). The two prefixes must be disjoint or the seal is theatre.
test("a sealed evidence path is never under the upload prefix", () => {
  const staging = buildComplianceEvidenceBlobPath("a1", "photo.jpg");
  const sealed = sealedComplianceEvidencePath("a1", "e1", "photo.jpg");
  assert.ok(staging.startsWith("evidence/a1/"));
  assert.ok(sealed.startsWith("sealed/a1/e1"));
  assert.ok(sealed.endsWith(".jpg"));
  assert.ok(!isEvidenceStagingPath(sealed, "a1"));
  assert.ok(isEvidenceStagingPath(staging, "a1"));
  // A staging path for another Assessment Item is not this item's either.
  assert.ok(!isEvidenceStagingPath(staging, "a2"));
});
