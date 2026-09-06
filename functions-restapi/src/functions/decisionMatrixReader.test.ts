import assert from "node:assert/strict";
import test from "node:test";
import { HttpRequest, type InvocationContext } from "@azure/functions";
import * as db from "../lib/db";
import { isInlineImageMime, listDecisionMatrix } from "./decisionMatrix";

const context = { error: () => undefined } as unknown as InvocationContext;

function readerRequest(): HttpRequest {
  const principal = Buffer.from(JSON.stringify({ claims: [{ typ: "roles", val: "OCC.Viewer" }] })).toString("base64");
  return new HttpRequest({ method: "GET", url: "https://example.test/api/decision-matrix", headers: { "x-ms-client-principal": principal } });
}

// The readiness probe asks sys.tables for the names it bound, so the fake
// counts the @tN parameters it was given and reports them all present or all
// absent - the two states the reader distinguishes.
async function withPool(tablesPresent: boolean, run: () => Promise<void>) {
  const originalGetPool = db.getPool;
  Object.defineProperty(db, "getPool", { configurable: true, value: async () => ({
    request: () => {
      const asked: string[] = [];
      return {
        input(name: string, _type: unknown, value: unknown) { if (/^t\d+$/.test(name)) asked.push(String(value)); return this; },
        async query(statement: string) {
          if (statement.includes("sys.tables")) return { recordset: [{ present: tablesPresent ? asked.length : 0 }] };
          return { recordset: [] };
        },
      };
    },
  }) });
  try { await run(); } finally { Object.defineProperty(db, "getPool", { configurable: true, value: originalGetPool }); }
}

test("the approved Procedure reader requires a staff role", async () => {
  const request = new HttpRequest({ method: "GET", url: "https://example.test/api/decision-matrix" });
  const response = await listDecisionMatrix(request, context);
  assert.equal(response.status, 401);
});

test("Event AVL alone cannot read the Decision Matrix", async () => {
  const principal = Buffer.from(JSON.stringify({ claims: [{ typ: "roles", val: "OCC.EventAVL" }] })).toString("base64");
  const request = new HttpRequest({ method: "GET", url: "https://example.test/api/decision-matrix", headers: { "x-ms-client-principal": principal } });
  const response = await listDecisionMatrix(request, context);
  assert.equal(response.status, 403);
});

test("a database without the Procedure tables reads as not connected, not as a failure", async () => {
  await withPool(false, async () => {
    const response = await listDecisionMatrix(readerRequest(), context);
    assert.equal(response.status, 200);
    assert.deepEqual(response.jsonBody, { procedures: [], diagnostics: { table_ready: false, procedure_count: 0 } });
  });
});

test("a migrated database with nothing approved reports it is connected and empty", async () => {
  await withPool(true, async () => {
    const response = await listDecisionMatrix(readerRequest(), context);
    assert.equal(response.status, 200);
    assert.deepEqual(response.jsonBody, { procedures: [], diagnostics: { table_ready: true, procedure_count: 0 } });
  });
});

test("only PNG and JPEG renditions are eligible for same-origin inline preview", () => {
  assert.equal(isInlineImageMime("image/png"), true);
  assert.equal(isInlineImageMime("image/jpeg"), true);
  assert.equal(isInlineImageMime("application/pdf"), false);
  assert.equal(isInlineImageMime("text/html"), false);
});
