import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parseConnectionString, sql } from "../db";
import { forgetPromotionCache } from "../missedTripCase/promotion";
import {
  parseOccurrenceSource,
  raiseCandidates,
  recordOccurrence,
  resolveOccurrence,
  setAssessedAmount,
  type IntakeOutcome,
  type RaiseParameters,
  type RaiseReport,
} from "./index";

// The occurrence intake module against a real SQL Server. decide.test.ts and
// sources.test.ts cover the pure rules; this file covers what only the
// database can show:
//
//   the contractor comes from the single active Agreement covering the service
//   date, and zero or several covering Agreements writes nothing;
//   the Agreement must score the standard on that date;
//   a finalized or issued month is never written or bumped, on any path;
//   a drafting month goes stale and a shared one takes the material change;
//   the nightly pass writes each observation once, and the review hand-off
//   restates the candidate the pass raised (one source reference).
//
// Assessment tables come from the real migrations, in a database of its own
// (see assessmentLifecycle.db.contract.test.ts). Source tables are built by
// hand to the shape their migrations leave them in, as migration106's and the
// missed-trip case contract tests do.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;
const DATABASE = "mvta_occurrence_intake_contract";
const MIGRATIONS = ["030-contractor-performance-assessment", "032b-governed-performance-assessment", "065-assessment-causality", "102-agreement-scoped-standards", "103-period-resolver-key", "104-measurement-source-kinds", "105-reference-values", "107-penalty-scaling", "108-team-and-owner-lists", "109-window-modes-and-staffing-split", "110-standard-category", "111-issuance-proof", "112a-period-rules-lock", "112b-share-binds-reviewed-items", "113-owner-principal", "114-cap-withdrawn"];

const SOURCES = `
-- Migration 134's promotion history, with the silent no-show detector out of
-- Shadow detection from before these cases: only a promoted detector raises a
-- candidate, and only for the service dates it was promoted for.
CREATE TABLE dbo.MissedTripDetectorPromotions (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  detector NVARCHAR(40) NOT NULL, effective_service_date CHAR(8) NOT NULL, promoted BIT NOT NULL,
  reason NVARCHAR(1000) NOT NULL, measured_precision DECIMAL(5,4) NULL, sample_size INT NULL,
  decided_by NVARCHAR(200) NOT NULL, decided_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
INSERT dbo.MissedTripDetectorPromotions (detector, effective_service_date, promoted, reason, decided_by)
  VALUES (N'gtfs_silent_no_show', N'20260101', 1, N'contract test', N'test@example.com');
CREATE TABLE dbo.MonitoredMissedTrips (
  trip_id NVARCHAR(100) NOT NULL, service_date NVARCHAR(20) NOT NULL, route_id NVARCHAR(50) NOT NULL,
  scheduled_departure_at DATETIME2 NOT NULL, grace_deadline_at DATETIME2 NOT NULL,
  status NVARCHAR(20) NOT NULL DEFAULT 'escalated', detected_late_arrival_at DATETIME2 NULL,
  validation_status NVARCHAR(30) NOT NULL DEFAULT 'unreviewed', detection_type NVARCHAR(30) NULL,
  detector_version NVARCHAR(30) NULL, data_quality_status NVARCHAR(30) NOT NULL DEFAULT 'legacy_unverified',
  source_system NVARCHAR(20) NOT NULL DEFAULT 'gtfs', source_record_id NVARCHAR(100) NULL,
  undecided_reason NVARCHAR(60) NULL, expected_window_end_at DATETIME2 NULL,
  CONSTRAINT PK_MonitoredMissedTrips PRIMARY KEY (trip_id, service_date)
);
CREATE TABLE dbo.FixedRouteDepartures (
  service_date CHAR(8) NOT NULL, block INT NOT NULL, run INT NOT NULL,
  pullout_scheduled DATETIME2 NULL, pullout_actual DATETIME2 NULL, pullout_status NVARCHAR(30) NULL,
  CONSTRAINT PK_FixedRouteDepartures PRIMARY KEY (service_date, block, run)
);
CREATE TABLE dbo.OnDemandDepartures (
  duty_id NVARCHAR(64) NOT NULL PRIMARY KEY, service_date CHAR(8) NOT NULL, duty_identifier NVARCHAR(64) NULL,
  duty_status NVARCHAR(32) NULL, departure_scheduled DATETIME2 NULL, scheduled_source NVARCHAR(32) NULL,
  departure_actual DATETIME2 NULL, departure_source NVARCHAR(32) NULL
);`;

