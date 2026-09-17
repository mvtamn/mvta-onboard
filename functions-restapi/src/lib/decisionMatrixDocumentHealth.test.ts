import assert from "node:assert/strict";
import test from "node:test";
import {
  NOT_CONFIGURED_REASON,
  createGraphMetadataReader,
  createInMemoryMetadataReader,
  documentCheckCredential,
  documentHealthReader,
  refreshRevisionHealth,
} from "./decisionMatrixDocumentHealth";

const location = { site_id: "site,1,2", drive_id: "drive-1", item_id: "item-1" };

function graphAnswering(status: number, body: unknown = "") {
  const calls: Array<{ url: string; authorization: string | null }> = [];
  const fetchGraph = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), authorization: new Headers(init?.headers).get("Authorization") });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
  return { calls, fetchGraph };
}

test("the Graph adapter reads an item's version, name and type as the identity it was given", async () => {
  const { calls, fetchGraph } = graphAnswering(200, { eTag: '"{A},3"', name: "SOP.docx", file: { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } });
  const read = await createGraphMetadataReader(async () => "documents-app-token", fetchGraph).read(location);
  assert.deepEqual(read, { kind: "found", document: { version: '"{A},3"', file_name: "SOP.docx", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } });
  assert.equal(calls[0].authorization, "Bearer documents-app-token");
  assert.match(calls[0].url, /\/sites\/site%2C1%2C2\/drives\/drive-1\/items\/item-1\?\$select=eTag,name,file$/);
});

// Each refusal has a different owner, so they must reach the health module
// as different things rather than as one "unavailable".
test("the Graph adapter keeps apart a rejected credential, a missing grant, a missing file and an outage", async () => {
  const kinds = await Promise.all([401, 403, 404, 503].map(async (status) => {
    const { fetchGraph } = graphAnswering(status);
    return (await createGraphMetadataReader(async () => "t", fetchGraph).read(location)).kind;
  }));
  assert.deepEqual(kinds, ["credential_rejected", "grant_missing", "not_found", "failed"]);
});

test("a token that cannot be acquired is a failed read, not a thrown error", async () => {
  const { calls, fetchGraph } = graphAnswering(200, {});
  const read = await createGraphMetadataReader(async () => { throw new Error("AADSTS7000222: client secret expired"); }, fetchGraph).read(location);
  assert.deepEqual(read, { kind: "failed", detail: "AADSTS7000222: client secret expired" });
  assert.equal(calls.length, 0, "no request is made without a token");
});

test("the in-memory adapter answers from its documents, reads anything else as missing, and records what was asked", async () => {
  const reader = createInMemoryMetadataReader({ "item-1": { kind: "grant_missing" } });
  assert.deepEqual(await reader.read(location), { kind: "grant_missing" });
  assert.deepEqual(await reader.read({ ...location, item_id: "item-9" }), { kind: "not_found" });
  assert.deepEqual(reader.reads.map((read) => read.item_id), ["item-1", "item-9"]);
});

// Two identities writing one health record is what made approval depend on
// who clicked. There is exactly one, and nothing stands in for it.
test("documents are checked only as the dedicated documents application, with no fallback", () => {
  const dedicated = {
    AZURE_TENANT_ID: "tenant",
    DECISION_MATRIX_HEALTH_CLIENT_ID: "documents-app",
    DECISION_MATRIX_HEALTH_CLIENT_SECRET: "documents-secret",
    ONBOARD_API_CLIENT_ID: "sign-in-app",
    ONBOARD_API_CLIENT_SECRET: "sign-in-secret",
  };
  assert.equal(documentCheckCredential(dedicated)?.clientId, "documents-app");

  const signInAppOnly = { AZURE_TENANT_ID: "tenant", ONBOARD_API_CLIENT_ID: "sign-in-app", ONBOARD_API_CLIENT_SECRET: "sign-in-secret" };
  assert.equal(documentCheckCredential(signInAppOnly), null, "the sign-in application must never check documents");
  assert.equal(documentHealthReader(signInAppOnly), null);

  assert.equal(documentCheckCredential({ AZURE_TENANT_ID: "tenant", DECISION_MATRIX_HEALTH_CLIENT_ID: "documents-app" }), null, "an id without its secret is not a credential");
  assert.equal(documentCheckCredential({ DECISION_MATRIX_HEALTH_CLIENT_ID: "documents-app", DECISION_MATRIX_HEALTH_CLIENT_SECRET: "s" }), null);
});

// Per ADR 0025 a missing credential says nothing about any document. This
// runs with no database configured: if the module tried to record anything,
// the test would fail on the connection rather than pass.
test("with no reader, nothing is checked and nothing is written", async () => {
  const refresh = await refreshRevisionHealth("procedure-1", 1, "admin-oid", null);
  assert.deepEqual(refresh, { outcome: "not_configured", reason: NOT_CONFIGURED_REASON, document_references: [] });
});
