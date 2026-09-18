import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { HttpRequest, type InvocationContext } from "@azure/functions";
import type { LibraryListing } from "../lib/sharepointLibrary";
import { approvedLibraryItems, browseDecisionMatrixLibrary, libraryConfig, browsingCredential, setDecisionMatrixLibraryForTests } from "./decisionMatrixLibrary";
import { useAccessExecutorForTests } from "../lib/access";
import { fakeAccessDb } from "../lib/access/testSupport";

// Since the cutover an app role in a token grants nobody anything, so a case
// states what its caller holds as a Role Grant, the way production reads it.
function holding(...roleKeys: string[]) {
  useAccessExecutorForTests(fakeAccessDb(roleKeys.map((roleKey) => ({ objectId: "*", roleKey }))));
}

afterEach(() => useAccessExecutorForTests(null));

const context = { error: () => undefined } as unknown as InvocationContext;

function adminRequest(path?: string): HttpRequest {
  const principal = Buffer.from(JSON.stringify({
    claims: [
      { typ: "http://schemas.microsoft.com/identity/claims/objectidentifier", val: "admin-oid" },
    ],
  })).toString("base64");
  const suffix = path === undefined ? "" : `?path=${encodeURIComponent(path)}`;
  return new HttpRequest({ method: "GET", url: `https://example.test/api/manage/decision-matrix/library${suffix}`, headers: { "x-ms-client-principal": principal } });
}

