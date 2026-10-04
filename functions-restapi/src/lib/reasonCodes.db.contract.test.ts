import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parseConnectionString, sql } from "./db";
import {
  createReasonCode,
  listReasonCodes,
  reasonCodesReady,
  updateReasonCode,
  DuplicateReasonCode,
  type ReasonCodeScope,
} from "./reasonCodes";

// The reason-code module against a real SQL Server.
//
// The claim this module makes is that two tables answer the same three
// questions, so most of what follows runs the SAME assertions against BOTH
// scopes. That is the thing no amount of reading the code proves, and the
// reason a contract test is worth more here than unit tests over a fake.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;
const DATABASE = "mvta_reason_codes_contract";
const MIGRATIONS = ["018-otp-exclusions-and-settings", "025-detour-reporting-fields"];
const ACTOR = "reason-codes-contract";

// Only the OTP table has a sub-kind; a create for the detour scope must not
// send one. Everything else about the two is the same.
const SCOPES: { scope: ReasonCodeScope; appliesTo?: "stop" }[] = [
  { scope: "otp", appliesTo: "stop" },
  { scope: "detour" },
];

function batches(text: string): string[] {
  return text.split(/^\s*GO\s*$/im).map((b) => b.trim()).filter(Boolean);
}

async function ownDatabase(cs: string): Promise<sql.ConnectionPool> {
  const admin = await new sql.ConnectionPool(parseConnectionString(cs)).connect();
  try {
    await admin.request().batch(`IF DB_ID('${DATABASE}') IS NOT NULL BEGIN ALTER DATABASE [${DATABASE}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${DATABASE}]; END; CREATE DATABASE [${DATABASE}];`);
  } finally { await admin.close(); }
  return new sql.ConnectionPool({ ...parseConnectionString(cs), database: DATABASE }).connect();
}

async function dropDatabase(cs: string) {
  const admin = await new sql.ConnectionPool(parseConnectionString(cs)).connect();
  try { await admin.request().batch(`IF DB_ID('${DATABASE}') IS NOT NULL BEGIN ALTER DATABASE [${DATABASE}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${DATABASE}]; END;`); }
  finally { await admin.close(); }
}

test("reason codes against real SQL", { skip: !connectionString && "DECISION_MATRIX_TEST_SQL_CONNECTION_STRING not set" }, async (t) => {
  const pool = await ownDatabase(connectionString!);
  try {
    for (const m of MIGRATIONS) {
      for (const b of batches(readFileSync(join(process.cwd(), "sql", `migration-${m}.sql`), "utf8"))) {
        await pool.request().batch(b);
      }
    }

    for (const { scope, appliesTo } of SCOPES) {
      await t.test(`${scope}: a code is added, listed and edited`, async () => {
        const created = await createReasonCode(
          pool, scope,
          { code: "CONTRACT_A", label: "Contract A", applies_to: appliesTo, sort_order: 5 },
          ACTOR,
        );
        assert.equal(created.code, "CONTRACT_A");
        assert.equal(created.label, "Contract A");
        assert.equal(created.sort_order, 5, "sort_order is honoured on create for both scopes");
        assert.equal(created.is_active, true);
        assert.equal(created.updated_by, ACTOR);
        // Only the OTP table carries a sub-kind, and it comes back on its rows.
        assert.equal(created.applies_to, appliesTo);

        const listed = await listReasonCodes(pool, scope);
        assert.ok(listed.some((r) => r.id === created.id));

        const edited = await updateReasonCode(pool, scope, created.id, { label: "Contract A edited", sort_order: 9 }, ACTOR);
        assert.equal(edited?.label, "Contract A edited");
        assert.equal(edited?.sort_order, 9);
        assert.equal(edited?.code, "CONTRACT_A", "code is not editable");
      });

      await t.test(`${scope}: a duplicate code is refused as a user error`, async () => {
        await assert.rejects(
          () => createReasonCode(pool, scope, { code: "CONTRACT_A", label: "Again", applies_to: appliesTo }, ACTOR),
          DuplicateReasonCode,
        );
      });

      await t.test(`${scope}: retiring a code hides it from the active list only`, async () => {
        const all = await listReasonCodes(pool, scope);
        const target = all.find((r) => r.code === "CONTRACT_A")!;
        await updateReasonCode(pool, scope, target.id, { is_active: false }, ACTOR);

        const active = await listReasonCodes(pool, scope, { activeOnly: true });
        assert.equal(active.some((r) => r.id === target.id), false);
        // Still there, so a historical record citing the code still resolves.
        const everything = await listReasonCodes(pool, scope);
        assert.ok(everything.some((r) => r.id === target.id));
      });

      await t.test(`${scope}: editing an id that does not exist is not found`, async () => {
        const missing = await updateReasonCode(
          pool, scope, "00000000-0000-4000-8000-000000000000", { label: "nobody" }, ACTOR,
        );
        assert.equal(missing, undefined);
      });

      await t.test(`${scope}: the table is reported ready`, async () => {
        assert.equal(await reasonCodesReady(pool, scope), true);
      });
    }

    await t.test("only the OTP scope filters by sub-kind", async () => {
      await createReasonCode(pool, "otp", { code: "CONTRACT_D", label: "A date one", applies_to: "date" }, ACTOR);
      const dates = await listReasonCodes(pool, "otp", { appliesTo: "date" });
      assert.deepEqual(dates.map((r) => r.code), ["CONTRACT_D"]);
      const stops = await listReasonCodes(pool, "otp", { appliesTo: "stop" });
      assert.equal(stops.some((r) => r.code === "CONTRACT_D"), false);

      // The same filter against the detour scope is ignored rather than
      // producing an error or an empty list - that table has no sub-kind.
      const detours = await listReasonCodes(pool, "detour", { appliesTo: "date" });
      assert.ok(detours.length > 0);
    });

    await t.test("the same code may exist under two sub-kinds, but not twice under one", async () => {
      // UX_OtpReasonCodes_Code_AppliesTo keys on both columns.
      await createReasonCode(pool, "otp", { code: "SHARED", label: "As a stop", applies_to: "stop" }, ACTOR);
      await createReasonCode(pool, "otp", { code: "SHARED", label: "As a date", applies_to: "date" }, ACTOR);
      await assert.rejects(
        () => createReasonCode(pool, "otp", { code: "SHARED", label: "Again", applies_to: "stop" }, ACTOR),
        DuplicateReasonCode,
      );
    });

    await t.test("a table that has not been migrated yet lists empty rather than failing", async () => {
      await pool.request().batch("DROP TABLE dbo.DetourReasonCodes;");
      assert.equal(await reasonCodesReady(pool, "detour"), false);
      assert.deepEqual(await listReasonCodes(pool, "detour"), []);
    });
  } finally {
    await pool.close();
    await dropDatabase(connectionString!);
  }
});
