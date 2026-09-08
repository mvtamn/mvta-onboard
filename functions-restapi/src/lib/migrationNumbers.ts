import { readdirSync } from "node:fs";
import path from "node:path";

/**
 * Migrations are applied in filename order by a person reading `sql/`, so two
 * files claiming one number makes "which ran, and in what order" unanswerable
 * from the filename alone. See sql/README.md for why a collision is resolved
 * with a letter suffix rather than by renumbering.
 */
export interface MigrationFile {
  file: string;
  /** The numeric part, zero-padded as written: "096". */
  number: string;
  /** The collision-ordering letter, or "" when the number stands alone. */
  letter: string;
  /** The identity two files may not share: "096" and "096a" are distinct. */
  key: string;
}

const MIGRATION_NAME = /^migration-(\d+)([a-z]?)-.+\.sql$/;

export function parseMigrationFile(file: string): MigrationFile | null {
  const match = MIGRATION_NAME.exec(file);
  if (!match) return null;
  const [, number, letter] = match;
  return { file, number, letter, key: `${number}${letter}` };
}

export function listMigrationFiles(dir: string): MigrationFile[] {
  return readdirSync(dir)
    .map(parseMigrationFile)
    .filter((m): m is MigrationFile => m !== null)
    .sort((a, b) => a.key.localeCompare(b.key));
}

export interface MigrationNumberCollision {
  key: string;
  files: string[];
}

/** Every number claimed by more than one file, in the order they collide. */
export function findMigrationNumberCollisions(migrations: MigrationFile[]): MigrationNumberCollision[] {
  const byKey = new Map<string, string[]>();
  for (const m of migrations) {
    const files = byKey.get(m.key);
    if (files) files.push(m.file);
    else byKey.set(m.key, [m.file]);
  }
  return [...byKey.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([key, files]) => ({ key, files: [...files].sort() }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function describeMigrationNumberCollisions(collisions: MigrationNumberCollision[]): string {
  return collisions
    .map(({ key, files }) =>
      `Migration ${key} is claimed by ${files.length} files:\n` +
      files.map((f) => `  - ${f}`).join("\n") +
      "\n  Give one of them a letter suffix (see sql/README.md); do not renumber " +
      "a migration that has already been applied.")
    .join("\n\n");
}

/**
 * Resolved from the working directory rather than `__dirname`: the sources run
 * from `src/lib` and the compiled tests from `dist-test/src/lib`, which sit at
 * different depths, and both `npm test` and `npm run build` run from the app
 * root.
 */
export const MIGRATION_SQL_DIR = path.join(process.cwd(), "sql");
