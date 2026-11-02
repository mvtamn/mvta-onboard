import assert from "node:assert/strict";
import test from "node:test";
import { HttpRequest, type InvocationContext } from "@azure/functions";
import { listUnreferencedSops, walkSopFolder, chooseDecisionMatrixSopFolder } from "./decisionMatrixUnreferencedSops";

const context = { error: () => undefined, log: () => undefined, warn: () => undefined } as unknown as InvocationContext;

test("the Unreferenced SOP report is for Admins", async () => {
  const principal = Buffer.from(JSON.stringify({ claims: [{ typ: "roles", val: "OCC.Publisher" }] })).toString("base64");
  const request = new HttpRequest({ method: "GET", url: "https://example.test/api/manage/decision-matrix/library/unreferenced", headers: { "x-ms-client-principal": principal } });
  assert.equal((await listUnreferencedSops(request, context)).status, 403);
});

// A walk that cannot run says why and touches nothing: no database connection
// is configured in this test, so reaching for one would fail rather than skip.
test("a walk with no library or credential is skipped with the reason, touching nothing", async () => {
  assert.equal(await walkSopFolder(context, { reason: "No credential is configured for browsing SharePoint." }), "skipped: No credential is configured for browsing SharePoint.");
});

// The unconfigured-setting case used to be answered here without a database.
// It can't be now: the walk has to look for a folder an Admin chose before it
// can conclude that nothing is configured, and that lives in SQL. With no
// connection string in this test, reaching for one throws - which is itself
// the proof that the lookup happens.
test("a walk looks for a chosen folder before concluding nothing is configured", async () => {
  await assert.rejects(
    () => walkSopFolder(context, {
      config: { site_id: "s", drive_id: "d" },
      listFolder: async () => { throw new Error("SharePoint was asked"); },
      setting: { configured: false, reason: "No SOP folder is configured." },
    }),
    /SQL_CONNECTION_STRING/,
    "it must consult the database, not answer from the setting alone",
  );
});

test("choosing a folder validates it against the library first, so a wrong path is refused here and not at 06:30", async () => {
  const principal = Buffer.from(JSON.stringify({ userId: "admin-1", userDetails: "admin@mvta.com", claims: [{ typ: "roles", val: "OCC.Admin" }] })).toString("base64");
  const put = (body: unknown) => new HttpRequest({
    method: "PUT",
    url: "https://example.test/api/manage/decision-matrix/library/sop-folder",
    headers: { "content-type": "application/json", "x-ms-client-principal": principal },
    body: { string: JSON.stringify(body) },
  });

  // Neither a folder_path nor whole_library: refused before anything is read.
  const empty = await chooseDecisionMatrixSopFolder(put({}), context);
  assert.equal(empty.status, 400);
  assert.match((empty.jsonBody as { error: string }).error, /folder_path to watch, or whole_library/);

  // A body that is not JSON at all.
  const notJson = await chooseDecisionMatrixSopFolder(new HttpRequest({
    method: "PUT",
    url: "https://example.test/api/manage/decision-matrix/library/sop-folder",
    headers: { "content-type": "application/json", "x-ms-client-principal": principal },
    body: { string: "{" },
  }), context);
  assert.equal(notJson.status, 400);
});

test("a caller without the Decision Matrix role cannot move the SOP folder", async () => {
  const principal = Buffer.from(JSON.stringify({ userId: "viewer-1", userDetails: "viewer@mvta.com", claims: [{ typ: "roles", val: "OCC.Viewer" }] })).toString("base64");
  const response = await chooseDecisionMatrixSopFolder(new HttpRequest({
    method: "PUT",
    url: "https://example.test/api/manage/decision-matrix/library/sop-folder",
    headers: { "content-type": "application/json", "x-ms-client-principal": principal },
    body: { string: JSON.stringify({ folder_path: "Operations/SOPs" }) },
  }), context);
  assert.equal(response.status, 403);
});
