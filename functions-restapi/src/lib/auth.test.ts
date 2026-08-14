import assert from "node:assert/strict";
import test from "node:test";
import { HttpRequest } from "@azure/functions";
import { readFileSync } from "node:fs";
import { INGESTION_ROLES, PUBLISH_ROLES, requireRole } from "./auth";

test("System.Ingestion is isolated from human publishing authority", () => {
  assert.deepEqual(PUBLISH_ROLES, ["OCC.Publisher", "OCC.Admin"]);
  assert.deepEqual(INGESTION_ROLES, ["System.Ingestion"]);
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

test("the database schema and migration permit reviewable message drafts", () => {
  const schema = readFileSync("sql/phase1-schema.sql", "utf8");
  const migration = readFileSync("sql/migration-053-message-draft-status.sql", "utf8");
  assert.match(schema, /CK_Messages_Status[\s\S]*'draft'/);
  assert.match(migration, /CHECK \(status IN \('draft', 'active', 'expired', 'archived', 'retracted'\)\)/);
});
