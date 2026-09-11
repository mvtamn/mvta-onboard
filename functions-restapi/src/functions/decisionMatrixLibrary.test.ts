import assert from "node:assert/strict";
import test from "node:test";
import { HttpRequest, type InvocationContext } from "@azure/functions";
import type { LibraryListing } from "../lib/sharepointLibrary";
import { browseDecisionMatrixLibrary, libraryConfig, documentCredential, setDecisionMatrixLibraryForTests } from "./decisionMatrixLibrary";

const context = { error: () => undefined } as unknown as InvocationContext;

function adminRequest(path?: string): HttpRequest {
  const principal = Buffer.from(JSON.stringify({
    claims: [
      { typ: "roles", val: "OCC.Admin" },
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
  const principal = Buffer.from(JSON.stringify({ claims: [{ typ: "roles", val: "OCC.Publisher" }] })).toString("base64");
  const request = new HttpRequest({ method: "GET", url: "https://example.test/api/manage/decision-matrix/library", headers: { "x-ms-client-principal": principal } });
  assert.equal((await browseDecisionMatrixLibrary(request, context)).status, 403);
});

test("an environment with no approved library says which settings name it", async () => {
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
  });
  setDecisionMatrixLibraryForTests(null);
});

// A library that cannot be read is a known answer to a well-formed question.
// Answering 500 would be the console's cue to report an outage, which is the
// mistake the Decision Matrix has already made twice.
test("a library that is not readable answers 200 and names which kind of not readable", async () => {
  for (const [outcome, fragment] of [["forbidden", /not been granted/], ["not_found", /no folder/], ["failed", /could not be read/]] as const) {
    await withSettings(CONFIGURED, async () => {
      libraryReturning({ outcome, path: "_SOPs", reason: outcome === "forbidden" ? "OnBoard has not been granted access to this SharePoint library." : outcome === "not_found" ? "SharePoint has no folder at that path." : "SharePoint could not be read: boom" } as LibraryListing);
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

// The runbook provisions a dedicated registration; dev granted Sites.Selected
// to the API app instead. Both must work, and the dedicated one must win where
// it exists.
test("the dedicated document credential is preferred, and the API app's is the fallback", async () => {
  await withSettings({
    AZURE_TENANT_ID: "tenant",
    DECISION_MATRIX_HEALTH_CLIENT_ID: "dedicated", DECISION_MATRIX_HEALTH_CLIENT_SECRET: "dedicated-secret",
    ONBOARD_API_CLIENT_ID: "api", ONBOARD_API_CLIENT_SECRET: "api-secret",
  }, async () => {
    assert.equal(documentCredential()?.clientId, "dedicated");
  });
  await withSettings({
    AZURE_TENANT_ID: "tenant",
    DECISION_MATRIX_HEALTH_CLIENT_ID: undefined, DECISION_MATRIX_HEALTH_CLIENT_SECRET: undefined,
    ONBOARD_API_CLIENT_ID: "api", ONBOARD_API_CLIENT_SECRET: "api-secret",
  }, async () => {
    assert.equal(documentCredential()?.clientId, "api");
  });
  await withSettings({
    AZURE_TENANT_ID: "tenant",
    DECISION_MATRIX_HEALTH_CLIENT_ID: undefined, DECISION_MATRIX_HEALTH_CLIENT_SECRET: undefined,
    ONBOARD_API_CLIENT_ID: undefined, ONBOARD_API_CLIENT_SECRET: undefined,
  }, async () => {
    assert.equal(documentCredential(), null);
  });
});
