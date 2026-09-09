import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { assessPeriod } from "./assessment/assess";
import { finalizePeriod } from "./assessment/finalizePeriod";
import { generateArtifact } from "./assessment/generateArtifact";
import { issueFinal } from "./assessment/issueFinal";
import { voidLiveIssuanceProofSql, withPeriodReportLock } from "./assessment/issuanceProof";
import { materialChangeSql } from "./assessment/materialChange";
import { reviewedItemsSha256Sql } from "./assessment/reviewedItems";
import { openPeriodSql } from "./assessment/openPeriod";
import { agreementScope, assignedStandardCountSql } from "./assessment/schemaScope";
import { parseConnectionString, sql } from "./db";

// The assessment lifecycle against a real SQL Server (the CI contract job's
// container): the real migrations, a period opened the way the handler opens
// one, occurrences scored by the real assessPeriod, and the T-SQL fragments
// the handlers compose - the things the in-memory workflow seam specifies
// but cannot test. Each assertion is one rule the plan's Phase G named:
//
//   a recompute with unchanged inputs preserves the review; a changed input
//   resets it (the hash seam);
//   an approved excusable-delay claim removes its occurrence from the count
//   and keeps it in the raw count (ADR 0012);
//   the Escalation Streak reads issued outcomes only (ADR 0011);
//   a material change withdraws the share and voids the live proof (ADR 0009/0029);
//   at most one live Issuance Proof per period (UX_CR_LiveProof);
//   two report operations on one period serialise under the app lock.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;

// Every migration that alters an assessment table, in order. Views (031, 106)
// read tables outside this set and are not part of the lifecycle.
const MIGRATIONS = ["030-contractor-performance-assessment", "032b-governed-performance-assessment", "065-assessment-causality", "102-agreement-scoped-standards", "103-period-resolver-key", "104-measurement-source-kinds", "105-reference-values", "107-penalty-scaling", "108-team-and-owner-lists", "109-window-modes-and-staffing-split", "110-standard-category", "111-issuance-proof", "112a-period-rules-lock", "112b-share-binds-reviewed-items", "113-owner-principal", "114-cap-withdrawn"];

// sqlcmd splits on GO; mssql does not. Same rule: a line that is only GO.
function batches(text: string): string[] {
  return text.split(/^\s*GO\s*$/im).map(b => b.trim()).filter(Boolean);
}

const CONTRACTOR = "c0000000-0000-4000-8000-000000000001";
const AGREEMENT = "a0000000-0000-4000-8000-000000000001";
const ACTOR = "contract-test";

// The other contract tests share the job's `master` database and node runs
// test files in parallel, so this one gets a database of its own: created
// empty, migrated from the real files, dropped at the end.
const DATABASE = "mvta_assessment_contract";

async function ownDatabase(connectionString: string): Promise<sql.ConnectionPool> {
  const admin = await new sql.ConnectionPool(parseConnectionString(connectionString)).connect();
  try {
    await admin.request().batch(`IF DB_ID('${DATABASE}') IS NOT NULL BEGIN ALTER DATABASE [${DATABASE}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${DATABASE}]; END; CREATE DATABASE [${DATABASE}];`);
  } finally { await admin.close(); }
  return new sql.ConnectionPool({ ...parseConnectionString(connectionString), database: DATABASE }).connect();
}

async function fresh(pool: sql.ConnectionPool) {
  for (const m of MIGRATIONS) {
    const file = join(process.cwd(), "sql", `migration-${m}.sql`);
    for (const b of batches(readFileSync(file, "utf8"))) await pool.request().batch(b);
  }
}

