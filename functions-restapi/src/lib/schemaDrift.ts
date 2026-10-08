// Does the database have the schema the deployed code expects?
//
// There is no migration runner and no schema-version table (sql/README.md):
// migrations are numbered files a person applies. So a merge can ship code
// that reads a column nobody has added yet, and nothing says so. On
// 2026-09-18 that happened - four migrations' worth of code went live at
// 14:59 UTC against a database missing all four, and four timers threw
// `Invalid column name 'evidence_conflict_reason'` 150 times over an hour
// before anyone noticed. The exceptions were all there in the log. Logging
// louder was never the fix; being visible where someone already looks is.
//
// The checks the code already had could not have caught it. There are a dozen
// `OBJECT_ID('dbo.X') IS NULL` guards across the handlers and every one asks
// whether a TABLE exists. A migration that adds a COLUMN to a table that
// already exists sails straight through them. That is exactly the shape of
// the failure, so requirements here are declared at column granularity.
//
// The result is reported as FeedCheck entries, so it appears on Integrations &
// Data Health beside the feed checks without the console needing to know this
// exists: a requirement that is not met renders as a failed row naming the
// migration to run.
import { sql } from "./db";
import type { FeedCheck } from "./feedCheckResponse";

export interface SchemaRequirement {
  /** The migration that introduces it - what the reader has to go and run. */
  migration: string;
  table: string;
  /** Absent means the table itself is the requirement. */
  column?: string;
  /** What stops working without it, in the words of whoever has to care. */
  breaks: string;
}

// Deliberately not every migration ever written. A requirement earns its place
// by being something the CURRENTLY MERGED code reads, where its absence is a
// failure rather than a feature that quietly stays off. Table-only entries are
// here where the table arrived with its feature; column entries are here
// because a table guard cannot see them.
export const SCHEMA_REQUIREMENTS: readonly SchemaRequirement[] = [
  {
    migration: "121",
    table: "MonitoredMissedTrips",
    column: "undecided_reason",
    breaks: "Missed-trip detection cannot record why a case is held",
  },
  {
    migration: "125",
    table: "MonitoredMissedTrips",
    column: "expected_window_end_at",
    breaks: "Silent no-shows cannot wait for their Expected operating window",
  },
  {
    migration: "134",
    table: "MissedTripDetectorPromotions",
    breaks: "Detector promotion out of Shadow detection has no history to read",
  },
  {
    migration: "135",
    table: "MonitoredMissedTrips",
    column: "evidence_conflict_at",
    breaks: "Missed-trip polls and the review queue fail outright",
  },
  {
    migration: "135",
    table: "MonitoredMissedTrips",
    column: "evidence_conflict_reason",
    breaks: "Missed-trip polls and the review queue fail outright",
  },
  {
    migration: "136",
    table: "AvailEvidenceLinks",
    breaks: "A probable Avail link cannot be recorded for a reviewer to resolve",
  },
];

/** What the database actually has: lower-cased "table" and "table.column". */
export type SchemaPresence = ReadonlySet<string>;

export function requirementKey(requirement: SchemaRequirement): string {
  return (requirement.column ? `${requirement.table}.${requirement.column}` : requirement.table).toLowerCase();
}

// Pure: given what is present, which requirements are not met. Order is the
// declared order, so the reader sees migrations in the order they run.
export function missingRequirements(
  present: SchemaPresence,
  requirements: readonly SchemaRequirement[] = SCHEMA_REQUIREMENTS,
): SchemaRequirement[] {
  return requirements.filter((requirement) => {
    // A column on a table that is itself absent is reported once, as the
    // table - listing both would send someone chasing two problems.
    if (requirement.column && !present.has(requirement.table.toLowerCase())) return false;
    return !present.has(requirementKey(requirement));
  });
}

/**
 * One FeedCheck per declared migration, so Integrations & Data Health shows
 * the schema beside the feeds. A satisfied migration is `configured` with no
 * error and reads as fine; a missing one carries the error and reads as failed.
 */
export function schemaChecks(
  missing: readonly SchemaRequirement[],
  requirements: readonly SchemaRequirement[] = SCHEMA_REQUIREMENTS,
): FeedCheck[] {
  const byMigration = new Map<string, SchemaRequirement[]>();
  for (const requirement of requirements) {
    byMigration.set(requirement.migration, [...(byMigration.get(requirement.migration) ?? []), requirement]);
  }
  const missingByMigration = new Map<string, SchemaRequirement[]>();
  for (const requirement of missing) {
    missingByMigration.set(requirement.migration, [...(missingByMigration.get(requirement.migration) ?? []), requirement]);
  }
  return [...byMigration.keys()].map((migration) => {
    const absent = missingByMigration.get(migration) ?? [];
    const name = `Database schema · migration ${migration}`;
    if (absent.length === 0) return { name, configured: true, status: 200 };
    const what = absent.map((r) => (r.column ? `${r.table}.${r.column}` : r.table)).join(", ");
    return {
      name,
      configured: true,
      error: `Not applied to this database: ${what} is missing. ${absent[0].breaks}. Run sql/migration-${migration}-*.sql.`,
    };
  });
}

// One read of the catalogue, rather than a probe per requirement.
export async function loadSchemaPresence(
  pool: sql.ConnectionPool,
  requirements: readonly SchemaRequirement[] = SCHEMA_REQUIREMENTS,
): Promise<SchemaPresence> {
  const tables = [...new Set(requirements.map((r) => r.table))];
  if (tables.length === 0) return new Set<string>();
  const result = await pool.request()
    .input("tables", sql.NVarChar(sql.MAX), JSON.stringify(tables))
    .query<{ table_name: string; column_name: string | null }>(`
      SELECT t.name AS table_name, c.name AS column_name
      FROM OPENJSON(@tables) WITH (n NVARCHAR(200) '$') wanted
      JOIN sys.tables t ON t.name = wanted.n AND SCHEMA_NAME(t.schema_id) = 'dbo'
      LEFT JOIN sys.columns c ON c.object_id = t.object_id`);
  const present = new Set<string>();
  for (const row of result.recordset) {
    present.add(row.table_name.toLowerCase());
    if (row.column_name) present.add(`${row.table_name}.${row.column_name}`.toLowerCase());
  }
  return present;
}

export async function schemaDriftChecks(
  pool: sql.ConnectionPool,
  requirements: readonly SchemaRequirement[] = SCHEMA_REQUIREMENTS,
): Promise<FeedCheck[]> {
  const present = await loadSchemaPresence(pool, requirements);
  return schemaChecks(missingRequirements(present, requirements), requirements);
}
