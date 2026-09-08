import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";

// Two branches that both read the same main both pick the same next migration
// number, and nothing catches it: the files have different names, so git
// merges them without a conflict and the collision only surfaces when someone
// says "apply migration 096" and has to ask which one. It has happened five
// times (032, 055, 069, 088, 096).
//
// A number may carry a letter suffix (096a, 096b). That is how a collision is
// resolved once both migrations are already applied: renumbering one to a free
// number at the end would claim it ran after migrations it actually preceded,
// so the pair keeps its position in the sequence and the letters order them.
// The suffix is part of the identifier, so 096a and 096b do not collide.
const MIGRATION = /^migration-(\d+)([a-z]?)-.+\.sql$/;

// Collisions that predate this check. They are all applied on the one
// environment that exists, and each would need its own references updated to
// unpick; fix them the way 096 was fixed and delete the number from this list.
const KNOWN_COLLISIONS = new Set(["032", "055", "069", "088"]);

function migrationsByIdentifier(): Map<string, string[]> {
  const directory = join(process.cwd(), "sql");
  const byIdentifier = new Map<string, string[]>();
  for (const file of readdirSync(directory)) {
    const match = MIGRATION.exec(file);
    if (!match) continue;
    const identifier = `${match[1]}${match[2]}`;
    byIdentifier.set(identifier, [...(byIdentifier.get(identifier) ?? []), file]);
  }
  return byIdentifier;
}

test("every migration number identifies exactly one file", () => {
  const collisions = [...migrationsByIdentifier()]
    .filter(([identifier, files]) => files.length > 1 && !KNOWN_COLLISIONS.has(identifier))
    .map(([identifier, files]) => `${identifier}: ${files.sort().join(", ")}`);
  assert.deepEqual(
    collisions,
    [],
    "Two migrations share a number. Give the later one a letter suffix (e.g. 096b), "
      + "update every reference to it, and keep both in place - see migration-096a for why.",
  );
});

test("the known collisions are still the ones listed, and no more", () => {
  // Guards the list itself: if one is fixed, this fails until the number is
  // removed, so the exception list cannot quietly outlive the problem.
  const actual = [...migrationsByIdentifier()]
    .filter(([, files]) => files.length > 1)
    .map(([identifier]) => identifier)
    .sort();
  assert.deepEqual(actual, [...KNOWN_COLLISIONS].sort());
});
