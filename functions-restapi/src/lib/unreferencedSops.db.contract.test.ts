import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parseConnectionString, sql } from "./db";
import { walkLocation } from "./decisionMatrixLocationSync";
import type { LibraryEntry, LibraryListing } from "./sharepointLibrary";
import { ensureSopLocation, recordSopFolderWalk, unreferencedSopReport, type SopLocation } from "./unreferencedSops";

// The SOP folder walk and the Unreferenced SOP report against a real SQL
// Server (the CI contract job's container). The contract database is shared
// with other files, so this run uses its own site and drive and never drops a
// table. Migration 116 is declared re-runnable; running it here keeps that
// promise honest and tolerates migration116's own test having rebuilt it.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;

async function applyMigration(pool: sql.ConnectionPool, file: string) {
  const migration = readFileSync(join(process.cwd(), "sql", file), "utf8");
  for (const batch of migration.split(/^\s*GO\s*$/m)) {
    if (batch.trim()) await pool.request().batch(batch);
  }
}

const file = (folder: string, name: string, etag = `"{${name}},1"`): LibraryEntry => ({
  item_id: `item-${name}`, name, kind: "file", path: folder ? `${folder}/${name}` : name,
  mime_type: "application/pdf", size_bytes: 1024, etag, last_modified_at: "2026-09-01T00:00:00Z", child_count: null, web_url: null,
});
const subfolder = (path: string): LibraryEntry => ({
  item_id: `folder-${path}`, name: path.split("/").pop()!, kind: "folder", path, mime_type: null, size_bytes: null, etag: null, last_modified_at: null, child_count: 1, web_url: null,
});

/** A library whose folders answer from a map; a folder mapped to a string refuses with that reason. */
function libraryOf(folders: Record<string, LibraryEntry[] | string>) {
  return async (path: string): Promise<LibraryListing> => {
    const answer = folders[path];
    if (answer === undefined) return { outcome: "not_found", path, reason: "SharePoint has no folder at that path." };
    if (typeof answer === "string") return { outcome: "forbidden", path, reason: answer };
    return { outcome: "ok", path, entries: answer };
  };
}

