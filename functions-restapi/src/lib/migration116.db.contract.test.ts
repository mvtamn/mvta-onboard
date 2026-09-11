import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseConnectionString, sql } from "./db";

// Migration 116, applied to a real SQL Server (the CI contract job's
// container). A migration that is never executed anywhere is not verified by
// anything: a filtered unique index, a cascading foreign key and a CHECK
// constraint all parse fine to a human reading them and fail at apply time for
// reasons no unit test can reach. The migration is also declared re-runnable,
// which is a promise, so it is applied twice here.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;

const FILE = "migration-116-decision-matrix-document-locations.sql";

async function applyMigration(pool: sql.ConnectionPool) {
  const text = readFileSync(join(process.cwd(), "sql", FILE), "utf8");
  for (const batch of text.split(/^\s*GO\s*$/gim).map((part) => part.trim()).filter(Boolean)) {
    await pool.request().batch(batch);
  }
}

const LOCATION = "loc-occ-sops";
const SITE = "mvtamn.sharepoint.com,aaa,bbb";
const DRIVE = "drive-1";

test("migration 116 applies, is re-runnable, and holds the shape the sync depends on", { skip: !connectionString && "DECISION_MATRIX_TEST_SQL_CONNECTION_STRING not set" }, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await pool.request().batch(`
      IF OBJECT_ID('dbo.DecisionMatrixLocationDocuments','U') IS NOT NULL DROP TABLE dbo.DecisionMatrixLocationDocuments;
      IF OBJECT_ID('dbo.DecisionMatrixDocumentLocations','U') IS NOT NULL DROP TABLE dbo.DecisionMatrixDocumentLocations;`);

    await applyMigration(pool);
    // Declared re-runnable. A migration run twice by hand is routine here.
    await applyMigration(pool);

    await pool.request().query(`INSERT dbo.DecisionMatrixDocumentLocations(location_id,site_id,drive_id,folder_path,label,added_by)
      VALUES('${LOCATION}','${SITE}','${DRIVE}','_SOPs/_OCC Documents','OCC SOPs','admin@mvta')`);

    // The same folder cannot be watched twice: it would sync twice and report
    // every change twice.
    await assert.rejects(
      pool.request().query(`INSERT dbo.DecisionMatrixDocumentLocations(location_id,site_id,drive_id,folder_path,label,added_by)
        VALUES('loc-duplicate','${SITE}','${DRIVE}','_SOPs/_OCC Documents','Duplicate','admin@mvta')`),
      /duplicate key|UX_DecisionMatrixDocumentLocations_Folder/i,
      "a second active row for the same folder must be refused",
    );

    // Retiring the first frees the folder, which is what the filtered index is for.
    await pool.request().query(`UPDATE dbo.DecisionMatrixDocumentLocations SET is_active=0 WHERE location_id='${LOCATION}'`);
    await pool.request().query(`INSERT dbo.DecisionMatrixDocumentLocations(location_id,site_id,drive_id,folder_path,label,added_by)
      VALUES('loc-replacement','${SITE}','${DRIVE}','_SOPs/_OCC Documents','OCC SOPs again','admin@mvta')`);

    // Reactivating the retired one while the replacement still holds the folder
    // is the same collision by another route, and is refused the same way. The
    // first version of this test reactivated it blind to restore state, and the
    // index caught that - which is the behaviour, not a snag in it.
    await assert.rejects(
      pool.request().query(`UPDATE dbo.DecisionMatrixDocumentLocations SET is_active=1 WHERE location_id='${LOCATION}'`),
      /duplicate key|UX_DecisionMatrixDocumentLocations_Folder/i,
      "reactivating a location whose folder is now watched by another must be refused",
    );

    // Retiring the replacement is what makes room for it again.
    await pool.request().query(`DELETE dbo.DecisionMatrixDocumentLocations WHERE location_id='loc-replacement'`);
    await pool.request().query(`UPDATE dbo.DecisionMatrixDocumentLocations SET is_active=1 WHERE location_id='${LOCATION}'`);

    // last_sync_status must name a fault it can actually be.
    await assert.rejects(
      pool.request().query(`UPDATE dbo.DecisionMatrixDocumentLocations SET last_sync_status='sort-of' WHERE location_id='${LOCATION}'`),
      /CK_DecisionMatrixDocumentLocations_SyncStatus|conflicted/i,
      "an unknown sync status must be refused",
    );
    for (const status of ["ok", "forbidden", "not_found", "failed"]) {
      await pool.request().query(`UPDATE dbo.DecisionMatrixDocumentLocations SET last_sync_status='${status}' WHERE location_id='${LOCATION}'`);
    }

    // A document defaults to present, and folder_path defaults to the root.
    await pool.request().query(`INSERT dbo.DecisionMatrixLocationDocuments(location_id,item_id,name) VALUES('${LOCATION}','item-1','SOP.pdf')`);
    const row = await pool.request().query<{ relative_path: string; disappeared_at: Date | null; first_seen_at: Date }>(
      `SELECT relative_path,disappeared_at,first_seen_at FROM dbo.DecisionMatrixLocationDocuments WHERE location_id='${LOCATION}' AND item_id='item-1'`);
    assert.equal(row.recordset[0].relative_path, "", "a document directly in the watched folder has an empty relative path");
    assert.equal(row.recordset[0].disappeared_at, null, "a newly seen document is present");
    assert.ok(row.recordset[0].first_seen_at instanceof Date);

    // A document cannot belong to a location that does not exist.
    await assert.rejects(
      pool.request().query(`INSERT dbo.DecisionMatrixLocationDocuments(location_id,item_id,name) VALUES('no-such-location','item-2','Orphan.pdf')`),
      /FK_DecisionMatrixLocationDocuments_Location|conflicted/i,
      "an orphan document row must be refused",
    );

    // Removing a location takes its observations with it - they describe that
    // location and mean nothing without it.
    await pool.request().query(`DELETE dbo.DecisionMatrixDocumentLocations WHERE location_id='${LOCATION}'`);
    const left = await pool.request().query<{ n: number }>(`SELECT COUNT(*) n FROM dbo.DecisionMatrixLocationDocuments WHERE location_id='${LOCATION}'`);
    assert.equal(left.recordset[0].n, 0, "documents must cascade with their location");
  } finally {
    await pool.close();
  }
});
