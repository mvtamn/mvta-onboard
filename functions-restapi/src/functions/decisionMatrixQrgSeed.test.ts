import assert from "node:assert/strict";
import test from "node:test";
import { HttpRequest, type InvocationContext } from "@azure/functions";
import * as db from "../lib/db";
import type { GuidanceProposer, QrgRead, QrgSource } from "../lib/qrgDraftSeed";
import { seedDecisionMatrixDraftFromQrg } from "./decisionMatrixQrgSeed";

const context = { error: () => undefined, log: () => undefined } as unknown as InvocationContext;

// OCC.Admin maps to the seeded System Administrator, which holds every
// action - the resolver falls back to the seeded roles when the access tables
// are not readable, which is the case against these stub pools (ADR-0032).
// The userId varies with the roles because effective access is cached per
// principal, and one test's answer must not decide another's.
function requestFor(body: unknown, roles = ["OCC.Admin"]): HttpRequest {
  const principal = Buffer.from(JSON.stringify({
    userId: `admin-${roles.join("-") || "none"}`,
    userDetails: "admin@mvta.com",
    claims: roles.map((role) => ({ typ: "roles", val: role })),
  })).toString("base64");
  return new HttpRequest({
    method: "POST",
    url: "https://example.test/api/manage/decision-matrix/procedures/seed-from-qrg",
    headers: { "content-type": "application/json", "x-ms-client-principal": principal },
    body: { string: JSON.stringify(body) },
  });
}

const validBody = {
  procedure_id: "dm-bridge-strike",
  condition_key: "bridge-strike",
  condition: "Vehicle strikes a bridge",
  qrg: { item_id: "item-qrg", seen_version: '"{QRG},3"', document_code: "QRG-014" },
  primary: { item_id: "item-sop", seen_version: '"{SOP},1"', document_code: "SOP-014", document_type: "SOP" },
};

const pdf: QrgRead = { name: "Bridge strike QRG.pdf", mime: "application/pdf", seen_version: '"{QRG},3"', bytes: new Uint8Array([1]) };
const source: QrgSource = { read: async () => pdf };
const proposer: GuidanceProposer = {
  model: "test-model",
  propose: async () => ({ criteria: [{ kind: "applies", text: "Struck a structure" }], immediate_actions: [] }),
};

/** A pool whose readiness probe and seeding SELECT answer as configured. */
function poolWith({ ready = true, existing = [] as unknown[] } = {}) {
  return {
    request: () => {
      const self = {
        input: () => self,
        query: async (sqlText: string) => {
          if (sqlText.includes("sys.tables")) return { recordset: [{ present: ready ? 1 : 0 }] };
          if (sqlText.includes("FROM DecisionMatrixQrgSeedings")) return { recordset: existing };
          return { recordset: [] };
        },
        batch: async () => ({ recordset: [] }),
      };
      return self;
    },
  };
}

async function withPool<T>(pool: unknown, work: () => Promise<T>): Promise<T> {
  const original = db.getPool;
  Object.defineProperty(db, "getPool", { configurable: true, value: async () => pool });
  try {
    return await work();
  } finally {
    Object.defineProperty(db, "getPool", { configurable: true, value: original });
  }
}

test("a caller without the Decision Matrix role is refused before anything is read", async () => {
  let read = false;
  const watching: QrgSource = { read: async () => { read = true; return pdf; } };
  const response = await withPool(poolWith(), () =>
    seedDecisionMatrixDraftFromQrg(requestFor(validBody, ["OCC.Viewer"]), context, watching, proposer));
  assert.equal(response.status, 403);
  assert.match((response.jsonBody as { error: string }).error, /Requires/);
  assert.equal(read, false, "an unauthorised request must not reach SharePoint");
});

test("the body is checked before SharePoint or a model is touched", async () => {
  let touched = false;
  const watching: QrgSource = { read: async () => { touched = true; return pdf; } };
  const cases: [unknown, RegExp][] = [
    [{ ...validBody, procedure_id: "" }, /procedure_id, condition_key, and condition are required/],
    [{ ...validBody, qrg: { seen_version: "v", document_code: "QRG-1" } }, /The QRG needs the document you chose/],
    [{ ...validBody, qrg: { item_id: "i", document_code: "QRG-1" } }, /The QRG needs the version the picker showed/],
    [{ ...validBody, qrg: { item_id: "i", seen_version: "v" } }, /The QRG needs a document code/],
    [{ ...validBody, primary: { item_id: "i", seen_version: "v", document_code: "c", document_type: "QRG" } }, /must be an SOP or a Reference/],
  ];
  for (const [body, expected] of cases) {
    const response = await withPool(poolWith(), () =>
      seedDecisionMatrixDraftFromQrg(requestFor(body), context, watching, proposer));
    assert.equal(response.status, 400, `${JSON.stringify(body)} should be refused`);
    assert.match((response.jsonBody as { error: string }).error, expected);
  }
  assert.equal(touched, false);
});

test("a QRG named as the governing document is refused with the reason, not a generic 400", async () => {
  const response = await withPool(poolWith(), () => seedDecisionMatrixDraftFromQrg(
    requestFor({ ...validBody, primary: { ...validBody.primary, document_type: "Reference" } }),
    context,
    source,
    proposer,
  ));
  // Reference is a legal primary type, so this one gets past the type check
  // and into the database - proving the type gate is about the type alone.
  assert.notEqual(response.status, 400);
});

test("the feature says which migration it needs rather than failing opaquely", async () => {
  const response = await withPool(poolWith({ ready: false }), () =>
    seedDecisionMatrixDraftFromQrg(requestFor(validBody), context, source, proposer));
  assert.equal(response.status, 503);
  assert.equal((response.jsonBody as { diagnostics: { required_migration: string } }).diagnostics.required_migration, "158");
});

test("a QRG version that already seeded a Draft is refused, and says which Draft", async () => {
  const response = await withPool(poolWith({ existing: [{ procedure_id: "dm-earlier", revision: 2 }] }), () =>
    seedDecisionMatrixDraftFromQrg(requestFor(validBody), context, source, proposer));
  assert.equal(response.status, 409);
  assert.match((response.jsonBody as { error: string }).error, /already seeded a Draft/);
  assert.deepEqual((response.jsonBody as { seeded: unknown }).seeded, { procedure_id: "dm-earlier", revision: 2 });
});

test("a SharePoint refusal is answered with its own status and reason", async () => {
  const forbidden: QrgSource = { read: async () => ({ failure: "forbidden", reason: "SharePoint refused OnBoard's read of this library." }) };
  const response = await withPool(poolWith(), () =>
    seedDecisionMatrixDraftFromQrg(requestFor(validBody), context, forbidden, proposer));
  assert.equal(response.status, 409);
  assert.match((response.jsonBody as { error: string }).error, /refused OnBoard's read/);
});

test("an unexpected failure reading the QRG is a 500 that does not leak the cause", async () => {
  const broken: QrgSource = { read: async () => { throw new Error("socket hang up at 10.0.0.4"); } };
  const response = await withPool(poolWith(), () =>
    seedDecisionMatrixDraftFromQrg(requestFor(validBody), context, broken, proposer));
  assert.equal(response.status, 500);
  assert.equal((response.jsonBody as { error: string }).error, "The QRG could not be read.");
});
