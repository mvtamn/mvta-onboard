import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { HttpRequest, type InvocationContext } from "@azure/functions";
import * as db from "../lib/db";
import { createInMemoryLibraryItems } from "../lib/sharepointLibrary";
import { cloneDecisionMatrixProcedureDraft, concurrencyToken, createDecisionMatrixProcedureDraft, getDecisionMatrixProcedureDraft, saveDecisionMatrixProcedureDraft } from "./decisionMatrixDrafts";
import { useAccessExecutorForTests } from "../lib/access";
import { fakeAccessDb } from "../lib/access/testSupport";

// Since the cutover an app role in a token grants nobody anything, so a case
// states what its caller holds as a Role Grant, the way production reads it.
function holding(...roleKeys: string[]) {
  useAccessExecutorForTests(fakeAccessDb(roleKeys.map((roleKey) => ({ objectId: "*", roleKey }))));
}

afterEach(() => useAccessExecutorForTests(null));

function requestFor(body: unknown): HttpRequest {
  const principal = Buffer.from(JSON.stringify({
    userId: "admin-1",
    userDetails: "admin@mvta.com",
  })).toString("base64");
  return new HttpRequest({
    method: "POST",
    url: "https://example.test/api/manage/decision-matrix/procedures",
    headers: { "content-type": "application/json", "x-ms-client-principal": principal },
    body: { string: JSON.stringify(body) },
  });
}

const completeDraft = {
  procedure_id: "draft-vehicle-collision",
  condition_key: "vehicle-collision",
  condition: "Vehicle collision",
  severity: "Stop service",
  severity_meaning: "Stop service until command staff confirm the response.",
  owner_team: "Operations Control Center",
  owner_contact: "occ@mvta.com",
  effective_at: "2026-08-25T00:00:00.000Z",
  next_review_at: "2027-02-25T00:00:00.000Z",
  criteria: [{ kind: "applies", text: "A vehicle collision is reported." }],
  immediate_actions: [{ kind: "required", instruction: "Notify command staff." }],
  document_references: [{
    document_type: "SOP",
    is_primary: true,
    document_code: "SOP-OCC-001",
    item_id: "item-1",
    seen_version: "3.0",
  }],
};

