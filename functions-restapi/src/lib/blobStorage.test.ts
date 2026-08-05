import { test } from "node:test";
import assert from "node:assert";
import { buildDetourImageBlobPath } from "./blobStorage";

// Only the pure path-construction logic is unit-testable here - the actual
// SAS-minting calls need a live storage account, same limitation as every
// other external-API integration in this repo.
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