const CONTRACTOR = "c0000000-0000-4000-8000-000000000001";
const OTHER_CONTRACTOR = "c0000000-0000-4000-8000-000000000002";
const AGREEMENT = "a0000000-0000-4000-8000-000000000001";
const OTHER_AGREEMENT = "a0000000-0000-4000-8000-000000000002";
const ACTOR = "intake-contract";

function batches(text: string): string[] {
  return text.split(/^\s*GO\s*$/im).map(b => b.trim()).filter(Boolean);
}

async function ownDatabase(cs: string): Promise<sql.ConnectionPool> {
  const admin = await new sql.ConnectionPool(parseConnectionString(cs)).connect();
  try {
    await admin.request().batch(`IF DB_ID('${DATABASE}') IS NOT NULL BEGIN ALTER DATABASE [${DATABASE}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${DATABASE}]; END; CREATE DATABASE [${DATABASE}];`);
  } finally { await admin.close(); }
  return new sql.ConnectionPool({ ...parseConnectionString(cs), database: DATABASE }).connect();
}

async function dropDatabase(cs: string) {
  const admin = await new sql.ConnectionPool(parseConnectionString(cs)).connect();
  try { await admin.request().batch(`IF DB_ID('${DATABASE}') IS NOT NULL BEGIN ALTER DATABASE [${DATABASE}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${DATABASE}]; END;`); }
  finally { await admin.close(); }
}

async function inTx(pool: sql.ConnectionPool, write: (tx: sql.Transaction) => Promise<IntakeOutcome>): Promise<IntakeOutcome> {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const outcome = await write(tx);
    if (outcome.ok) await tx.commit(); else await tx.rollback();
    return outcome;
  } catch (error) {
    try { await tx.rollback(); } catch { /* already aborted */ }
    throw error;
  }
}

async function period(pool: sql.ConnectionPool, month: string, status: string, contractor = CONTRACTOR) {
  await pool.request().query(`INSERT AssessmentPeriods(contractor_id,service_month,status,input_revision,agreement_id,validation_shared_at)
    VALUES('${contractor}','${month}','${status}',0,'${contractor === CONTRACTOR ? AGREEMENT : OTHER_AGREEMENT}',${status === "in_validation" ? "SYSUTCDATETIME()" : "NULL"})`);
}

async function periodState(pool: sql.ConnectionPool, month: string) {
  return (await pool.request().query<{ status: string; input_revision: number; validation_shared_at: Date | null }>(
    `SELECT status,input_revision,validation_shared_at FROM AssessmentPeriods WHERE contractor_id='${CONTRACTOR}' AND service_month='${month}'`)).recordset[0];
}

async function standardId(pool: sql.ConnectionPool, code: string): Promise<string> {
  return (await pool.request().query<{ id: string }>(`SELECT id FROM ContractorPerformanceStandards WHERE code='${code}'`)).recordset[0].id;
}

function manual(standard: string, serviceDate: string, contractorId?: string) {
  return { kind: "manual" as const, standardId: standard, serviceDate, quantity: 1, durationDays: null, qualifierCode: null, description: "Hand-entered", contractorId };
}

const params = (gates: Partial<RaiseParameters["gates"]>): RaiseParameters => ({
  gates: { missed_trips: false, fixed_route_departures: false, on_demand_departures: false, ...gates },
  allowFixedMissedTrips: true, allowSpareMissedTrips: true, varianceSeconds: 600, settledBefore: "20260917",
});

const refusalCode = (outcome: IntakeOutcome) => outcome.ok ? "ok" : outcome.refusal.code;

