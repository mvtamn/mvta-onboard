import assert from "node:assert/strict";
import test from "node:test";
import { HttpRequest, type InvocationContext } from "@azure/functions";
import * as db from "../lib/db";
import { listDecisionMatrixAudit, listDecisionMatrixGovernanceQueue } from "./decisionMatrixAdminGovernance";
import { listDecisionMatrixMatchRules } from "./decisionMatrixMatches";
import { listDecisionMatrixLegacyCandidates } from "./decisionMatrixLegacyMigration";

const context = { error: () => undefined } as unknown as InvocationContext;

test("only Admins can inspect the Decision Matrix governance queue and audit", async () => {
  const principal = Buffer.from(JSON.stringify({ claims: [{ typ: "roles", val: "OCC.Publisher" }] })).toString("base64");
  const request = new HttpRequest({ method: "GET", url: "https://example.test/api/manage/decision-matrix/governance-queue", headers: { "x-ms-client-principal": principal } });
  assert.equal((await listDecisionMatrixGovernanceQueue(request, context)).status, 403);
  assert.equal((await listDecisionMatrixAudit(request, context)).status, 403);
});

function adminRequest(url: string): HttpRequest {
  const principal = Buffer.from(JSON.stringify({ claims: [{ typ: "roles", val: "OCC.Admin" }, { typ: "http://schemas.microsoft.com/identity/claims/objectidentifier", val: "admin-oid" }] })).toString("base64");
  return new HttpRequest({ method: "GET", url, headers: { "x-ms-client-principal": principal } });
}

// Each admin surface probes sys.tables for the names it bound. `present` is
// the set the fake database claims to hold, so one call can answer "079 ran,
// 076 did not" - the split the workspace has to describe.
async function withTables(present: string[], run: () => Promise<void>) {
  const originalGetPool = db.getPool;
  Object.defineProperty(db, "getPool", { configurable: true, value: async () => ({
    request: () => {
      const asked: string[] = [];
      return {
        input(name: string, _type: unknown, value: unknown) { if (/^t\d+$/.test(name)) asked.push(String(value)); return this; },
        async query(statement: string) {
          if (statement.includes("sys.tables")) return { recordset: [{ present: asked.filter((table) => present.includes(table)).length }] };
          return { recordset: [] };
        },
      };
    },
  }) });
  try { await run(); } finally { Object.defineProperty(db, "getPool", { configurable: true, value: originalGetPool }); }
}

const ALL_TABLES = ["Procedures", "ProcedureRevisions", "ProcedureCriteria", "ProcedureImmediateActions", "ProcedureDocumentReferences", "ProcedureAuditEvents", "ProcedureMatchRules", "DecisionMatrixProcedures", "DecisionMatrixLegacyMigrations"];

test("an unmigrated database reads as not connected on every admin surface, and each names its own migration", async () => {
  await withTables([], async () => {
    const queue = await listDecisionMatrixGovernanceQueue(adminRequest("https://example.test/api/manage/decision-matrix/governance-queue"), context);
    assert.equal(queue.status, 200);
    assert.deepEqual(queue.jsonBody, { procedures: [], diagnostics: { table_ready: false, required_migration: "076" } });

    const audit = await listDecisionMatrixAudit(adminRequest("https://example.test/api/manage/decision-matrix/audit"), context);
    assert.equal(audit.status, 200);
    assert.deepEqual(audit.jsonBody, { audit_events: [], diagnostics: { table_ready: false, required_migration: "078" } });

    const rules = await listDecisionMatrixMatchRules(adminRequest("https://example.test/api/manage/decision-matrix/match-rules"), context);
    assert.equal(rules.status, 200);
    assert.deepEqual(rules.jsonBody, { match_rules: [], diagnostics: { table_ready: false, required_migration: "080" } });

    const candidates = await listDecisionMatrixLegacyCandidates(adminRequest("https://example.test/api/manage/decision-matrix/legacy-candidates"), context);
    assert.equal(candidates.status, 200);
    assert.deepEqual(candidates.jsonBody, { candidates: [], diagnostics: { table_ready: false, required_migration: "079" } });
  });
});

test("a partly migrated database reports each surface separately rather than one verdict", async () => {
  // What the dev database looks like today: 051 and 079 have run, so the
  // legacy tables are there, and nothing from 076, 078 or 080 is.
  await withTables(["DecisionMatrixProcedures", "DecisionMatrixLegacyMigrations"], async () => {
    const candidates = await listDecisionMatrixLegacyCandidates(adminRequest("https://example.test/api/manage/decision-matrix/legacy-candidates"), context);
    assert.deepEqual(candidates.jsonBody, { candidates: [], diagnostics: { table_ready: true, required_migration: "079" } });

    const queue = await listDecisionMatrixGovernanceQueue(adminRequest("https://example.test/api/manage/decision-matrix/governance-queue"), context);
    assert.deepEqual(queue.jsonBody, { procedures: [], diagnostics: { table_ready: false, required_migration: "076" } });
  });
});

test("a fully migrated database reports every admin surface connected", async () => {
  await withTables(ALL_TABLES, async () => {
    const queue = await listDecisionMatrixGovernanceQueue(adminRequest("https://example.test/api/manage/decision-matrix/governance-queue"), context);
    assert.deepEqual(queue.jsonBody, { procedures: [], diagnostics: { table_ready: true, required_migration: "076" } });

    const audit = await listDecisionMatrixAudit(adminRequest("https://example.test/api/manage/decision-matrix/audit"), context);
    assert.deepEqual(audit.jsonBody, { audit_events: [], diagnostics: { table_ready: true, required_migration: "078" } });

    const rules = await listDecisionMatrixMatchRules(adminRequest("https://example.test/api/manage/decision-matrix/match-rules"), context);
    assert.deepEqual(rules.jsonBody, { match_rules: [], diagnostics: { table_ready: true, required_migration: "080" } });
  });
});
