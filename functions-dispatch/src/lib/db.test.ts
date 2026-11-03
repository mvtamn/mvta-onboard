import test from "node:test";
import assert from "node:assert/strict";
import { parseConnectionString } from "./db";

test("parses the SQL login and password", () => {
  const config = parseConnectionString(
    "Server=tcp:sql.example.test,1433;Database=onboard;User ID=admin;Password=secret;Encrypt=true;",
  );
  assert.equal(config.server, "sql.example.test");
  assert.equal(config.port, 1433);
  assert.equal(config.user, "admin");
  assert.equal(config.password, "secret");
  assert.equal(config.authentication, undefined);
});

test("Authentication=Active Directory Default signs in as the app's identity, with no password", () => {
  const config = parseConnectionString(
    "Server=tcp:sql.example.test,1433;Database=onboard;Authentication=Active Directory Default;Encrypt=true;",
  );
  assert.deepEqual(config.authentication, { type: "azure-active-directory-default", options: {} });
  assert.equal(config.user, undefined);
  assert.equal(config.password, undefined);
});

test("an unsupported Authentication value is refused rather than guessed", () => {
  assert.throws(
    () => parseConnectionString("Server=tcp:sql.example.test;Database=onboard;Authentication=Active Directory Password;"),
    /Active Directory Password/,
  );
});
