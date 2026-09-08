import assert from "node:assert/strict";
import test from "node:test";
import {
  MIGRATION_SQL_DIR,
  describeMigrationNumberCollisions,
  findMigrationNumberCollisions,
  listMigrationFiles,
  parseMigrationFile,
} from "./migrationNumbers";

test("no two migrations in the tree claim the same number", () => {
  const collisions = findMigrationNumberCollisions(listMigrationFiles(MIGRATION_SQL_DIR));
  assert.deepEqual(
    collisions,
    [],
    collisions.length ? `\n\n${describeMigrationNumberCollisions(collisions)}\n` : "",
  );
});

test("the sql directory is actually being read", () => {
  // A check that silently matches nothing passes forever. Migration 002 is the
  // oldest file in the directory and is never going to be renumbered.
  const migrations = listMigrationFiles(MIGRATION_SQL_DIR);
  assert.ok(migrations.length > 100, `expected the full migration set, saw ${migrations.length}`);
  assert.ok(migrations.some((m) => m.key === "002"), "migration 002 was not found");
});

test("a letter suffix is what separates two files at one number", () => {
  const collisions = findMigrationNumberCollisions([
    parseMigrationFile("migration-096-a-thing.sql")!,
    parseMigrationFile("migration-096a-app-settings.sql")!,
    parseMigrationFile("migration-096b-governed-assessment.sql")!,
  ]);
  assert.deepEqual(collisions, []);
});

test("two files at one bare number collide", () => {
  const collisions = findMigrationNumberCollisions([
    parseMigrationFile("migration-105-reference-values.sql")!,
    parseMigrationFile("migration-105-power-bi-views.sql")!,
  ]);
  assert.deepEqual(collisions, [
    { key: "105", files: ["migration-105-power-bi-views.sql", "migration-105-reference-values.sql"] },
  ]);
  assert.match(describeMigrationNumberCollisions(collisions), /Migration 105 is claimed by 2 files/);
  assert.match(describeMigrationNumberCollisions(collisions), /letter suffix/);
});

test("two files at one lettered number collide", () => {
  const collisions = findMigrationNumberCollisions([
    parseMigrationFile("migration-096a-one.sql")!,
    parseMigrationFile("migration-096a-two.sql")!,
  ]);
  assert.deepEqual(collisions.map((c) => c.key), ["096a"]);
});

test("files that are not migrations are ignored", () => {
  assert.equal(parseMigrationFile("README.md"), null);
  assert.equal(parseMigrationFile("backfill-detour-numbers-gap.sql"), null);
  assert.equal(parseMigrationFile("migration-107.sql"), null);
});
