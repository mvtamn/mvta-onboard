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

test("with no library at all, the report says so and asks nothing of the database", async () => {
  const noLibrary = await unreferencedSopReport(untouchable, null, { configured: true, folder_path: "_SOPs" }, "No approved SharePoint library is configured.");
  assert.deepEqual(noLibrary, { walk: { status: "not_configured", reason: "No approved SharePoint library is configured.", folder: null, walked_at: null, overdue: false }, documents: [] });
});

// This case USED to answer without the database too, back when the setting was
// the only possible source of the folder. It cannot any more: an Admin's
// chosen folder lives only in DecisionMatrixDocumentLocations, so "is one
// chosen?" is a question only the database can answer. The narrower property -
// no library means no query - is the test above.
test("with a library but nothing chosen, the report asks the database before trusting the setting", async () => {
  let asked = "";
  const pool = {
    request: () => {
      const self = {
        input: () => self,
        query: async (text: string) => {
          asked += text;
          // Every table the surface asks about is present: the probe counts
          // its own placeholders, so answering with fewer would report the
          // environment unmigrated and stop the report early.
          if (text.includes("sys.tables")) return { recordset: [{ present: (text.match(/@t\d+/g) ?? []).length }] };
          return { recordset: [] };
        },
      };
      return self;
    },
  } as unknown as sql.ConnectionPool;

  const report = await unreferencedSopReport(pool, { site_id: "s", drive_id: "d" }, { configured: false, reason: "No SOP folder is configured." }, null);
  assert.match(asked, /DecisionMatrixDocumentLocations/, "it must look for a chosen folder");
  assert.deepEqual(report.walk, { status: "not_configured", reason: "No SOP folder is configured.", folder: null, walked_at: null, overdue: false });
});
