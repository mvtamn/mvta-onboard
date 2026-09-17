import assert from "node:assert/strict";
import test from "node:test";
import type { sql } from "./db";
import { sopFolderSetting, unreferencedSopReport } from "./unreferencedSops";

test("the SOP folder is a path inside the library; / is the whole library, and unset is not configured", () => {
  assert.deepEqual(sopFolderSetting({ DECISION_MATRIX_SOP_FOLDER: "_SOPs" }), { configured: true, folder_path: "_SOPs" });
  assert.deepEqual(sopFolderSetting({ DECISION_MATRIX_SOP_FOLDER: "/_SOPs/_OCC Documents/" }), { configured: true, folder_path: "_SOPs/_OCC Documents" });
  assert.deepEqual(sopFolderSetting({ DECISION_MATRIX_SOP_FOLDER: "/" }), { configured: true, folder_path: "" });
  // Walking every form and map in the library has to be chosen, not defaulted into.
  for (const unset of [{}, { DECISION_MATRIX_SOP_FOLDER: "" }, { DECISION_MATRIX_SOP_FOLDER: "   " }]) {
    const setting = sopFolderSetting(unset);
    assert.equal(setting.configured, false);
    assert.match(setting.configured ? "" : setting.reason, /No SOP folder is configured\. Set DECISION_MATRIX_SOP_FOLDER/);
  }
  const escaping = sopFolderSetting({ DECISION_MATRIX_SOP_FOLDER: "_SOPs/../secrets" });
  assert.equal(escaping.configured, false);
  assert.match(escaping.configured ? "" : escaping.reason, /not a usable folder path/);
});

// These answer before the database is asked: a pool that throws proves it.
const untouchable = new Proxy({}, { get() { throw new Error("the database was asked"); } }) as sql.ConnectionPool;

test("with no library or no SOP folder, the report says which setting is missing and asks nothing of the database", async () => {
  const noLibrary = await unreferencedSopReport(untouchable, null, { configured: true, folder_path: "_SOPs" }, "No approved SharePoint library is configured.");
  assert.deepEqual(noLibrary, { walk: { status: "not_configured", reason: "No approved SharePoint library is configured.", folder: null, walked_at: null, overdue: false }, documents: [] });
  const noFolder = await unreferencedSopReport(untouchable, { site_id: "s", drive_id: "d" }, { configured: false, reason: "No SOP folder is configured." }, null);
  assert.deepEqual(noFolder.walk, { status: "not_configured", reason: "No SOP folder is configured.", folder: null, walked_at: null, overdue: false });
});
