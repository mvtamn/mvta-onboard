import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";

// Two branches that both read the same main pick the same next migration
// number, and nothing catches it: the files have different names, so git
// merges them without a conflict and the collision only surfaces when someone
// says "apply migration 096" and has to ask which one. It happened five times
// (032, 055, 069, 088, 096) before this test existed.
//
// A number may carry a letter suffix. That is how a collision is resolved once
// both migrations are already applied: renumbering one to a free number at the
// end would claim it ran after migrations it actually preceded, so the pair
// keeps its position and the letters order it. The suffix is part of the
// identifier, so 096a and 096b do not collide. See sql/README.md.
const MIGRATION = /^migration-(\d+)([a-z]?)-.+\.sql$/;

test("every migration number identifies exactly one file", () => {
  const byIdentifier = new Map<string, string[]>();
  for (const file of readdirSync(join(process.cwd(), "sql"))) {
    const match = MIGRATION.exec(file);
    if (!match) continue;
    const identifier = `${match[1]}${match[2]}`;
    byIdentifier.set(identifier, [...(byIdentifier.get(identifier) ?? []), file]);
  }
  const collisions = [...byIdentifier]
    .filter(([, files]) => files.length > 1)
    .map(([identifier, files]) => `${identifier}: ${files.sort().join(", ")}`)
    .sort();
  assert.deepEqual(
    collisions,
    [],
    "Two migrations share a number. Give the later one a letter suffix, update every reference to it, "
      + "and leave both in place - sql/README.md says why, and which strings a rename must not touch.",
  );
});