async function withSettings(values: Record<string, string | undefined>, run: () => Promise<void>) {
  const original: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    original[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { await run(); } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const CONFIGURED = { DECISION_MATRIX_LIBRARY_SITE_ID: "site,aaa,bbb", DECISION_MATRIX_LIBRARY_DRIVE_ID: "drive-1" };

function libraryReturning(listing: LibraryListing) {
  const asked: Array<string | null | undefined> = [];
  setDecisionMatrixLibraryForTests({ listFolder: async (path) => { asked.push(path); return listing; } });
  return asked;
}

test("browsing the approved library requires an Admin", async () => {
  holding("publisher");
  const principal = Buffer.from(JSON.stringify({ userId: "publisher-oid" })).toString("base64");
  const request = new HttpRequest({ method: "GET", url: "https://example.test/api/manage/decision-matrix/library", headers: { "x-ms-client-principal": principal } });
  const response = await browseDecisionMatrixLibrary(request, context);
  assert.equal(response.status, 403);
  // Names the role the caller really holds, so the refusal cannot pass by the
  // caller holding nothing at all.
  assert.match((response.jsonBody as { error: string }).error, /Your roles are: Publisher\./);
});

test("an environment with no approved library says which settings name it", async () => {
  holding("system-administrator");
  await withSettings({ DECISION_MATRIX_LIBRARY_SITE_ID: undefined, DECISION_MATRIX_LIBRARY_DRIVE_ID: undefined }, async () => {
    const response = await browseDecisionMatrixLibrary(adminRequest(), context);
    assert.equal(response.status, 200);
    const body = response.jsonBody as { entries: unknown[]; diagnostics: { configured: boolean; outcome: string; reason: string } };
    assert.deepEqual(body.entries, []);
    assert.equal(body.diagnostics.configured, false);
    assert.equal(body.diagnostics.outcome, "not_configured");
    assert.match(body.diagnostics.reason, /DECISION_MATRIX_LIBRARY_SITE_ID/);
  });
  setDecisionMatrixLibraryForTests(null);
});

test("a listing is returned with the counts the picker shows", async () => {
  holding("system-administrator");
  await withSettings(CONFIGURED, async () => {
    libraryReturning({
      outcome: "ok",
      path: "_SOPs",
      entries: [
        { item_id: "1", name: "_OCC Documents", kind: "folder", path: "_SOPs/_OCC Documents", mime_type: null, size_bytes: null, etag: null, last_modified_at: null, child_count: 13, web_url: null },
        { item_id: "2", name: "SOP.pdf", kind: "file", path: "_SOPs/SOP.pdf", mime_type: "application/pdf", size_bytes: 10, etag: "e", last_modified_at: null, child_count: null, web_url: null },
      ],
    });
    const response = await browseDecisionMatrixLibrary(adminRequest("_SOPs"), context);
    const body = response.jsonBody as { entries: unknown[]; diagnostics: { outcome: string; path: string; folder_count: number; file_count: number } };
    assert.equal(body.entries.length, 2);
    assert.equal(body.diagnostics.outcome, "ok");
    assert.equal(body.diagnostics.path, "_SOPs");
    assert.equal(body.diagnostics.folder_count, 1);
    assert.equal(body.diagnostics.file_count, 1);
    // A chosen document no longer carries the library it came from; the
    // server fills that in when the Draft is saved.
    assert.equal("site_id" in body.diagnostics, false);
    assert.equal("drive_id" in body.diagnostics, false);
  });
  setDecisionMatrixLibraryForTests(null);
});

// A library that cannot be read is a known answer to a well-formed question.
// Answering 500 would be the console's cue to report an outage, which is the
// mistake the Decision Matrix has already made twice.
test("a library that is not readable answers 200 and names which kind of not readable", async () => {
  holding("system-administrator");
  for (const [outcome, fragment] of [["forbidden", /must grant the OnBoard application read access/], ["not_found", /no folder/], ["failed", /could not be read/]] as const) {
    await withSettings(CONFIGURED, async () => {
      libraryReturning({ outcome, path: "_SOPs", reason: outcome === "forbidden" ? "SharePoint refused OnBoard's read of this library. A SharePoint administrator must grant the OnBoard application read access on this site." : outcome === "not_found" ? "SharePoint has no folder at that path." : "SharePoint could not be read: boom" } as LibraryListing);
      const response = await browseDecisionMatrixLibrary(adminRequest("_SOPs"), context);
      assert.equal(response.status, 200, `${outcome} must not be a 5xx`);
      const body = response.jsonBody as { entries: unknown[]; diagnostics: { configured: boolean; outcome: string; reason: string } };
      assert.deepEqual(body.entries, []);
      assert.equal(body.diagnostics.configured, true);
      assert.equal(body.diagnostics.outcome, outcome);
      assert.match(body.diagnostics.reason, fragment);
    });
  }
  setDecisionMatrixLibraryForTests(null);
});

test("the requested path reaches the library unchanged, so the library owns validation", async () => {
  holding("system-administrator");
  await withSettings(CONFIGURED, async () => {
    const asked = libraryReturning({ outcome: "ok", path: "_SOPs/_OCC Documents", entries: [] });
    await browseDecisionMatrixLibrary(adminRequest("_SOPs/_OCC Documents"), context);
    assert.deepEqual(asked, ["_SOPs/_OCC Documents"]);
  });
  setDecisionMatrixLibraryForTests(null);
});

test("the site and drive are configuration, so a path cannot redirect the read", async () => {
  await withSettings(CONFIGURED, async () => {
    assert.deepEqual(libraryConfig(), { site_id: "site,aaa,bbb", drive_id: "drive-1" });
  });
});

// Browsing is pinned to the sign-in application. The dedicated documents
// application is the integrity monitor, and letting its settings silently
// take over browsing would hand it the alternate user-access path ADR 0025
// rules out - so its presence must change nothing here.
test("browsing reads as the sign-in application even when the documents application is configured", async () => {
  await withSettings({
    AZURE_TENANT_ID: "tenant",
    DECISION_MATRIX_HEALTH_CLIENT_ID: "documents-app", DECISION_MATRIX_HEALTH_CLIENT_SECRET: "documents-secret",
    ONBOARD_API_CLIENT_ID: "sign-in-app", ONBOARD_API_CLIENT_SECRET: "sign-in-secret",
  }, async () => {
    assert.equal(browsingCredential()?.clientId, "sign-in-app");
  });
  await withSettings({
    AZURE_TENANT_ID: "tenant",
    DECISION_MATRIX_HEALTH_CLIENT_ID: "documents-app", DECISION_MATRIX_HEALTH_CLIENT_SECRET: "documents-secret",
    ONBOARD_API_CLIENT_ID: undefined, ONBOARD_API_CLIENT_SECRET: undefined,
  }, async () => {
    assert.equal(browsingCredential(), null, "the documents application must not stand in for browsing");
  });
});

test("reading a chosen document with no library or no credential says which settings are missing, instead of failing", async () => {
  await withSettings({ DECISION_MATRIX_LIBRARY_SITE_ID: undefined, DECISION_MATRIX_LIBRARY_DRIVE_ID: undefined }, async () => {
    const read = await approvedLibraryItems().readItem("item-1");
    assert.ok(read.outcome === "not_configured");
    assert.match(read.reason, /DECISION_MATRIX_LIBRARY_SITE_ID/);
  });
  await withSettings({ ...CONFIGURED, AZURE_TENANT_ID: undefined, ONBOARD_API_CLIENT_ID: undefined, ONBOARD_API_CLIENT_SECRET: undefined }, async () => {
    const read = await approvedLibraryItems().readItem("item-1");
    assert.ok(read.outcome === "not_configured");
    assert.match(read.reason, /ONBOARD_API_CLIENT_ID/);
  });
});
