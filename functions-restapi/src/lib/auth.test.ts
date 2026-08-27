import assert from "node:assert/strict";
import test from "node:test";
import { HttpRequest } from "@azure/functions";
import { readFileSync } from "node:fs";
import { DETOUR_INTAKE_ROLES, getCallerPrincipal, INGESTION_ROLES, PUBLISH_ROLES, requireRole } from "./auth";

test("System.Ingestion is isolated from human publishing authority", () => {
  assert.deepEqual(PUBLISH_ROLES, ["OCC.Publisher", "OCC.Admin"]);
  assert.deepEqual(INGESTION_ROLES, ["System.Ingestion"]);
});

test("Detour Intake is restricted to administrators while reports remain separately readable", () => {
  assert.deepEqual(DETOUR_INTAKE_ROLES, ["OCC.Admin"]);
});

test("a mixed ingestion and human-role token is denied at the server boundary", () => {
  const principal = Buffer.from(JSON.stringify({
    userId: "mixed-principal",
    claims: [
      { typ: "roles", val: "System.Ingestion" },
      { typ: "roles", val: "OCC.Publisher" },
    ],
  })).toString("base64");
  const request = new HttpRequest({
    method: "POST",
    url: "https://example.test/api/messages/id/publish",
    headers: { "x-ms-client-principal": principal },
  });

  assert.deepEqual(requireRole(request, PUBLISH_ROLES), {
    authorized: false,
    status: 403,
    message: "System.Ingestion cannot be combined with a human OnBoard role.",
  });
});

test("uses the Entra object ID claim when Easy Auth omits its wrapper identity", () => {
  const principal = Buffer.from(JSON.stringify({
    claims: [
      { typ: "roles", val: "OCC.AccessAdmin" },
      { typ: "oid", val: "4e9c7b0e-3a37-4d1a-8e98-1ebcd22a91cf" },
    ],
  })).toString("base64");
  const request = new HttpRequest({
    method: "GET",
    url: "https://example.test/api/access-management/principals",
    headers: { "x-ms-client-principal": principal },
  });

  assert.equal(getCallerPrincipal(request)?.userId, "4e9c7b0e-3a37-4d1a-8e98-1ebcd22a91cf");
});

test("the database schema and migration permit reviewable message drafts", () => {
  const schema = readFileSync("sql/phase1-schema.sql", "utf8");
  const migration = readFileSync("sql/migration-053-message-draft-status.sql", "utf8");
  assert.match(schema, /CK_Messages_Status[\s\S]*'draft'/);
  assert.match(migration, /CHECK \(status IN \('draft', 'active', 'expired', 'archived', 'retracted'\)\)/);
});
