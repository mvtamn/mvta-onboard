import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parseConnectionString, sql } from "./db";

// Migration 158's own promises, against a real SQL Server (the CI contract
// job's container): that a QRG version seeds one Draft and no more, that an
// outcome and a proposal cannot disagree, and that the record survives the
// Draft it seeded. None of these are reachable from a unit test - they are
// constraints, and a constraint that is never exercised is a comment.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;

async function applyMigration(pool: sql.ConnectionPool, file: string) {
  const migration = readFileSync(join(process.cwd(), "sql", file), "utf8");
  for (const batch of migration.split(/^\s*GO\s*$/m)) {
    if (batch.trim()) await pool.request().batch(batch);
  }
}

type Seeding = {
  procedure_id: string;
  revision?: number;
  item_id: string;
  seen_version: string;
  outcome: "proposed" | "empty";
  outcome_reason?: string | null;
  proposed_json?: string | null;
  pages_read?: number;
};

test("migration 158 keeps one seeding per QRG version, and an outcome that matches its proposal", { skip: !connectionString }, async () => {
  if (!connectionString) return;
  const pool = new sql.ConnectionPool(parseConnectionString(connectionString));
  const run = randomUUID();
  const drive = `drive-${run}`;
  const site = `mvtamn.sharepoint.com,site-${run},web`;
  const ids: string[] = [];

  async function insert(seeding: Seeding): Promise<string> {
    const seedingId = randomUUID();
    ids.push(seedingId);
    await pool.request()
      .input("seeding_id", sql.UniqueIdentifier, seedingId)
      .input("procedure_id", sql.NVarChar, seeding.procedure_id)
      .input("revision", sql.Int, seeding.revision ?? 1)
      .input("site_id", sql.NVarChar, site)
      .input("drive_id", sql.NVarChar, drive)
      .input("item_id", sql.NVarChar, seeding.item_id)
      .input("seen_version", sql.NVarChar, seeding.seen_version)
      .input("qrg_name", sql.NVarChar, "QRG-014 Bus bridge.pdf")
      .input("qrg_mime", sql.NVarChar, "application/pdf")
      .input("pages_read", sql.Int, seeding.pages_read ?? 4)
      .input("outcome", sql.NVarChar, seeding.outcome)
      .input("outcome_reason", sql.NVarChar, seeding.outcome_reason ?? null)
      .input("proposed_json", sql.NVarChar, seeding.proposed_json ?? null)
      .input("model", sql.NVarChar, "contract-model")
      .input("seeded_by", sql.NVarChar, "contract")
      .query(`INSERT INTO DecisionMatrixQrgSeedings
        (seeding_id,procedure_id,revision,site_id,drive_id,item_id,seen_version,qrg_name,qrg_mime,pages_read,outcome,outcome_reason,proposed_json,model,seeded_by)
        VALUES(@seeding_id,@procedure_id,@revision,@site_id,@drive_id,@item_id,@seen_version,@qrg_name,@qrg_mime,@pages_read,@outcome,@outcome_reason,@proposed_json,@model,@seeded_by)`);
    return seedingId;
  }

  await pool.connect();
  try {
    const present = await pool.request().query<{ procedures: number }>(
      "SELECT CASE WHEN OBJECT_ID('dbo.Procedures','U') IS NULL THEN 0 ELSE 1 END AS procedures",
    );
    if (!present.recordset[0]?.procedures) await applyMigration(pool, "migration-076-procedure-drafts-and-document-references.sql");
    // Declared re-runnable; running it here keeps that promise honest.
    await applyMigration(pool, "migration-158-qrg-draft-seedings.sql");
    await applyMigration(pool, "migration-158-qrg-draft-seedings.sql");

    const proposal = JSON.stringify({ criteria: [{ kind: "applies", text: "Rail is replaced by bus" }], immediate_actions: [] });
    await insert({ procedure_id: "dm-bus-bridge", item_id: "item-qrg", seen_version: '"{Q},2"', outcome: "proposed", proposed_json: proposal });

    // The same QRG at the same version cannot seed a second Draft.
    await assert.rejects(
      () => insert({ procedure_id: "dm-bus-bridge-again", item_id: "item-qrg", seen_version: '"{Q},2"', outcome: "proposed", proposed_json: proposal }),
      /UX_DecisionMatrixQrgSeedings_Item|duplicate key/i,
      "a second seeding of the same QRG version must be refused",
    );

    // A revised QRG may.
    await insert({ procedure_id: "dm-bus-bridge-v3", item_id: "item-qrg", seen_version: '"{Q},3"', outcome: "proposed", proposed_json: proposal });

    // An empty outcome carries no proposal, and a proposed one must carry it:
    // outcome and proposed_json cannot disagree.
    await insert({ procedure_id: "dm-empty", item_id: "item-other", seen_version: '"{O},1"', outcome: "empty", outcome_reason: "The model proposed nothing." });
    await assert.rejects(
      () => insert({ procedure_id: "dm-bad", item_id: "item-bad", seen_version: '"{B},1"', outcome: "proposed" }),
      /CK_DecisionMatrixQrgSeedings_Proposal/,
      "a proposed seeding with no proposal must be refused",
    );
    await assert.rejects(
      () => insert({ procedure_id: "dm-bad-2", item_id: "item-bad-2", seen_version: '"{B},2"', outcome: "empty", proposed_json: proposal }),
      /CK_DecisionMatrixQrgSeedings_Proposal/,
      "an empty seeding carrying a proposal must be refused",
    );
    await assert.rejects(
      () => insert({ procedure_id: "dm-bad-3", item_id: "item-bad-3", seen_version: '"{B},3"', outcome: "withdrawn" as unknown as "empty" }),
      /CK_DecisionMatrixQrgSeedings_Outcome/,
      "an outcome outside the two recorded ones must be refused",
    );
    await assert.rejects(
      () => insert({ procedure_id: "dm-bad-4", item_id: "item-bad-4", seen_version: '"{B},4"', outcome: "empty", pages_read: -1 }),
      /CK_DecisionMatrixQrgSeedings_Pages/,
      "a negative page count must be refused",
    );

    // The record outlives the Draft, which is the case that matters: a Draft
    // discarded because the proposal was wrong is exactly when someone wants
    // to read what was proposed.
    await pool.request()
      .input("procedure_id", sql.NVarChar, "dm-bus-bridge")
      .input("condition_key", sql.NVarChar, `bus-bridge-${run}`)
      .query("INSERT INTO Procedures(procedure_id,condition_key,condition,created_by) VALUES(@procedure_id,@condition_key,'QRG seeding contract','contract')");
    await pool.request().input("procedure_id", sql.NVarChar, "dm-bus-bridge").query("DELETE FROM Procedures WHERE procedure_id=@procedure_id");
    const survived = await pool.request()
      .input("drive_id", sql.NVarChar, drive)
      .query<{ kept: number }>("SELECT COUNT(*) AS kept FROM DecisionMatrixQrgSeedings WHERE drive_id=@drive_id AND procedure_id='dm-bus-bridge'");
    assert.equal(survived.recordset[0]?.kept, 1, "deleting the Procedure must not delete the record of what was proposed");

    const kept = await pool.request()
      .input("drive_id", sql.NVarChar, drive)
      .query<{ item_id: string; seen_version: string; outcome: string }>(
        "SELECT item_id,seen_version,outcome FROM DecisionMatrixQrgSeedings WHERE drive_id=@drive_id ORDER BY item_id, seen_version",
      );
    assert.deepEqual(kept.recordset.map((row) => [row.item_id, row.seen_version, row.outcome]), [
      ["item-other", '"{O},1"', "empty"],
      ["item-qrg", '"{Q},2"', "proposed"],
      ["item-qrg", '"{Q},3"', "proposed"],
    ]);
  } finally {
    await pool.request().input("drive_id", sql.NVarChar, drive)
      .query("DELETE FROM DecisionMatrixQrgSeedings WHERE drive_id=@drive_id").catch(() => undefined);
    await pool.request().input("procedure_id", sql.NVarChar, "dm-bus-bridge")
      .query("DELETE FROM Procedures WHERE procedure_id=@procedure_id").catch(() => undefined);
    await pool.close();
  }
});
