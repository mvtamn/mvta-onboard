import assert from "node:assert/strict";
import test from "node:test";
import { HttpRequest, type InvocationContext } from "@azure/functions";
import { listUnreferencedSops, walkSopFolder } from "./decisionMatrixUnreferencedSops";

const context = { error: () => undefined, log: () => undefined, warn: () => undefined } as unknown as InvocationContext;

test("the Unreferenced SOP report is for Admins", async () => {
  const principal = Buffer.from(JSON.stringify({ claims: [{ typ: "roles", val: "OCC.Publisher" }] })).toString("base64");
  const request = new HttpRequest({ method: "GET", url: "https://example.test/api/manage/decision-matrix/library/unreferenced", headers: { "x-ms-client-principal": principal } });
  assert.equal((await listUnreferencedSops(request, context)).status, 403);
});

// A walk that cannot run says why and touches nothing: no database connection
// is configured in this test, so reaching for one would fail rather than skip.
test("a walk with no library, credential or SOP folder is skipped with the reason", async () => {
  assert.equal(await walkSopFolder(context, { reason: "No credential is configured for browsing SharePoint." }), "skipped: No credential is configured for browsing SharePoint.");
  const unconfigured = await walkSopFolder(context, {
    config: { site_id: "s", drive_id: "d" },
    listFolder: async () => { throw new Error("SharePoint was asked"); },
    setting: { configured: false, reason: "No SOP folder is configured." },
  });
  assert.equal(unconfigured, "skipped: No SOP folder is configured.");
});