async function seed(pool: sql.ConnectionPool) {
  const r = pool.request();
  await r.batch(`
    INSERT Contractors(id,name,contract_start_date,contract_end_date,is_active,updated_by) VALUES('${CONTRACTOR}','Transit Operations','20260101','20261231',1,'${ACTOR}');
    INSERT PerformanceAgreements(id,contractor_id,starts_on,ends_on,is_active,created_by) VALUES('${AGREEMENT}','${CONTRACTOR}','2026-01-01','2026-12-31',1,'${ACTOR}');
    INSERT AgreementStandards(agreement_id,standard_id,is_scored,effective_start_date,updated_by) SELECT '${AGREEMENT}',id,1,'20260101','${ACTOR}' FROM ContractorPerformanceStandards WHERE code='MISSED_TRIPS_FR';`);
}

// Opened with the handler's own SQL (lib/assessment/openPeriod), so a
// change there is exercised here rather than silently diverging.
async function openPeriod(pool: sql.ConnectionPool, month: string): Promise<string> {
  const scope = await agreementScope(pool);
  const req = pool.request(); req.input("contractor", sql.UniqueIdentifier, CONTRACTOR); req.input("month", sql.Char(6), month); req.input("agreement", sql.UniqueIdentifier, AGREEMENT);
  const assigned = (await req.query<{ n: number }>(`SELECT ${assignedStandardCountSql(scope)} n FROM Contractors c JOIN PerformanceAgreements a ON a.contractor_id=c.id WHERE c.id=@contractor`)).recordset[0].n;
  assert.ok(assigned > 0, "the agreement assigns the standard");
  const open = pool.request(); open.input("contractor", sql.UniqueIdentifier, CONTRACTOR); open.input("month", sql.Char(6), month); open.input("agreement", sql.UniqueIdentifier, AGREEMENT);
  return (await open.query<{ id: string }>(openPeriodSql(scope))).recordset[0].id;
}

async function compute(pool: sql.ConnectionPool, periodId: string) {
  const tx = new sql.Transaction(pool); await tx.begin();
  // Keep the real error: after a failed statement the rollback itself throws
  // "Transaction has been aborted", which would replace the cause.
  try { await assessPeriod(tx, periodId); await tx.commit(); } catch (e) { try { await tx.rollback(); } catch { /* already aborted */ } throw e; }
}

async function occurrence(pool: sql.ConnectionPool, day: string, opts: { attribution?: string; reliefId?: string | null } = {}) {
  const r = pool.request(); r.input("contractor", sql.UniqueIdentifier, CONTRACTOR); r.input("day", sql.Char(8), day); r.input("attribution", sql.NVarChar(30), opts.attribution ?? "contractor_error"); r.input("relief", sql.UniqueIdentifier, opts.reliefId ?? null);
  await r.query(`INSERT ComplianceOccurrences(standard_id,contractor_id,service_date,quantity,description,source,source_ref,review_status,attribution,relief_id,created_by) SELECT id,@contractor,@day,1,'Trip not operated','manual',CONCAT('test:',@day),'confirmed',@attribution,@relief,'${ACTOR}' FROM ContractorPerformanceStandards WHERE code='MISSED_TRIPS_FR'`);
}

async function item(pool: sql.ConnectionPool, periodId: string) {
  const r = pool.request(); r.input("period", sql.UniqueIdentifier, periodId);
  return (await r.query<{ id: string; input_sha256: string; occurrence_count: number; raw_occurrence_count: number; excluded_occurrence_count: number; proposed_amount: number; escalation_multiplier: number; consecutive_months_below: number; recommended_action: string | null; reviewed_input_sha256: string | null }>(`SELECT id,input_sha256,occurrence_count,raw_occurrence_count,excluded_occurrence_count,proposed_amount,escalation_multiplier,consecutive_months_below,recommended_action,reviewed_input_sha256 FROM PeriodKpiAssessments WHERE period_id=@period`)).recordset[0];
}

