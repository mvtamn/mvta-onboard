import test from "node:test";
import assert from "node:assert/strict";
import { parseConnectionString } from "./db";

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
