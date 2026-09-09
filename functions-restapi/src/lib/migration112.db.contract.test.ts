import assert from "node:assert/strict";
import test from "node:test";
import { reviewedItemsSha256Sql } from "./assessment/reviewedItems";
import { parseConnectionString, sql } from "./db";

// Runs the reviewed-items hash expression against a real SQL Server (the CI
// contract job's container). STRING_AGG ... WITHIN GROUP and HASHBYTES are
// exactly the kind of T-SQL a unit test cannot exercise, and the expression
// is what binds a Shared Validation Draft to what finalization binds - if it
// silently returned NULL or ignored order, finalize would either always refuse
// or never notice a changed review.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;

const SCHEMA = `
IF OBJECT_ID('dbo.PeriodKpiAssessments', 'U') IS NOT NULL DROP TABLE dbo.PeriodKpiAssessments;
CREATE TABLE dbo.PeriodKpiAssessments (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  period_id UNIQUEIDENTIFIER NOT NULL, standard_id UNIQUEIDENTIFIER NOT NULL,
  reviewed_input_sha256 CHAR(64) NULL
);`;

const PERIOD = "aaaaaaaa-0000-4000-8000-000000000001";
const STANDARD_A = "bbbbbbbb-0000-4000-8000-000000000001";
const STANDARD_B = "bbbbbbbb-0000-4000-8000-000000000002";
const H1 = "1".repeat(64), H2 = "2".repeat(64);

test("the reviewed-items hash is stable across insertion order and changes with any item", { skip: !connectionString && "DECISION_MATRIX_TEST_SQL_CONNECTION_STRING not set" }, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await pool.request().batch(SCHEMA);
    const hash = async () => (await pool.request().input("period", sql.UniqueIdentifier, PERIOD).query<{ h: string | null }>(`SELECT ${reviewedItemsSha256Sql("period")} h`)).recordset[0].h;

    await pool.request().query(`INSERT dbo.PeriodKpiAssessments(period_id,standard_id,reviewed_input_sha256) VALUES('${PERIOD}','${STANDARD_B}','${H2}'),('${PERIOD}','${STANDARD_A}','${H1}')`);
    const first = await hash();
    assert.match(first ?? "", /^[0-9A-F]{64}$/, "a 64-hex SHA-256, not NULL");

    // Same rows, inserted the other way round: same hash.
    await pool.request().query(`DELETE dbo.PeriodKpiAssessments; INSERT dbo.PeriodKpiAssessments(period_id,standard_id,reviewed_input_sha256) VALUES('${PERIOD}','${STANDARD_A}','${H1}'),('${PERIOD}','${STANDARD_B}','${H2}')`);
    assert.equal(await hash(), first);

    // One review re-done after sharing: a different hash, so finalize refuses.
    await pool.request().query(`UPDATE dbo.PeriodKpiAssessments SET reviewed_input_sha256='${H2}' WHERE standard_id='${STANDARD_A}'`);
    assert.notEqual(await hash(), first);

    // An unreviewed item hashes as empty rather than collapsing the whole aggregate to NULL.
    await pool.request().query(`UPDATE dbo.PeriodKpiAssessments SET reviewed_input_sha256=NULL WHERE standard_id='${STANDARD_A}'`);
    assert.match((await hash()) ?? "", /^[0-9A-F]{64}$/);
  } finally {
    await pool.close();
  }
});