test("assessment lifecycle against real SQL", { skip: !connectionString && "DECISION_MATRIX_TEST_SQL_CONNECTION_STRING not set" }, async t => {
  const pool = await ownDatabase(connectionString!);
  try {
    await fresh(pool); await seed(pool);
    const july = await openPeriod(pool, "202607");

    await t.test("a recompute with unchanged inputs preserves the review; a changed input resets it", async () => {
      await occurrence(pool, "20260712"); await occurrence(pool, "20260713");
      await compute(pool, july);
      const first = await item(pool, july);
      assert.equal(first.occurrence_count, 2); assert.equal(Number(first.proposed_amount), 2000);
      const review = pool.request(); review.input("id", sql.UniqueIdentifier, first.id);
      await review.query(`UPDATE PeriodKpiAssessments SET recommended_action='confirmed',recommended_amount=proposed_amount,reviewed_input_sha256=input_sha256,reviewed_by='reviewer',reviewed_at=SYSUTCDATETIME() WHERE id=@id`);
      await pool.request().query(`UPDATE AssessmentPeriods SET status='stale' WHERE id='${july}'`);
      await compute(pool, july);
      const same = await item(pool, july);
      assert.equal(same.input_sha256, first.input_sha256); assert.equal(same.recommended_action, "confirmed");
      await occurrence(pool, "20260714");
      await pool.request().query(`UPDATE AssessmentPeriods SET status='stale',input_revision=input_revision+1 WHERE id='${july}'`);
      await compute(pool, july);
      const changed = await item(pool, july);
      assert.notEqual(changed.input_sha256, first.input_sha256); assert.equal(changed.occurrence_count, 3);
      assert.equal(changed.reviewed_input_sha256, null, "a changed input needs a new review");
    });

    await t.test("an approved excusable-delay claim removes its occurrence from the count and keeps it in the raw count", async () => {
      const claim = pool.request();
      const claimId = (await claim.query<{ id: string }>(`DECLARE @id UNIQUEIDENTIFIER=NEWID();INSERT ExcusableDelayClaims(id,contractor_id,service_month,event_description,event_started_at,notice_received_at,status,created_by) VALUES(@id,'${CONTRACTOR}','202607','Ice storm','2026-07-15T06:00:00','2026-07-15T12:00:00','approved','${ACTOR}');SELECT @id id`)).recordset[0].id;
      await occurrence(pool, "20260715", { reliefId: claimId });
      await occurrence(pool, "20260716", { attribution: "mvta_directed" });
      await pool.request().query(`UPDATE AssessmentPeriods SET status='stale',input_revision=input_revision+1 WHERE id='${july}'`);
      await compute(pool, july);
      const scored = await item(pool, july);
      assert.equal(scored.raw_occurrence_count, 5); assert.equal(scored.excluded_occurrence_count, 2); assert.equal(scored.occurrence_count, 3);
    });

    await t.test("the Escalation Streak reads issued outcomes only, one per month", async () => {
      // April and May issued below standard; June finalized but never issued; July is the fourth month.
      for (const [month, status] of [["202604", "issued"], ["202605", "issued"], ["202606", "finalized"]] as const) {
        const p = await openPeriod(pool, month);
        await occurrence(pool, `${month}10`);
        await compute(pool, p);
        await pool.request().query(`UPDATE AssessmentPeriods SET status='${status}' WHERE id='${p}'`);
      }
      await pool.request().query(`UPDATE AssessmentPeriods SET status='stale',input_revision=input_revision+1 WHERE id='${july}'`);
      await compute(pool, july);
      const scored = await item(pool, july);
      // April + May count (June is unissued and pauses), plus July itself = 3 -> escalation.
      assert.equal(scored.consecutive_months_below, 3); assert.equal(Number(scored.escalation_multiplier), 1.5);
    });

    await t.test("a material change withdraws the share and voids the live proof; only one proof can be live", async () => {
      const r = pool.request(); r.input("period", sql.UniqueIdentifier, july); r.input("actor", sql.NVarChar(200), ACTOR);
      await r.query(`
        UPDATE AssessmentPeriods SET status='finalized' WHERE id=@period;
        INSERT ComplianceReports(period_id,contractor_id,service_month,issuance_type,version,blob_path,content_sha256,assessed_total,generated_by) VALUES(@period,'${CONTRACTOR}','202607','preliminary',1,'p/1.html',REPLICATE('a',64),0,@actor);
        INSERT ValidationDraftShares(period_id,report_id,recipient,delivery_method,sender_attestation,shared_by,shared_at,validation_ends_on,computed_revision,items_sha256) SELECT @period,id,'c@example.com','email','sent',@actor,SYSUTCDATETIME(),'2026-08-10',1,${reviewedItemsSha256Sql("period")} FROM ComplianceReports WHERE period_id=@period;
        INSERT ComplianceReports(period_id,contractor_id,service_month,issuance_type,version,blob_path,content_sha256,assessed_total,generated_by) VALUES(@period,'${CONTRACTOR}','202607','final',1,'p/proof1.html',REPLICATE('b',64),0,@actor);`);
      await assert.rejects(pool.request().query(`INSERT ComplianceReports(period_id,contractor_id,service_month,issuance_type,version,blob_path,content_sha256,assessed_total,generated_by) VALUES('${july}','${CONTRACTOR}','202607','final',2,'p/proof2.html',REPLICATE('c',64),0,'${ACTOR}')`), /UX_CR_LiveProof/, "a second live proof is refused by the index");
      const change = pool.request(); change.input("period", sql.UniqueIdentifier, july); change.input("actor", sql.NVarChar(200), ACTOR);
      await change.query(materialChangeSql("period", "actor"));
      const after = (await pool.request().query<{ status: string; shares_open: number; proofs_live: number; voided_audit: number }>(`SELECT (SELECT status FROM AssessmentPeriods WHERE id='${july}') status,(SELECT COUNT(*) FROM ValidationDraftShares WHERE period_id='${july}' AND superseded_at IS NULL) shares_open,(SELECT COUNT(*) FROM ComplianceReports WHERE period_id='${july}' AND issuance_type='final' AND issued_at IS NULL AND voided_at IS NULL) proofs_live,(SELECT COUNT(*) FROM ComplianceAssessmentAudit WHERE action='issuance_proof_voided') voided_audit`)).recordset[0];
      assert.deepEqual(after, { status: "stale", shares_open: 0, proofs_live: 0, voided_audit: 1 });
      // The share bound the reviewed items (A2): re-doing a review after
      // sharing makes the recorded hash differ from the one finalize recomputes.
      const bound = pool.request(); bound.input("period", sql.UniqueIdentifier, july);
      const before = (await bound.query<{ recorded: string; current_hash: string }>(`SELECT TOP 1 v.items_sha256 recorded,${reviewedItemsSha256Sql("period")} current_hash FROM ValidationDraftShares v WHERE v.period_id=@period ORDER BY v.shared_at DESC`)).recordset[0];
      assert.equal(before.recorded, before.current_hash, "the share recorded the items as reviewed");
      await pool.request().query(`UPDATE PeriodKpiAssessments SET reviewed_input_sha256=REPLICATE('f',64) WHERE period_id='${july}'`);
      const changed = (await bound.query<{ recorded: string; current_hash: string }>(`SELECT TOP 1 v.items_sha256 recorded,${reviewedItemsSha256Sql("period")} current_hash FROM ValidationDraftShares v WHERE v.period_id=@period ORDER BY v.shared_at DESC`)).recordset[0];
      assert.notEqual(changed.recorded, changed.current_hash, "a review changed after sharing no longer matches the share");
      // With the first proof voided, a new one can be prepared.
      await pool.request().query(`INSERT ComplianceReports(period_id,contractor_id,service_month,issuance_type,version,blob_path,content_sha256,assessed_total,generated_by) VALUES('${july}','${CONTRACTOR}','202607','final',2,'p/proof2.html',REPLICATE('c',64),0,'${ACTOR}')`);
      const v = pool.request(); v.input("period", sql.UniqueIdentifier, july); v.input("actor", sql.NVarChar(200), ACTOR);
      await v.query(voidLiveIssuanceProofSql("period", "actor"));
    });

    await t.test("two concurrent prepares under the app lock leave exactly one live proof", async () => {
      // Each prepare does what the create handler does under the lock: void
      // the live proof, then insert its own. Concurrently, without the lock,
      // the second INSERT would collide on UX_CR_LiveProof; with it, the
      // second waits, sees the first's proof, voids it, and inserts.
      const prepare = (version: number) => withPeriodReportLock(pool, july, async tx => {
        const r = new sql.Request(tx); r.input("period", sql.UniqueIdentifier, july); r.input("actor", sql.NVarChar(200), ACTOR); r.input("version", sql.Int, version);
        await r.query(`${voidLiveIssuanceProofSql("period", "actor")} INSERT ComplianceReports(period_id,contractor_id,service_month,issuance_type,version,blob_path,content_sha256,assessed_total,generated_by) VALUES(@period,'${CONTRACTOR}','202607','final',@version,CONCAT('p/proof',@version,'.html'),REPLICATE('d',64),0,@actor)`);
        return version;
      });
      assert.deepEqual((await Promise.all([prepare(10), prepare(11)])).sort(), [10, 11]);
      const live = (await pool.request().query<{ n: number }>(`SELECT COUNT(*) n FROM ComplianceReports WHERE period_id='${july}' AND issuance_type='final' AND issued_at IS NULL AND voided_at IS NULL`)).recordset[0].n;
      assert.equal(live, 1);
    });

    await t.test("the lock holder finishes before the next operation starts", async () => {
      // The second operation is released only once the first is inside the
      // lock, so the ordering assertion does not depend on wall-clock timing.
      const order: string[] = [];
      let firstInside: () => void = () => undefined; const inside = new Promise<void>(r => { firstInside = r; });
      const first = withPeriodReportLock(pool, july, async () => { order.push("first-in"); firstInside(); await new Promise(r => setTimeout(r, 200)); order.push("first-out"); return 1; });
      await inside;
      const second = withPeriodReportLock(pool, july, async () => { order.push("second-in"); return 2; });
      assert.deepEqual(await Promise.all([first, second]), [1, 2]);
      assert.deepEqual(order, ["first-in", "first-out", "second-in"]);
    });

    await t.test("a month goes review -> draft -> share -> finalize -> proof -> issue through the production libs", async () => {
      // Blob Storage is not here; the artifact libs take an uploader.
      const blobs = new Map<string, string>(); const upload = async (path: string, html: string) => { blobs.set(path, html); };
      const august = await openPeriod(pool, "202608");
      await occurrence(pool, "20260805"); await occurrence(pool, "20260806");
      await compute(pool, august);
      const scored = await item(pool, august);
      const review = pool.request(); review.input("id", sql.UniqueIdentifier, scored.id);
      await review.query(`UPDATE PeriodKpiAssessments SET recommended_action='adjusted',recommended_amount=1500,recommendation_reason='One trip was MVTA-directed in practice',recommendation_by='reviewer',reviewed_input_sha256=input_sha256,reviewed_by='reviewer',reviewed_at=SYSUTCDATETIME() WHERE id=@id`);

      const draft = await generateArtifact(pool, { periodId: august, type: "preliminary", actor: "reviewer", upload });
      assert.equal(draft.status, 201); if (draft.status !== 201) return;
      assert.match(blobs.get(`periods/${august}/${draft.id}.html`) ?? "", /VALIDATION DRAFT/);
      assert.match(blobs.get(`periods/${august}/${draft.id}.html`) ?? "", /Recommended amount:<\/b> <b>\$1,500\.00/);

      // Share the draft. The share handler's own guards (a draft generated after
      // every review, the latest version, status in_review) are not driven here;
      // the row is written directly with the window already over, which is what
      // finalize reads.
      const share = pool.request(); share.input("period", sql.UniqueIdentifier, august); share.input("report", sql.UniqueIdentifier, draft.id);
      await share.query(`INSERT ValidationDraftShares(period_id,report_id,recipient,delivery_method,sender_attestation,shared_by,shared_at,validation_ends_on,computed_revision,items_sha256) SELECT @period,@report,'c@example.com','email','sent','reviewer',DATEADD(day,-10,SYSUTCDATETIME()),DATEADD(day,-1,CONVERT(date,SYSUTCDATETIME())),computed_revision,${reviewedItemsSha256Sql("period")} FROM AssessmentPeriods WHERE id=@period;UPDATE AssessmentPeriods SET status='in_validation',validation_ends_on=DATEADD(day,-1,CONVERT(date,SYSUTCDATETIME())) WHERE id=@period`);

      // The reviewer cannot finalize their own review; the Issuing Authority can.
      assert.equal((await finalizePeriod(pool, { periodId: august, actor: "reviewer" })).changed, false);
      assert.equal((await finalizePeriod(pool, { periodId: august, actor: "issuer" })).changed, true);
      const bound = (await pool.request().query<{ status: string; final_total: number; binding_amount: number; manager_action: string }>(`SELECT p.status,p.final_total,a.binding_amount,a.manager_action FROM AssessmentPeriods p JOIN PeriodKpiAssessments a ON a.period_id=p.id WHERE p.id='${august}'`)).recordset[0];
      assert.deepEqual({ status: bound.status, total: Number(bound.final_total), amount: Number(bound.binding_amount), action: bound.manager_action }, { status: "finalized", total: 1500, amount: 1500, action: "adjusted" });

      const proof = await generateArtifact(pool, { periodId: august, type: "final", actor: "issuer", upload });
      assert.equal(proof.status, 201); if (proof.status !== 201) return;
      await pool.request().query(`INSERT MvtaHolidayCalendarCoverage(id,coverage_through,updated_by) SELECT 1,'2027-12-31','${ACTOR}' WHERE NOT EXISTS(SELECT 1 FROM MvtaHolidayCalendarCoverage WHERE id=1)`);
      const refused = await issueFinal(pool, { reportId: proof.id, periodId: august, actor: "reviewer", recipient: "c@example.com", deliveryMethod: "email", senderAttestation: "sent", upload });
      assert.equal(refused.status, 409, "the reviewer cannot issue");
      const issued = await issueFinal(pool, { reportId: proof.id, periodId: august, actor: "issuer", recipient: "c@example.com", deliveryMethod: "email", senderAttestation: "sent", now: new Date("2026-09-10T15:00:00Z"), upload });
      assert.equal(issued.status, 200); if (issued.status !== 200) return;
      assert.notEqual(issued.hash, proof.hash, "the issued bytes carry the issuer and deadline");
      const row = (await pool.request().query<{ status: string; proof_sha256: string; content_sha256: string; issued_by: string; records: number; caps: number }>(`SELECT p.status,r.proof_sha256,r.content_sha256,r.issued_by,(SELECT COUNT(*) FROM FinalIssuanceRecords WHERE report_id=r.id) records,(SELECT COUNT(*) FROM CorrectiveActionPlans WHERE period_id=p.id) caps FROM ComplianceReports r JOIN AssessmentPeriods p ON p.id=r.period_id WHERE r.id='${proof.id}'`)).recordset[0];
      assert.equal(row.status, "issued"); assert.equal(row.proof_sha256.toLowerCase(), proof.hash); assert.equal(row.content_sha256.toLowerCase(), issued.hash); assert.equal(row.issued_by, "issuer"); assert.equal(row.records, 1);
      // MISSED_TRIPS_FR carries no tier that triggers a CAP, so issuance creates none.
      assert.equal(row.caps, 0);
      assert.match(blobs.get([...blobs.keys()].find(k => k.includes("-issued-"))!) ?? "", /Final Assessment/);
      assert.equal(issued.deadline.toISOString().slice(0, 10), "2026-09-24", "ten business days after a Thursday issuance");
    });
  } finally {
    await pool.close();
    const admin = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
    try { await admin.request().batch(`IF DB_ID('${DATABASE}') IS NOT NULL BEGIN ALTER DATABASE [${DATABASE}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${DATABASE}]; END`); } finally { await admin.close(); }
  }
});