test("occurrence intake against real SQL", { skip: !connectionString && "DECISION_MATRIX_TEST_SQL_CONNECTION_STRING not set" }, async t => {
  const pool = await ownDatabase(connectionString!);
  forgetPromotionCache();
  try {
    for (const m of MIGRATIONS) {
      for (const b of batches(readFileSync(join(process.cwd(), "sql", `migration-${m}.sql`), "utf8"))) await pool.request().batch(b);
    }
    await pool.request().batch(SOURCES);
    // One Agreement for 2026 that scores Missed Trips and Garage Departure
    // from the start of the year; a second Agreement starting in October, so
    // October is covered twice. UX_Contractors_OneActive allows one active
    // contractor today, so the second is inactive - the rule reads Agreements,
    // and must not pick one of two however the contractors are flagged.
    await pool.request().batch(`
      INSERT Contractors(id,name,contract_start_date,contract_end_date,is_active,updated_by) VALUES
        ('${CONTRACTOR}','Transit Operations','20260101','20261231',1,'${ACTOR}'),
        ('${OTHER_CONTRACTOR}','Second Operator','20261001','20271231',0,'${ACTOR}');
      INSERT PerformanceAgreements(id,contractor_id,starts_on,ends_on,is_active,created_by) VALUES
        ('${AGREEMENT}','${CONTRACTOR}','2026-01-01','2026-12-31',1,'${ACTOR}'),
        ('${OTHER_AGREEMENT}','${OTHER_CONTRACTOR}','2026-10-01','2027-12-31',1,'${ACTOR}');
      INSERT AgreementStandards(agreement_id,standard_id,is_scored,effective_start_date,updated_by)
        SELECT '${AGREEMENT}',id,1,'20260101','${ACTOR}' FROM ContractorPerformanceStandards WHERE code IN ('MISSED_TRIPS_FR','GARAGE_DEPARTURE');`);
    const missedTrips = await standardId(pool, "MISSED_TRIPS_FR");
    const garage = await standardId(pool, "GARAGE_DEPARTURE");
    const uniform = await standardId(pool, "UNIFORM_COMPLIANCE");

    await t.test("a hand-entered occurrence takes the covering Agreement's contractor and stales a reviewed month", async () => {
      await period(pool, "202607", "in_review");
      const outcome = await inTx(pool, tx => recordOccurrence(tx, manual(garage, "20260710"), ACTOR));
      assert.ok(outcome.ok);
      assert.equal(outcome.occurrence.contractorId.toLowerCase(), CONTRACTOR);
      assert.equal(outcome.occurrence.serviceMonth, "202607");
      assert.deepEqual(await periodState(pool, "202607").then(p => [p.status, p.input_revision]), ["stale", 1]);
      // Naming the right contractor is fine; naming another is refused.
      assert.equal(refusalCode(await inTx(pool, tx => recordOccurrence(tx, manual(garage, "20260711", CONTRACTOR.toUpperCase()), ACTOR))), "ok");
      assert.equal(refusalCode(await inTx(pool, tx => recordOccurrence(tx, manual(garage, "20260712", OTHER_CONTRACTOR), ACTOR))), "contractor_mismatch");
    });

    await t.test("no covering Agreement, several, or an unscored standard writes nothing", async () => {
      const before = (await pool.request().query<{ n: number }>("SELECT COUNT(*) n FROM ComplianceOccurrences")).recordset[0].n;
      assert.equal(refusalCode(await inTx(pool, tx => recordOccurrence(tx, manual(garage, "20250710"), ACTOR))), "unassigned");
      assert.equal(refusalCode(await inTx(pool, tx => recordOccurrence(tx, manual(garage, "20261005"), ACTOR))), "unassigned");
      assert.equal(refusalCode(await inTx(pool, tx => recordOccurrence(tx, manual(uniform, "20260710"), ACTOR))), "standard_not_scored");
      assert.equal((await pool.request().query<{ n: number }>("SELECT COUNT(*) n FROM ComplianceOccurrences")).recordset[0].n, before);
    });

    await t.test("a finalized or issued month is never written or bumped, on any path", async () => {
      await period(pool, "202605", "finalized");
      await period(pool, "202606", "issued");
      for (const date of ["20260510", "20260610"]) {
        assert.equal(refusalCode(await inTx(pool, tx => recordOccurrence(tx, manual(garage, date), ACTOR))), "period_closed");
      }
      // An occurrence written before its month closed can no longer be resolved or given a figure.
      const early = await inTx(pool, tx => recordOccurrence(tx, manual(garage, "20260410"), ACTOR));
      assert.ok(early.ok);
      await pool.request().query(`INSERT AssessmentPeriods(contractor_id,service_month,status) VALUES('${CONTRACTOR}','202604','issued')`);
      const resolution = { reviewStatus: "dismissed" as const, attribution: "undetermined" as const, dismissReason: "no" };
      assert.equal(refusalCode(await inTx(pool, tx => resolveOccurrence(tx, early.occurrence.id, resolution, ACTOR))), "period_closed");
      assert.equal(refusalCode(await inTx(pool, tx => setAssessedAmount(tx, early.occurrence.id, { amount: 1, note: "x" }, ACTOR))), "period_closed");
      for (const month of ["202604", "202605", "202606"]) assert.equal((await periodState(pool, month)).input_revision, 0, month);
    });

    await t.test("a shared month takes the material change", async () => {
      await period(pool, "202608", "in_validation");
      assert.equal(refusalCode(await inTx(pool, tx => recordOccurrence(tx, manual(garage, "20260810"), ACTOR))), "ok");
      const shared = await periodState(pool, "202608");
      assert.deepEqual([shared.status, shared.input_revision, shared.validation_shared_at], ["stale", 1, null]);
    });

    await t.test("resolving checks the relief claim belongs to the occurrence's contractor and month", async () => {
      const occurrence = await inTx(pool, tx => recordOccurrence(tx, manual(garage, "20260715"), ACTOR));
      assert.ok(occurrence.ok);
      const claim = (await pool.request().query<{ id: string }>(`DECLARE @id UNIQUEIDENTIFIER=NEWID();
        INSERT ExcusableDelayClaims(id,contractor_id,service_month,event_description,event_started_at,notice_received_at,status,created_by)
        VALUES(@id,'${CONTRACTOR}','202608','Ice storm','2026-08-15T06:00:00','2026-08-15T12:00:00','approved','${ACTOR}'); SELECT @id id`)).recordset[0].id;
      const link = { reviewStatus: "confirmed" as const, attribution: "excusable" as const, dismissReason: null, reliefId: claim };
      assert.equal(refusalCode(await inTx(pool, tx => resolveOccurrence(tx, occurrence.occurrence.id, link, ACTOR))), "relief_mismatch");
      assert.equal(refusalCode(await inTx(pool, tx => resolveOccurrence(tx, occurrence.occurrence.id, { ...link, reliefId: null }, ACTOR))), "ok");
      assert.equal(refusalCode(await inTx(pool, tx => resolveOccurrence(tx, "00000000-0000-4000-8000-000000000000", link, ACTOR))), "not_found");
    });

    await t.test("the nightly pass writes each accepted observation once and counts the rest", async () => {
      await pool.request().batch(`
        INSERT FixedRouteDepartures(service_date,block,run,pullout_scheduled,pullout_actual,pullout_status) VALUES
          ('20260902',1305,2,'2026-09-02T10:00:00',NULL,'Missed Pullout'),
          ('20260903',1305,2,'2026-09-03T10:00:00','2026-09-03T10:30:00','Late Pullout'),
          ('20260903',1306,1,'2026-09-03T10:00:00','2026-09-03T10:02:00','Late Pullout'),
          ('20260510',1305,2,'2026-05-10T10:00:00',NULL,'Missed Pullout'),
          ('20251215',1305,2,'2025-12-15T10:00:00',NULL,'Missed Pullout');
        INSERT OnDemandDepartures(duty_id,service_date,duty_status,departure_scheduled,departure_actual) VALUES
          ('duty-1','20260904','completed','2026-09-04T12:00:00',NULL);
        INSERT MonitoredMissedTrips(trip_id,service_date,route_id,scheduled_departure_at,grace_deadline_at,status,validation_status,detection_type,detector_version,data_quality_status,source_system)
          VALUES('trip-9','20260905','460','2026-09-05T14:00:00','2026-09-05T14:30:00','escalated','confirmed','silent_no_show','gtfs-silent-v3','source_verified','gtfs');`);
      await period(pool, "202609", "open");
      const all = params({ missed_trips: true, fixed_route_departures: true, on_demand_departures: true });
      const first = await raiseCandidates(pool, all);
      assert.deepEqual(first.fixed_route_departures, { raised: 2, unassigned: 1, not_scored: 0, period_closed: 1 } satisfies RaiseReport);
      assert.deepEqual(first.on_demand_departures, { raised: 1, unassigned: 0, not_scored: 0, period_closed: 0 });
      assert.deepEqual(first.missed_trips, { raised: 1, unassigned: 0, not_scored: 0, period_closed: 0 });
      assert.equal((await periodState(pool, "202609")).input_revision, 3, "each source's pass bumps a month it wrote to once");

      const second = await raiseCandidates(pool, all);
      assert.equal((await periodState(pool, "202609")).input_revision, 3, "a pass that writes nothing bumps nothing");
      assert.deepEqual(second.fixed_route_departures, { raised: 0, unassigned: 1, not_scored: 0, period_closed: 1 });
      assert.deepEqual(second.missed_trips, { raised: 0, unassigned: 0, not_scored: 0, period_closed: 0 });
      assert.deepEqual((await raiseCandidates(pool, params({}))).missed_trips, { skipped: true });

      const refs = (await pool.request().query<{ source_ref: string; contractor_id: string }>(
        "SELECT source_ref, contractor_id FROM ComplianceOccurrences WHERE source='auto_candidate' ORDER BY source_ref")).recordset;
      assert.deepEqual(refs.map(r => parseOccurrenceSource(r.source_ref)), [
        { kind: "fixed_route_departure", service_date: "20260902", block: "1305", run: "2" },
        { kind: "fixed_route_departure", service_date: "20260903", block: "1305", run: "2" },
        { kind: "missed_trip", system: "gtfs", record_id: "trip-9", service_date: "20260905" },
        { kind: "on_demand_departure", duty_id: "duty-1" },
      ]);
      assert.ok(refs.every(r => r.contractor_id.toLowerCase() === CONTRACTOR));
    });

    await t.test("the review hand-off restates the candidate the pass raised", async () => {
      const review = (reviewStatus: "confirmed" | "dismissed") => ({ kind: "missed_trip_review" as const, tripId: "trip-9", serviceDate: "20260905", reviewStatus, attribution: "contractor_error" as const, note: "reviewed" });
      const confirmed = await inTx(pool, tx => recordOccurrence(tx, review("confirmed"), ACTOR));
      const dismissed = await inTx(pool, tx => recordOccurrence(tx, review("dismissed"), ACTOR));
      assert.ok(confirmed.ok && dismissed.ok);
      assert.equal(confirmed.occurrence.id, dismissed.occurrence.id);
      const row = (await pool.request().query<{ n: number; review_status: string; dismiss_reason: string }>(
        "SELECT COUNT(*) OVER () n, review_status, dismiss_reason FROM ComplianceOccurrences WHERE source_ref LIKE 'MonitoredMissedTrips:%'")).recordset;
      assert.deepEqual(row, [{ n: 1, review_status: "dismissed", dismiss_reason: "reviewed" }]);

      await pool.request().query(`UPDATE AssessmentPeriods SET status='finalized' WHERE contractor_id='${CONTRACTOR}' AND service_month='202609'`);
      assert.equal(refusalCode(await inTx(pool, tx => recordOccurrence(tx, review("confirmed"), ACTOR))), "period_closed");
      assert.equal(refusalCode(await inTx(pool, tx => recordOccurrence(tx, { ...review("confirmed"), tripId: "missing" }, ACTOR))), "not_found");
    });

    await t.test("a figure outside the contract's band is refused", async () => {
      // The migrations seed no ranged band, so one is added the way the
      // Performance Standards admin stores it: $2,500-$10,000 per occurrence.
      const shutdown = await standardId(pool, "SHUTDOWN_VEHICLE");
      await pool.request().query(`INSERT ContractorStandardTiers(standard_id,tier_order,tier_label,penalty_basis,penalty_amount,penalty_amount_min,penalty_amount_max,effective_start_date,updated_by)
        VALUES('${shutdown}',99,'tier1','per_unit',0,2500,10000,'20260101','${ACTOR}')`);
      const damage = { standard_id: shutdown, penalty_amount_min: 2500, penalty_amount_max: 10000 };
      await pool.request().query(`INSERT AgreementStandards(agreement_id,standard_id,is_scored,effective_start_date,updated_by) VALUES('${AGREEMENT}','${damage.standard_id}',1,'20260101','${ACTOR}')`);
      const occurrence = await inTx(pool, tx => recordOccurrence(tx, manual(damage.standard_id, "20260720"), ACTOR));
      assert.ok(occurrence.ok);
      const above = Number(damage.penalty_amount_max) + 1;
      assert.equal(refusalCode(await inTx(pool, tx => setAssessedAmount(tx, occurrence.occurrence.id, { amount: above, note: "estimate" }, ACTOR))), "amount_outside_band");
      assert.equal(refusalCode(await inTx(pool, tx => setAssessedAmount(tx, occurrence.occurrence.id, { amount: Number(damage.penalty_amount_min), note: "estimate" }, ACTOR))), "ok");
      assert.equal(refusalCode(await inTx(pool, tx => setAssessedAmount(tx, occurrence.occurrence.id, null, ACTOR))), "ok");
    });
  } finally {
    forgetPromotionCache();
    await pool.close();
    await dropDatabase(connectionString!);
  }
});
