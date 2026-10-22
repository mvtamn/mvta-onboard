import test from "node:test";
import assert from "node:assert/strict";
import { isTransientConnectError, parseConnectionString } from "./db";

const base =
  "Server=tcp:sql.example.test,1433;Database=onboard;User ID=admin;Encrypt=true;TrustServerCertificate=false;";

test("parses the standard SQL connection-string fields", () => {
  const config = parseConnectionString(base.replace("Encrypt=true", "Password=secret;Encrypt=true"));
  assert.equal(config.server, "sql.example.test");
  assert.equal(config.port, 1433);
  assert.equal(config.database, "onboard");
  assert.equal(config.user, "admin");
  assert.equal(config.password, "secret");
});

test("preserves semicolons in an unquoted password", () => {
  const config = parseConnectionString(
    base.replace("Encrypt=true", "Password=part1;part2;part3;Encrypt=true"),
  );
  assert.equal(config.password, "part1;part2;part3");
});

test("unwraps quoted and braced password values", () => {
  const quoted = parseConnectionString(
    base.replace("Encrypt=true", 'Password="part1;part2";Encrypt=true'),
  );
  const braced = parseConnectionString(
    base.replace("Encrypt=true", "Password={part1;part2};Encrypt=true"),
  );
  assert.equal(quoted.password, "part1;part2");
  assert.equal(braced.password, "part1;part2");
});

test("Authentication=Active Directory Default signs in as the app's identity, with no password", () => {
  const config = parseConnectionString(
    "Server=tcp:sql.example.test,1433;Database=onboard;Authentication=Active Directory Default;Encrypt=true;",
  );
  assert.equal(config.server, "sql.example.test");
  assert.equal(config.database, "onboard");
  assert.deepEqual(config.authentication, { type: "azure-active-directory-default", options: {} });
  assert.equal(config.user, undefined);
  assert.equal(config.password, undefined);
  assert.equal(config.options?.encrypt, true);
});

test("Authentication=Sql Password keeps the login and password", () => {
  const config = parseConnectionString(
    base.replace("Encrypt=true", "Password=secret;Authentication=Sql Password;Encrypt=true"),
  );
  assert.equal(config.authentication, undefined);
  assert.equal(config.user, "admin");
  assert.equal(config.password, "secret");
});

test("an unsupported Authentication value is refused rather than guessed", () => {
  assert.throws(
    () => parseConnectionString(base + "Authentication=Active Directory Interactive;"),
    /Active Directory Interactive/,
  );
});

test("a failed Entra token fetch is retried; a rejected login is not", () => {
  // The shape mssql hands back when tedious cannot get a token: a
  // ConnectionError with no code, wrapping an AggregateError.
  const tokenFetchFailed = {
    name: "ConnectionError",
    originalError: { errors: [{ code: "EFEDAUTH" }, new Error("ManagedIdentityCredential: timed out")] },
  };
  assert.equal(isTransientConnectError(tokenFetchFailed), true);
  assert.equal(isTransientConnectError({ code: "ESOCKET" }), true);
  assert.equal(isTransientConnectError({ code: "ELOGIN" }), false);
  assert.equal(isTransientConnectError(undefined), false);
});