test("the SOP folder walk records what it saw, and the report names only the SOPs no current Procedure uses", { skip: !connectionString }, async () => {
  if (!connectionString) return;
  const pool = new sql.ConnectionPool(parseConnectionString(connectionString));
  const run = randomUUID();
  const site = `mvtamn.sharepoint.com,site-${run},web`;
  const drive = `drive-${run}`;
  const library = { site_id: site, drive_id: drive };
  const procedures: string[] = [];

  async function reference(item: string, state: string, referenceSite = site, referenceDrive = drive) {
    const procedureId = `dm-sop-${state.replace(" ", "-").toLowerCase()}-${randomUUID()}`;
    procedures.push(procedureId);
    await pool.request()
      .input("procedure_id", sql.NVarChar, procedureId)
      .input("condition_key", sql.NVarChar, procedureId)
      .input("state", sql.NVarChar, state)
      .input("reference_id", sql.UniqueIdentifier, randomUUID())
      .input("site_id", sql.NVarChar, referenceSite)
      .input("drive_id", sql.NVarChar, referenceDrive)
      .input("item_id", sql.NVarChar, item)
      .query(`
        INSERT INTO Procedures(procedure_id,condition_key,condition,created_by) VALUES(@procedure_id,@condition_key,'Unreferenced SOP contract','contract');
        INSERT INTO ProcedureRevisions(procedure_id,revision,lifecycle_state,created_by,updated_by) VALUES(@procedure_id,1,@state,'contract','contract');
        INSERT INTO ProcedureDocumentReferences(reference_id,procedure_id,revision,sort_order,document_type,is_primary,document_code,site_id,drive_id,item_id,expected_version,expected_file_name,expected_mime_type,web_url)
        VALUES(@reference_id,@procedure_id,1,1,'SOP',1,'SOP-CONTRACT',@site_id,@drive_id,@item_id,'"v"','SOP.pdf','application/pdf','https://mvtamn.sharepoint.com/SOP.pdf');`);
  }

  await pool.connect();
  try {
    const tables = await pool.request().query<{ procedures: number; audit: number; tags: number }>("SELECT CASE WHEN OBJECT_ID('dbo.Procedures', 'U') IS NULL THEN 0 ELSE 1 END procedures,CASE WHEN OBJECT_ID('dbo.ProcedureAuditEvents', 'U') IS NULL THEN 0 ELSE 1 END audit,CASE WHEN COL_LENGTH('dbo.ProcedureRevisions','tags_json') IS NULL THEN 0 ELSE 1 END tags");
    if (!tables.recordset[0]?.procedures) await applyMigration(pool, "migration-076-procedure-drafts-and-document-references.sql");
    if (!tables.recordset[0]?.audit) await applyMigration(pool, "migration-078-procedure-governance-audit.sql");
    if (!tables.recordset[0]?.tags) await applyMigration(pool, "migration-080-decision-matrix-search-and-match-rules.sql");
    await applyMigration(pool, "migration-116-decision-matrix-document-locations.sql");

    const setting = { configured: true as const, folder_path: "_SOPs" };
    const report = (now = new Date()) => unreferencedSopReport(pool, library, setting, null, now);

    // Before any walk, the report says so rather than reporting zero.
    const location: SopLocation = await ensureSopLocation(pool, site, drive, "_SOPs");
    assert.equal((await report()).walk.status, "not_walked");
    // Ensuring the location again does not add a second one.
    assert.equal((await ensureSopLocation(pool, site, drive, "_SOPs")).location_id, location.location_id);

    // A complete walk of _SOPs and its subfolder.
    const folders = {
      "_SOPs": [file("_SOPs", "Drafted.pdf"), file("_SOPs", "Retired only.pdf"), file("_SOPs", "Other drive.pdf"), file("_SOPs", "Approved.pdf"), subfolder("_SOPs/_OCC Documents")],
      "_SOPs/_OCC Documents": [file("_SOPs/_OCC Documents", "New.pdf")],
    } as Record<string, LibraryEntry[] | string>;
    const first = await walkLocation(libraryOf(folders), location.folder_path);
    assert.equal(first.complete, true);
    assert.equal((await recordSopFolderWalk(pool, location, first)).added, 5);

    await reference("item-Drafted.pdf", "Draft");
    await reference("item-Retired only.pdf", "Retired");
    await reference("item-Other drive.pdf", "Approved", site, "some-other-drive");
    // Written with the site in another form, as hand-typed references were.
    await reference("item-Approved.pdf", "Approved", "7b84f005-site-guid-only", drive);

    let result = await report();
    assert.equal(result.walk.status, "ok");
    assert.equal(result.walk.overdue, false);
    assert.deepEqual(result.documents.map((document) => [document.name, document.folder, document.path]).sort(), [
      ["New.pdf", "_SOPs/_OCC Documents", "_SOPs/_OCC Documents/New.pdf"],
      ["Other drive.pdf", "_SOPs", "_SOPs/Other drive.pdf"],
      ["Retired only.pdf", "_SOPs", "_SOPs/Retired only.pdf"],
    ], "a Draft or Approved reference in this drive covers a document; a Retired one, or one in another drive, does not");

    // A walk that SharePoint refused part-way concludes nothing from absence.
    const refused = await walkLocation(libraryOf({ ...folders, "_SOPs/_OCC Documents": "SharePoint refused OnBoard's read of this library." }), location.folder_path);
    assert.equal(refused.complete, false);
    assert.equal((await recordSopFolderWalk(pool, location, refused)).disappeared, 0);
    result = await report();
    assert.equal(result.walk.status, "forbidden");
    assert.equal(result.documents.some((document) => document.name === "New.pdf"), true, "a document an incomplete walk did not reach is not gone");

    // A complete walk without it does mark it gone, and the report drops it.
    const without = await walkLocation(libraryOf({ ...folders, "_SOPs/_OCC Documents": [] }), location.folder_path);
    assert.equal((await recordSopFolderWalk(pool, location, without)).disappeared, 1);
    result = await report();
    assert.equal(result.walk.status, "ok");
    assert.deepEqual(result.documents.map((document) => document.name).sort(), ["Other drive.pdf", "Retired only.pdf"]);

    // A walk more than a day and a bit old is reported as overdue.
    assert.equal((await report(new Date(Date.now() + 27 * 3600_000))).walk.overdue, true);

    // Pointing the setting at another folder retires the old location; the new
    // one has not been walked, and the old folder's record is not passed off as it.
    const moved = await ensureSopLocation(pool, site, drive, "_SOPs/_OCC Documents");
    assert.notEqual(moved.location_id, location.location_id);
    const active = await pool.request().input("site_id", sql.NVarChar, site)
      .query<{ folder_path: string; is_active: boolean }>("SELECT folder_path,is_active FROM DecisionMatrixDocumentLocations WHERE site_id=@site_id ORDER BY folder_path");
    assert.deepEqual(active.recordset.map((row) => [row.folder_path, row.is_active]), [["_SOPs", false], ["_SOPs/_OCC Documents", true]]);
    assert.equal((await unreferencedSopReport(pool, library, { configured: true, folder_path: "_SOPs/_OCC Documents" }, null)).walk.status, "not_walked");
  } finally {
    for (const procedureId of procedures) {
      await pool.request().input("procedure_id", sql.NVarChar, procedureId).query("DELETE FROM Procedures WHERE procedure_id=@procedure_id").catch(() => undefined);
    }
    await pool.request().input("site_id", sql.NVarChar, site).query("DELETE FROM DecisionMatrixDocumentLocations WHERE site_id=@site_id").catch(() => undefined);
    await pool.close();
  }
});