const library = createInMemoryLibraryItems({ site_id: "site-1", drive_id: "drive-1" }, {
  "item-1": { name: "SOP-OCC-001.docx", kind: "file", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", etag: "3.0", web_url: "https://mvtamn.sharepoint.com/sites/Operations/Shared%20Documents/SOP-OCC-001.docx" },
  "item-refused": { outcome: "forbidden", reason: "SharePoint refused OnBoard's read of this library." },
});

const context = { error: () => undefined } as unknown as InvocationContext;

test("normalizes a SQL row-version buffer to the concurrency token returned by the API", () => {
  assert.equal(concurrencyToken(Buffer.from("0000000000000fa1", "hex")), "0x0000000000000FA1");
  assert.equal(concurrencyToken("\0\0\0\0\0\0\x0F¡"), "0x0000000000000FA1");
});

test("only an Admin can create a Decision Matrix Procedure Draft", async () => {
  holding("publisher");
  const response = await createDecisionMatrixProcedureDraft(requestFor(completeDraft), context);
  assert.equal(response.status, 403);
  // Names the role the caller really holds, so the refusal cannot pass by the
  // caller holding nothing at all.
  assert.match((response.jsonBody as { error: string }).error, /Your roles are: Publisher\./);
});

test("a QRG cannot be the primary Supporting Document Reference", async () => {
  holding("system-administrator");
  const response = await createDecisionMatrixProcedureDraft(requestFor({
    ...completeDraft,
    document_references: [{ ...completeDraft.document_references[0], document_type: "QRG" }],
  }), context, library);

  assert.equal(response.status, 400);
  assert.deepEqual(response.jsonBody, { error: "Only an SOP or Reference can be primary." });
});

// A console loaded before this change still sends the site and drive it was
// handed. It gets a reason, not a reference to whatever library it named.
test("a Draft that names a SharePoint site and drive is refused before anything is written", async () => {
  holding("system-administrator");
  const originalGetPool = db.getPool;
  let connected = false;
  Object.defineProperty(db, "getPool", { configurable: true, value: async () => { connected = true; return {}; } });
  try {
    const response = await createDecisionMatrixProcedureDraft(requestFor({
      ...completeDraft,
      document_references: [{ ...completeDraft.document_references[0], site_id: "site-1", drive_id: "drive-1" }],
    }), context, library);
    assert.equal(response.status, 400);
    assert.match((response.jsonBody as { error: string }).error, /sends site_id, drive_id, which OnBoard reads from SharePoint itself/);
    assert.equal(connected, false);
  } finally {
    Object.defineProperty(db, "getPool", { configurable: true, value: originalGetPool });
  }
});

test("a document SharePoint refuses to read is answered with SharePoint's reason, and no transaction is opened", async () => {
  holding("system-administrator");
  const originalGetPool = db.getPool;
  let connected = false;
  Object.defineProperty(db, "getPool", { configurable: true, value: async () => { connected = true; return {}; } });
  try {
    const response = await createDecisionMatrixProcedureDraft(requestFor({
      ...completeDraft,
      document_references: [{ ...completeDraft.document_references[0], item_id: "item-refused" }],
    }), context, library);
    assert.deepEqual(response, { status: 409, jsonBody: { error: "SharePoint refused OnBoard's read of this library." } });
    assert.equal(connected, false);
  } finally {
    Object.defineProperty(db, "getPool", { configurable: true, value: originalGetPool });
  }
});

function failingCreate(failure: unknown) {
  return class FailingTransaction {
    async begin() { return undefined; }
    async commit() { return undefined; }
    async rollback() { return undefined; }
    request() {
      return {
        input() { return this; },
        async query(statement: string) {
          if (statement.includes("INSERT INTO Procedures(")) throw failure;
          return { recordset: [] };
        },
      };
    }
  };
}

async function createFailingWith(failure: unknown) {
  const originalGetPool = db.getPool;
  const originalTransaction = db.sql.Transaction;
  Object.defineProperty(db, "getPool", { configurable: true, value: async () => ({}) });
  Object.defineProperty(db.sql, "Transaction", { configurable: true, value: failingCreate(failure) });
  try {
    return await createDecisionMatrixProcedureDraft(requestFor(completeDraft), context, library);
  } finally {
    Object.defineProperty(db, "getPool", { configurable: true, value: originalGetPool });
    Object.defineProperty(db.sql, "Transaction", { configurable: true, value: originalTransaction });
  }
}

// Every failure used to be answered "already exists", which sent an author to
// rename a Procedure that was not a duplicate.
test("only a duplicate Procedure is reported as one; any other failure is a 500", async () => {
  holding("system-administrator");
  const duplicate = Object.assign(new Error("Violation of PRIMARY KEY constraint 'PK__Procedur__1'. Cannot insert duplicate key in object 'dbo.Procedures'. The duplicate key value is (draft-vehicle-collision)."), { number: 2627 });
  assert.deepEqual(await createFailingWith(duplicate), { status: 409, jsonBody: { error: "Procedure identity or condition key already exists." } });
  const truncated = Object.assign(new Error("String or binary data would be truncated in table 'dbo.Procedures', column 'condition'."), { number: 2628 });
  assert.deepEqual(await createFailingWith(truncated), { status: 500, jsonBody: { error: "Draft could not be created." } });
});

test("a stale Draft save is rejected before its ordered content is replaced", async () => {
  holding("system-administrator");
  let queries = 0;
  class StaleTransaction {
    async begin() { return undefined; }
    async commit() { return undefined; }
    async rollback() { return undefined; }
    request() {
      return {
        input() { return this; },
        async query() { queries++; return { recordset: [] }; },
      };
    }
  }
  const originalGetPool = db.getPool;
  const originalTransaction = db.sql.Transaction;
  Object.defineProperty(db, "getPool", { configurable: true, value: async () => ({}) });
  Object.defineProperty(db.sql, "Transaction", { configurable: true, value: StaleTransaction });
  const request = new HttpRequest({
    method: "PUT",
    url: "https://example.test/api/manage/decision-matrix/procedures/draft-vehicle-collision/revisions/1",
    params: { procedureId: "draft-vehicle-collision", revision: "1" },
    headers: { "content-type": "application/json", "x-ms-client-principal": Buffer.from(JSON.stringify({ userId: "admin-1" })).toString("base64") },
    body: { string: JSON.stringify({ ...completeDraft, concurrency_token: "0x0000000000000001" }) },
  });

  try {
    const response = await saveDecisionMatrixProcedureDraft(request, context, library);
    assert.equal(response.status, 409);
    assert.deepEqual(response.jsonBody, { error: "This Draft changed or is no longer editable. Refresh to compare the latest revision before saving again." });
    assert.equal(queries, 1);
  } finally {
    Object.defineProperty(db, "getPool", { configurable: true, value: originalGetPool });
    Object.defineProperty(db.sql, "Transaction", { configurable: true, value: originalTransaction });
  }
});

test("an Admin-created Draft returns stable ordered Criterion, Action, and Document Reference identities", async () => {
  holding("system-administrator");
  const statements: string[] = [];
  class CreateTransaction {
    async begin() { return undefined; }
    async commit() { return undefined; }
    async rollback() { return undefined; }
    request() {
      return {
        input() { return this; },
        async query(statement: string) {
          statements.push(statement);
          return statement.includes("INSERT INTO ProcedureRevisions")
            ? { recordset: [{ concurrency_token: "0x0000000000000001" }] }
            : { recordset: [] };
        },
      };
    }
  }
  const originalGetPool = db.getPool;
  const originalTransaction = db.sql.Transaction;
  Object.defineProperty(db, "getPool", { configurable: true, value: async () => ({}) });
  Object.defineProperty(db.sql, "Transaction", { configurable: true, value: CreateTransaction });
  try {
    const response = await createDecisionMatrixProcedureDraft(requestFor(completeDraft), context, library);
    const body = response.jsonBody as { criteria: Array<{ id: string; kind: string }>; immediate_actions: Array<{ id: string; kind: string }>; document_references: Array<{ id: string; document_type: string; is_primary: boolean; site_id: string; expected_file_name: string; health_status: string }> };

    assert.equal(response.status, 201);
    assert.match(body.criteria[0]?.id ?? "", /^[0-9a-f-]{36}$/i);
    assert.equal(body.criteria[0]?.kind, "applies");
    assert.match(body.immediate_actions[0]?.id ?? "", /^[0-9a-f-]{36}$/i);
    assert.equal(body.immediate_actions[0]?.kind, "required");
    assert.match(body.document_references[0]?.id ?? "", /^[0-9a-f-]{36}$/i);
    assert.deepEqual(body.document_references[0]?.document_type, "SOP");
    assert.equal(body.document_references[0]?.is_primary, true);
    assert.equal(body.document_references[0]?.site_id, "site-1", "the site is the library's, read on the server");
    assert.equal(body.document_references[0]?.expected_file_name, "SOP-OCC-001.docx");
    assert.equal(body.document_references[0]?.health_status, "Needs review");
    assert.equal(statements.some((statement) => statement.includes("ProcedureCriteria")), true);
    assert.equal(statements.some((statement) => statement.includes("ProcedureImmediateActions")), true);
    assert.equal(statements.some((statement) => statement.includes("ProcedureDocumentReferences")), true);
  } finally {
    Object.defineProperty(db, "getPool", { configurable: true, value: originalGetPool });
    Object.defineProperty(db.sql, "Transaction", { configurable: true, value: originalTransaction });
  }
});

test("an Admin can read a Draft with ordered content and independently reported document health", async () => {
  holding("system-administrator");
  const originalGetPool = db.getPool;
  Object.defineProperty(db, "getPool", { configurable: true, value: async () => ({
    request: () => ({
      input() { return this; },
      async query(statement: string) {
        if (statement.includes("JOIN ProcedureRevisions")) return { recordset: [{ procedure_id: "draft-vehicle-collision", condition_key: "vehicle-collision", condition: "Vehicle collision", revision: 1, lifecycle_state: "Draft", concurrency_token: "\0\0\0\0\0\0\0\x02" }] };
        if (statement.includes("ProcedureCriteria")) return { recordset: [{ criterion_id: "00000000-0000-0000-0000-000000000002", criterion_kind: "applies", criterion_text: "First criterion" }, { criterion_id: "00000000-0000-0000-0000-000000000001", criterion_kind: "excludes", criterion_text: "Second criterion" }] };
        if (statement.includes("ProcedureImmediateActions")) return { recordset: [{ action_id: "00000000-0000-0000-0000-000000000003", action_kind: "required", instruction: "First action" }] };
        return { recordset: [{ reference_id: "00000000-0000-0000-0000-000000000004", document_type: "SOP", is_primary: true, document_code: "SOP-OCC-001", site_id: "site-1", drive_id: "drive-1", item_id: "item-1", expected_version: "3.0", expected_file_name: "SOP-OCC-001.docx", expected_mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", web_url: "https://mvtamn.sharepoint.com/sites/Operations/Shared%20Documents/SOP-OCC-001.docx", health_status: "Needs review", checked_at: null }] };
      },
    }),
  }) });
  const request = new HttpRequest({
    method: "GET",
    url: "https://example.test/api/manage/decision-matrix/procedures/draft-vehicle-collision/revisions/1",
    params: { procedureId: "draft-vehicle-collision", revision: "1" },
    headers: { "x-ms-client-principal": Buffer.from(JSON.stringify({ userId: "admin-1" })).toString("base64") },
  });

  try {
    const response = await getDecisionMatrixProcedureDraft(request, context);
    assert.equal(response.status, 200);
    assert.deepEqual(response.jsonBody, {
      procedure_id: "draft-vehicle-collision",
      condition_key: "vehicle-collision",
      condition: "Vehicle collision",
      revision: 1,
      lifecycle_state: "Draft",
      concurrency_token: "0x0000000000000002",
      tags: [],
      criteria: [
        { id: "00000000-0000-0000-0000-000000000002", kind: "applies", text: "First criterion" },
        { id: "00000000-0000-0000-0000-000000000001", kind: "excludes", text: "Second criterion" },
      ],
      immediate_actions: [{ id: "00000000-0000-0000-0000-000000000003", kind: "required", instruction: "First action" }],
      document_references: [{ id: "00000000-0000-0000-0000-000000000004", document_type: "SOP", is_primary: true, document_code: "SOP-OCC-001", site_id: "site-1", drive_id: "drive-1", item_id: "item-1", expected_version: "3.0", expected_file_name: "SOP-OCC-001.docx", expected_mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", web_url: "https://mvtamn.sharepoint.com/sites/Operations/Shared%20Documents/SOP-OCC-001.docx", health_status: "Needs review", checked_at: null }],
    });
  } finally {
    Object.defineProperty(db, "getPool", { configurable: true, value: originalGetPool });
  }
});

test("an Admin clones a Procedure Revision before changing its document references", async () => {
  holding("system-administrator");
  const statements: string[] = [];
  class CloneTransaction {
    async begin() { return undefined; }
    async commit() { return undefined; }
    async rollback() { return undefined; }
    request() {
      return {
        input() { return this; },
        async query(statement: string) {
          statements.push(statement);
          if (statement.includes("MAX(revision)")) return { recordset: [{ revision: 2 }] };
          if (statement.includes("INSERT INTO ProcedureRevisions")) return { recordset: [{ concurrency_token: "0x0000000000000003" }] };
          return { recordset: [] };
        },
      };
    }
  }
  const originalGetPool = db.getPool;
  const originalTransaction = db.sql.Transaction;
  Object.defineProperty(db, "getPool", { configurable: true, value: async () => ({}) });
  Object.defineProperty(db.sql, "Transaction", { configurable: true, value: CloneTransaction });
  const request = new HttpRequest({
    method: "POST",
    url: "https://example.test/api/manage/decision-matrix/procedures/draft-vehicle-collision/revisions",
    params: { procedureId: "draft-vehicle-collision" },
    headers: { "content-type": "application/json", "x-ms-client-principal": Buffer.from(JSON.stringify({ userId: "admin-1" })).toString("base64") },
    body: { string: JSON.stringify({ source_revision: 1 }) },
  });

  try {
    const response = await cloneDecisionMatrixProcedureDraft(request, context);
    assert.equal(response.status, 201);
    assert.deepEqual(response.jsonBody, { procedure_id: "draft-vehicle-collision", revision: 2, lifecycle_state: "Draft", concurrency_token: "0x0000000000000003", cloned_from_revision: 1 });
    assert.equal(statements.some((statement) => statement.includes("ProcedureCriteria")), true);
    assert.equal(statements.some((statement) => statement.includes("ProcedureImmediateActions")), true);
    assert.equal(statements.some((statement) => statement.includes("ProcedureDocumentReferences")), true);
  } finally {
    Object.defineProperty(db, "getPool", { configurable: true, value: originalGetPool });
    Object.defineProperty(db.sql, "Transaction", { configurable: true, value: originalTransaction });
  }
});
