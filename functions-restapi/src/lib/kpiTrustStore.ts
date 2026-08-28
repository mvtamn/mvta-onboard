import { sql } from "./db";
import { feedHealthTable } from "./kpiFeedHealth";
import { resolveKpiTrust, type KpiFeedHealth } from "./kpiTrust";

export async function loadKpiTrust(pool: sql.ConnectionPool) {
  const table = await feedHealthTable(pool);
  if (!table) return resolveKpiTrust([]);
  const evidence = await pool.request().query<{ evidence_ready: number }>(`
    SELECT CASE WHEN COL_LENGTH('dbo.${table}', 'coverage_end_at') IS NULL THEN 0 ELSE 1 END AS evidence_ready
  `);
  const evidenceColumns = evidence.recordset[0]?.evidence_ready === 1
    ? "coverage_start_at, coverage_end_at, last_failure_at, last_failure_reason"
    : "CAST(NULL AS DATETIME2) coverage_start_at, CAST(NULL AS DATETIME2) coverage_end_at, CAST(NULL AS DATETIME2) last_failure_at, CAST(NULL AS NVARCHAR(1000)) last_failure_reason";
  const records = (await pool.request().query<KpiFeedHealth>(`
    SELECT feed_name, last_success_at, last_entity_count, source_timestamp_at,
           ${evidenceColumns}
    FROM ${table}
  `)).recordset;
  return resolveKpiTrust(records);
}
