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
//
// It also pins what a figure does to the month it belongs to. A hand-entered
// figure is an Assessable Input: a closed month is refused and never written,
// and a shared one takes the Material Assessment Change (ADR 0009). Only the
// real migrations have the validation columns, the share table and the
// Issuance Proof those rules touch.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;

const MIGRATIONS = ["030-contractor-performance-assessment", "032b-governed-performance-assessment", "065-assessment-causality", "102-agreement-scoped-standards", "103-period-resolver-key", "104-measurement-source-kinds", "105-reference-values", "107-penalty-scaling", "108-team-and-owner-lists", "109-window-modes-and-staffing-split", "110-standard-category", "111-issuance-proof", "112a-period-rules-lock", "112b-share-binds-reviewed-items", "113-owner-principal", "114-cap-withdrawn"];

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
  // SQL Server hands uniqueidentifiers back upper-case; crypto.randomUUID() is lower-case. Compare in one case.
  return (await r.query<Row>(`SELECT id,metric_value,numerator,denominator,source_note,superseded_by FROM ManualMetricEntries WHERE standard_id=@standard AND contractor_id='${CONTRACTOR}' AND service_month='202608' ORDER BY entered_at`)).recordset
    .map(row => ({ ...row, id: row.id.toLowerCase(), superseded_by: row.superseded_by?.toLowerCase() ?? null }));
}
const lower = (value: string | null) => value?.toLowerCase() ?? null;

type Figure = { metricValue: number; numerator?: number; denominator?: number; sourceNote: string };

async function save(pool: sql.ConnectionPool, standardId: string, month: string, figure: Figure) {
  const tx = new sql.Transaction(pool); await tx.begin();
  try {
    const outcome = await writeManualMetric(tx, { standardId, contractorId: CONTRACTOR, serviceMonth: month, enteredBy: "contract-test", ...figure });
    if (!outcome.ok) { await tx.rollback(); return outcome; }
    await tx.commit();
    return outcome;
  } catch (e) { try { await tx.rollback(); } catch { /* aborted */ } throw e; }
}

// The superseding subtests use 202608, which no period was ever opened for.
async function write(pool: sql.ConnectionPool, standardId: string, figure: Figure) {
  const outcome = await save(pool, standardId, "202608", figure);
  assert.ok(outcome.ok, "the figure was refused");
  return outcome.written;
}

async function period(pool: sql.ConnectionPool, month: string, status: string) {
  await pool.request().query(`INSERT AssessmentPeriods(contractor_id,service_month,status,input_revision,validation_shared_at)
    VALUES('${CONTRACTOR}','${month}','${status}',0,${status === "in_validation" ? "SYSUTCDATETIME()" : "NULL"})`);
}

async function periodState(pool: sql.ConnectionPool, month: string) {
  return (await pool.request().query<{ status: string; input_revision: number; validation_shared_at: Date | null }>(
    `SELECT status,input_revision,validation_shared_at FROM AssessmentPeriods WHERE contractor_id='${CONTRACTOR}' AND service_month='${month}'`)).recordset[0];
}

async function liveFigures(pool: sql.ConnectionPool, month: string): Promise<number> {
  return (await pool.request().query<{ n: number }>(
    `SELECT COUNT(*) n FROM ManualMetricEntries WHERE contractor_id='${CONTRACTOR}' AND service_month='${month}'`)).recordset[0].n;
}

test("changing a hand-entered figure against real SQL", { skip: !connectionString && "DECISION_MATRIX_TEST_SQL_CONNECTION_STRING not set" }, async t => {
  const pool = await ownDatabase(connectionString!);
  try {
    for (const m of MIGRATIONS) {
      for (const b of batches(readFileSync(join(process.cwd(), "sql", `migration-${m}.sql`), "utf8"))) await pool.request().batch(b);
    }
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
      assert.equal(lower(second.supersededId), first.id);
      const all = await rows(pool, standardId);
      assert.equal(all.length, 2);
      const old = all.find(r => r.id === first.id)!, live = all.find(r => r.id === lower(second.id))!;
      assert.equal(old.superseded_by, lower(second.id), "the first entry records what replaced it");
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
      assert.equal(lower(third.supersededId), live.id);
      const after = await rows(pool, standardId);
      assert.deepEqual(after.filter(r => r.superseded_by === null).map(r => r.id), [lower(third.id)]);
    });

    await t.test("a drafting month is bumped, and a reviewed one goes stale", async () => {
      await period(pool, "202605", "in_review");
      assert.ok((await save(pool, standardId, "202605", { metricValue: 11000, sourceNote: "M5 road call report" })).ok);
      assert.deepEqual(await periodState(pool, "202605").then(p => [p.status, p.input_revision]), ["stale", 1]);
    });

    await t.test("an issued month is refused: nothing written, nothing bumped", async () => {
      await period(pool, "202604", "issued");
      const outcome = await save(pool, standardId, "202604", { metricValue: 9000, sourceNote: "M5 road call report" });
      assert.equal(outcome.ok ? "ok" : outcome.refusal.code, "period_closed");
      assert.equal(await liveFigures(pool, "202604"), 0, "the figure was not stored");
      assert.deepEqual(await periodState(pool, "202604").then(p => [p.status, p.input_revision]), ["issued", 0]);
    });

    await t.test("a shared month takes the material change: the share is withdrawn and the proof voided", async () => {
      await period(pool, "202606", "in_validation");
      const periodId = (await pool.request().query<{ id: string }>(`SELECT id FROM AssessmentPeriods WHERE contractor_id='${CONTRACTOR}' AND service_month='202606'`)).recordset[0].id;
      // A Shared Validation Draft, and the live Issuance Proof rendered from it.
      await pool.request().batch(`
        DECLARE @report UNIQUEIDENTIFIER=NEWID();
        INSERT ComplianceReports(id,period_id,contractor_id,service_month,issuance_type,version,blob_path,content_sha256,assessed_total,generated_by)
          VALUES(@report,'${periodId}','${CONTRACTOR}','202606','final',1,'proofs/202606-v1.html',REPLICATE('a',64),0,'contract-test');
        INSERT ValidationDraftShares(period_id,report_id,recipient,delivery_method,sender_attestation,shared_by,shared_at,validation_ends_on)
          VALUES('${periodId}',@report,'ops@example.com','email','Sent to the contractor','contract-test',SYSUTCDATETIME(),'2026-07-15');`);

      assert.ok((await save(pool, standardId, "202606", { metricValue: 10500, sourceNote: "M5 road call report" })).ok);

      const shared = await periodState(pool, "202606");
      assert.deepEqual([shared.status, shared.input_revision, shared.validation_shared_at], ["stale", 1, null], "the month goes back through recompute and re-share");
      const live = (await pool.request().query<{ shares: number; proofs: number }>(`
        SELECT (SELECT COUNT(*) FROM ValidationDraftShares WHERE period_id='${periodId}' AND superseded_at IS NULL) shares,
               (SELECT COUNT(*) FROM ComplianceReports WHERE period_id='${periodId}' AND voided_at IS NULL) proofs`)).recordset[0];
      assert.deepEqual([live.shares, live.proofs], [0, 0], "the share is withdrawn and the proof voided, as for any other change to a shared month");
    });
  } finally {
    await pool.close();
    await dropDatabase(connectionString!);
  }
});
