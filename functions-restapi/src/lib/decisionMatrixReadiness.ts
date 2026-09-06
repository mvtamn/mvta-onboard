import { sql } from "./db";

// The Decision Matrix admin workspace draws on four surfaces whose tables
// arrive in four different migrations, so "not connected" is not one condition
// here the way it is for the reader. A database can hold the legacy tables and
// none of the governed ones - which is where dev stands today, with 079's
// evidence table present and nothing from 076 - and a banner that says only
// "not connected" leaves an Admin guessing which of four migrations to run.
// Each surface therefore reports the migration that creates its own tables,
// and the console names it. The mapping lives here, beside the probe, so the
// console cannot drift from what the queries actually read.
export interface DecisionMatrixSurface {
  readonly tables: readonly string[];
  readonly migration: string;
}

export const DECISION_MATRIX_SURFACES = {
  reader: { tables: ["Procedures", "ProcedureRevisions", "ProcedureCriteria", "ProcedureImmediateActions", "ProcedureDocumentReferences"], migration: "076" },
  governance: { tables: ["Procedures", "ProcedureRevisions", "ProcedureDocumentReferences"], migration: "076" },
  audit: { tables: ["ProcedureAuditEvents"], migration: "078" },
  legacyCandidates: { tables: ["DecisionMatrixProcedures", "DecisionMatrixLegacyMigrations"], migration: "079" },
  matchRules: { tables: ["ProcedureMatchRules"], migration: "080" },
} as const satisfies Record<string, DecisionMatrixSurface>;

// Parameterised rather than interpolated: these names are module constants
// today, but a probe that concatenates whatever it is handed is a hazard left
// lying around for the next caller.
export async function tablesReady(pool: sql.ConnectionPool, tables: readonly string[]): Promise<boolean> {
  if (!tables.length) return true;
  const check = pool.request();
  tables.forEach((table, index) => check.input(`t${index}`, sql.NVarChar, table));
  const placeholders = tables.map((_, index) => `@t${index}`).join(",");
  const result = await check.query<{ present: number }>(
    `SELECT COUNT(*) AS present FROM sys.tables WHERE schema_id=SCHEMA_ID('dbo') AND name IN (${placeholders})`,
  );
  return result.recordset[0]?.present === tables.length;
}

export async function surfaceReady(pool: sql.ConnectionPool, surface: DecisionMatrixSurface): Promise<boolean> {
  return tablesReady(pool, surface.tables);
}
