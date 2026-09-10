import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { writeManualMetric } from "./assessment/manualMetricWrite";
import { parseConnectionString, sql } from "./db";

// Changing a hand-entered figure, against a real SQL Server (the CI contract
// job's container) and the real migration 030. The bug this pins was
// invisible to every in-memory test: UX_MME_Current is a filtered unique index
// and superseded_by a self-referencing foreign key, and only the database
// enforces either. The first entry for a month always worked; the second -
// the "Change" button - answered 500 on dev on 2026-09-10.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;

const CONTRACTOR = "c0000000-0000-4000-8000-000000000002";
const DATABASE = "mvta_manual_metric_contract";

function batches(text: string): string[] {
  return text.split(/^\s*GO\s*$/im).map(b => b.trim()).filter(Boolean);
}

// The other contract tests share the job's `master` database and node runs
// test files in parallel, so this one gets a database of its own.
async function ownDatabase(connectionString: string): Promise<sql.ConnectionPool> {
  const admin = await new sql.ConnectionPool(parseConnectionString(connectionString)).connect();
  try {
    await admin.request().batch(`IF DB_ID('${DATABASE}') IS NOT NULL BEGIN ALTER DATABASE [${DATABASE}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${DATABASE}]; END; CREATE DATABASE [${DATABASE}];`);
  } finally { await admin.close(); }
  return new sql.ConnectionPool({ ...parseConnectionString(connectionString), database: DATABASE }).connect();
}

async function dropDatabase(connectionString: string) {
  const admin = await new sql.ConnectionPool(parseConnectionString(connectionString)).connect();
  try { await admin.request().batch(`IF DB_ID('${DATABASE}') IS NOT NULL BEGIN ALTER DATABASE [${DATABASE}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${DATABASE}]; END;`); }
  finally { await admin.close(); }
}

interface Row { id: string; metric_value: number; numerator: number | null; denominator: number | null; source_note: string; superseded_by: string | null }

async function rows(pool: sql.ConnectionPool, standardId: string): Promise<Row[]> {
  const r = pool.request(); r.input("standard", sql.UniqueIdentifier, standardId);
  return (await r.query<Row>(`SELECT id,metric_value,numerator,denominator,source_note,superseded_by FROM ManualMetricEntries WHERE standard_id=@standard AND contractor_id='${CONTRACTOR}' AND service_month='202608' ORDER BY entered_at`)).recordset;
}

async function write(pool: sql.ConnectionPool, standardId: string, figure: { metricValue: number; numerator?: number; denominator?: number; sourceNote: string }) {
  const tx = new sql.Transaction(pool); await tx.begin();
  try {
    const written = await writeManualMetric(tx, { standardId, contractorId: CONTRACTOR, serviceMonth: "202608", enteredBy: "contract-test", ...figure });
    await tx.commit();
    return written;
  } catch (e) { try { await tx.rollback(); } catch { /* aborted */ } throw e; }
}

test("changing a hand-entered figure against real SQL", { skip: !connectionString && "DECISION_MATRIX_TEST_SQL_CONNECTION_STRING not set" }, async t => {
  const pool = await ownDatabase(connectionString!);
  try {
    for (const b of batches(readFileSync(join(process.cwd(), "sql", "migration-030-contractor-performance-assessment.sql"), "utf8"))) await pool.request().batch(b);
    await pool.request().batch(`INSERT Contractors(id,name,contract_start_date,contract_end_date,is_active,updated_by) VALUES('${CONTRACTOR}','Transit Operations','20260101','20261231',1,'contract-test');`);
    const standardId = (await pool.request().query<{ id: string }>(`SELECT id FROM ContractorPerformanceStandards WHERE code='AVG_MILES_ROAD_CALLS'`)).recordset[0].id;

    await t.test("the first entry for a month is live and supersedes nothing", async () => {
      const first = await write(pool, standardId, { metricValue: 12000, sourceNote: "Manual Tracking" });
      assert.equal(first.supersededId, null);
      const all = await rows(pool, standardId);
      assert.equal(all.length, 1);
      assert.equal(all[0].superseded_by, null);
    });

    await t.test("a second entry replaces the first: one live row, the old one pointing at the new", async () => {
      const [first] = await rows(pool, standardId);
      const second = await write(pool, standardId, { metricValue: 13300, numerator: 412300, denominator: 31, sourceNote: "M5 road call report" });
      assert.equal(second.supersededId, first.id);
      const all = await rows(pool, standardId);
      assert.equal(all.length, 2);
      const old = all.find(r => r.id === first.id)!, live = all.find(r => r.id === second.id)!;
      assert.equal(old.superseded_by, second.id, "the first entry records what replaced it");
      assert.equal(live.superseded_by, null, "the second entry is live, not left pointing at itself");
      assert.equal(Number(live.metric_value), 13300);
      assert.equal(Number(live.numerator), 412300);
      assert.equal(Number(live.denominator), 31);
      assert.equal(live.source_note, "M5 road call report");
    });

    await t.test("a third entry replaces the second the same way", async () => {
      const before = await rows(pool, standardId);
      const live = before.find(r => r.superseded_by === null)!;
      const third = await write(pool, standardId, { metricValue: 412300, numerator: 412300, denominator: 0, sourceNote: "M5 road call report, corrected" });
      assert.equal(third.supersededId, live.id);
      const after = await rows(pool, standardId);
      assert.deepEqual(after.filter(r => r.superseded_by === null).map(r => r.id), [third.id]);
    });
  } finally {
    await pool.close();
    await dropDatabase(connectionString!);
  }
});
