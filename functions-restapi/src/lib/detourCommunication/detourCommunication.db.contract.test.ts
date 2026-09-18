import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseConnectionString, sql } from "../db";
import { readDetourWorkflows } from "../detourWorkflow";
import { fakeDeliveryPort } from "./delivery";
import { classifyCommunication, communicationStateSql } from "./state";
import { recordSentElsewhere, sendCommunication } from "./index";

// Detour communication eligibility against a real SQL Server.
// eligibility.test.ts covers the rule; this file covers what only the database
// can show:
//
//   publish enforces eligibility on BOTH paths - the server sending it, and a
//   person recording that they sent it - so a closed Detour, or one whose
//   reviewed facts are awaiting re-review, cannot be communicated;
//   a send that the provider refuses leaves the communication a draft to retry
//   and tells nobody it was published;
//   the state fragment and its TypeScript twin agree row for row, including on
//   the rows the dispatch app writes delivery facts for;
//   a queued or failed send is not counted as an audience that has been told.
//
// The Detour tables are built from their real migrations, as
// detourWorkflow.db.contract.test.ts does; see subscriberResend's note on why
// the contract job runs one file at a time.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;

const DROP = `
IF OBJECT_ID('dbo.DetourCommunicationReceipts','U') IS NOT NULL DROP TABLE dbo.DetourCommunicationReceipts;
IF OBJECT_ID('dbo.DetourCommunications','U') IS NOT NULL DROP TABLE dbo.DetourCommunications;
IF OBJECT_ID('dbo.DetourHistoricalImports','U') IS NOT NULL DROP TABLE dbo.DetourHistoricalImports;
IF OBJECT_ID('dbo.DetourIntakeSegments','U') IS NOT NULL DROP TABLE dbo.DetourIntakeSegments;
IF OBJECT_ID('dbo.DetourIntake','U') IS NOT NULL DROP TABLE dbo.DetourIntake;
IF OBJECT_ID('dbo.DetourWorkflowHistory','U') IS NOT NULL DROP TABLE dbo.DetourWorkflowHistory;
IF OBJECT_ID('dbo.DetourImages','U') IS NOT NULL DROP TABLE dbo.DetourImages;
IF OBJECT_ID('dbo.DetourSegments','U') IS NOT NULL DROP TABLE dbo.DetourSegments;
IF OBJECT_ID('dbo.DetourNumberSequences','U') IS NOT NULL DROP TABLE dbo.DetourNumberSequences;
IF OBJECT_ID('dbo.Detours','U') IS NOT NULL DROP TABLE dbo.Detours;
IF OBJECT_ID('dbo.GtfsStopRoutes','U') IS NOT NULL DROP TABLE dbo.GtfsStopRoutes;
IF OBJECT_ID('dbo.GtfsStops','U') IS NOT NULL DROP TABLE dbo.GtfsStops;
CREATE TABLE dbo.GtfsStops (stop_id NVARCHAR(50) PRIMARY KEY, stop_name NVARCHAR(200) NOT NULL, stop_lat FLOAT NULL, stop_lon FLOAT NULL);
`;

const MIGRATIONS = [
  "migration-017-detours.sql",
  "migration-024-detour-numbering.sql",
  "migration-041-detour-workflow.sql",
  "migration-049-repair-detour-orthogonal-state.sql",
  "migration-055a-detour-avail-entry-confirmation.sql",
  "migration-057-detour-same-record-acceptance.sql",
  "migration-058-detour-fulfillment-path.sql",
  "migration-059-detour-communications.sql",
  "migration-061-detour-rereview-closure.sql",
  "migration-069b-detour-intake-evidence-and-operations.sql",
  "migration-088b-detour-location.sql",
  "migration-090-detour-conflict-override.sql",
  "migration-091-detour-map-geometry.sql",
  "migration-092-detour-communication-delivery.sql",
  "migration-093-detour-communication-receipts.sql",
];

// Two migrations add a column and then name it in the same batch, which SQL
// Server compiles before the column exists. Neither file is edited, since dev
// has run both; the CHECK runs through EXEC here instead.
const FRESH_DATABASE_ADJUSTMENTS: Record<string, (text: string) => string> = {
  "migration-061-detour-rereview-closure.sql": (text) => text.replace(
    "ALTER TABLE dbo.Detours ADD CONSTRAINT CK_Detours_ReviewStatus CHECK (review_status IN ('current', 'needs_review'));",
    "EXEC(N'ALTER TABLE dbo.Detours ADD CONSTRAINT CK_Detours_ReviewStatus CHECK (review_status IN (''current'', ''needs_review''))');",
  ),
  "migration-092-detour-communication-delivery.sql": (text) => text.replace(
    `  ALTER TABLE DetourCommunications ADD CONSTRAINT CK_DetourCommunications_DeliveryStatus
    CHECK (delivery_status IN ('not_requested', 'queued', 'sent', 'partially_sent', 'failed', 'skipped'));`,
    `  EXEC(N'ALTER TABLE DetourCommunications ADD CONSTRAINT CK_DetourCommunications_DeliveryStatus CHECK (delivery_status IN (''not_requested'', ''queued'', ''sent'', ''partially_sent'', ''failed'', ''skipped''))');`,
  ),
};

async function reset(pool: sql.ConnectionPool) {
  await pool.request().batch(DROP);
  for (const file of MIGRATIONS) {
    if (file.startsWith("migration-069b")) await pool.request().batch("DROP TABLE dbo.DetourImages;");
    const raw = readFileSync(join(process.cwd(), "sql", file), "utf8");
    const adjusted = FRESH_DATABASE_ADJUSTMENTS[file]?.(raw) ?? raw;
    assert.ok(adjusted !== raw || !FRESH_DATABASE_ADJUSTMENTS[file], `${file} changed; revisit its fresh-database adjustment`);
    for (const batch of adjusted.split(/^\s*GO\s*$/gim).map((p) => p.trim()).filter(Boolean)) await pool.request().batch(batch);
  }
}

const CONTRACTOR = { name: "Transit Operations", recipients: ["ops@example.com"] };
const ACTOR = "occ@example.com";

async function seedDetour(pool: sql.ConnectionPool, state: string, review: "current" | "needs_review" = "current"): Promise<string> {
  const id = (await pool.request()
    .input("state", sql.NVarChar(30), state)
    .input("review", sql.NVarChar(20), review)
    .query<{ id: string }>(`
      INSERT INTO Detours (closure, start_date, end_date, source, created_by, fulfillment_mode, lifecycle_state, review_status, notification_audiences, service_impact)
      OUTPUT INSERTED.id
      VALUES ('Nicollet Ave at 5th', '2026-09-20', '2026-10-20', 'manual', 'seed', 'avail', @state, @review, 'Riders', 'fixed_route')`)).recordset[0].id;
  await pool.request().input("id", sql.UniqueIdentifier, id)
    .query("INSERT INTO DetourWorkflowHistory (detour_id, event_type, to_state, source, changed_by) VALUES (@id, 'created', 'seed', 'manual', 'seed')");
  return id;
}

async function seedCommunication(pool: sql.ConnectionPool, detourId: string, channel = "email", recipients: string | null = "riders@example.com"): Promise<string> {
  return (await pool.request()
    .input("detour_id", sql.UniqueIdentifier, detourId)
    .input("channel", sql.NVarChar(100), channel)
    .input("recipients", sql.NVarChar(2000), recipients)
    .query<{ id: string }>(`
      INSERT INTO DetourCommunications (detour_id, audience, channel, recipients, content, created_by)
      OUTPUT INSERTED.id VALUES (@detour_id, 'Riders', @channel, @recipients, 'Route 5 is on detour.', 'seed')`)).recordset[0].id;
}

async function readRow(pool: sql.ConnectionPool, id: string) {
  return (await pool.request().input("id", sql.UniqueIdentifier, id).query<{
    status: string; delivery_status: string | null; published_by: string | null; sent_subject: string | null; sent_recipients: string | null; outcome: string | null;
  }>("SELECT status, delivery_status, published_by, sent_subject, sent_recipients, outcome FROM DetourCommunications WHERE id=@id")).recordset[0];
}

async function sendFor(pool: sql.ConnectionPool, detourId: string, communicationId: string, port = fakeDeliveryPort("email", { status: "queued" } as const)) {
  const workflow = (await readDetourWorkflows(pool, [detourId])).get(detourId)!;
  return sendCommunication({
    pool, detourId, communicationId, actor: ACTOR, contractor: CONTRACTOR, workflow,
    context: { log() { /* test */ }, error() { /* test */ } } as never, port,
  });
}

test("Detour communication eligibility against SQL Server", { skip: !connectionString && "DECISION_MATRIX_TEST_SQL_CONNECTION_STRING not set" }, async (t) => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);

    await t.test("a fulfilled Detour's communication is sent, snapshotted and left queued for the dispatcher", async () => {
      const detour = await seedDetour(pool, "fulfilled");
      const communication = await seedCommunication(pool, detour);
      const port = fakeDeliveryPort("email", { status: "queued" });
      const outcome = await sendFor(pool, detour, communication, port);
      assert.ok(outcome.ok);
      assert.equal(outcome.state, "queued");
      const row = await readRow(pool, communication);
      // What went out is fixed before any attempt, and the row says queued
      // until the dispatch app reports back.
      assert.deepEqual([row.status, row.delivery_status, row.published_by, row.sent_recipients], ["published", "queued", ACTOR, "riders@example.com"]);
      assert.match(row.sent_subject ?? "", /Detour: Nicollet Ave at 5th/);
      assert.deepEqual(port.sent.map((m) => m.recipients), [["riders@example.com"]]);
    });

    await t.test("a closed Detour is refused on both paths, and nothing is written", async () => {
      const detour = await seedDetour(pool, "closed");
      const communication = await seedCommunication(pool, detour);
      const port = fakeDeliveryPort("email", { status: "queued" });
      const sent = await sendFor(pool, detour, communication, port);
      assert.ok(!sent.ok);
      assert.deepEqual([sent.status, sent.refusal.code], [409, "detour_closed"]);
      const workflow = (await readDetourWorkflows(pool, [detour])).get(detour)!;
      const recorded = await recordSentElsewhere({ pool, detourId: detour, communicationId: communication, actor: ACTOR, contractor: CONTRACTOR, workflow, outcome: "Emailed by hand" });
      assert.ok(!recorded.ok);
      assert.equal(recorded.refusal.code, "detour_closed");
      const row = await readRow(pool, communication);
      assert.deepEqual([row.status, row.delivery_status, row.published_by], ["draft", "not_requested", null]);
      assert.equal(port.sent.length, 0, "nothing reached the transport");
    });

    await t.test("an outstanding re-review and an unfulfilled Detour are refused", async () => {
      const outstanding = await seedDetour(pool, "fulfilled", "needs_review");
      assert.equal((await sendFor(pool, outstanding, await seedCommunication(pool, outstanding))).ok, false);
      const pending = await seedDetour(pool, "awaiting_fulfillment");
      const refused = await sendFor(pool, pending, await seedCommunication(pool, pending));
      assert.ok(!refused.ok);
      assert.equal(refused.refusal.code, "fulfillment_pending");
    });

    await t.test("a send the provider refuses leaves a draft to retry, and claims nothing", async () => {
      const detour = await seedDetour(pool, "fulfilled");
      const communication = await seedCommunication(pool, detour);
      const outcome = await sendFor(pool, detour, communication, fakeDeliveryPort("email", { status: "skipped", error: "Delivery service is not configured" }));
      assert.ok(outcome.ok);
      const row = await readRow(pool, communication);
      assert.deepEqual([row.status, row.delivery_status, row.published_by], ["draft", "skipped", null]);
      assert.deepEqual(classifyCommunication(row), { state: "failed", counted: false });
    });

    await t.test("the state fragment and its TypeScript twin agree on every row", async () => {
      // Including the rows the dispatch app writes delivery facts for: it
      // records what the provider said and never touches status or outcome.
      const detour = await seedDetour(pool, "fulfilled");
      for (const [status, delivery] of [["published", "sent"], ["published", "partially_sent"], ["published", "failed"], ["published", "not_requested"], ["draft", "not_requested"]] as const) {
        const id = await seedCommunication(pool, detour);
        await pool.request().input("id", sql.UniqueIdentifier, id).input("s", sql.NVarChar(20), status).input("d", sql.NVarChar(20), delivery)
          .query("UPDATE DetourCommunications SET status=@s, delivery_status=@d WHERE id=@id");
      }
      const rows = (await pool.request().input("detour", sql.UniqueIdentifier, detour).query<{ status: string; delivery_status: string | null; state: string; counted: boolean }>(
        `SELECT c.status, c.delivery_status, cst.state, cst.counted FROM DetourCommunications c ${communicationStateSql("c")} WHERE c.detour_id=@detour`)).recordset;
      assert.equal(rows.length, 5);
      for (const row of rows) {
        assert.deepEqual({ state: row.state, counted: row.counted }, classifyCommunication(row), `${row.status}/${row.delivery_status}`);
      }
      // What "told this audience" counts: sent or recorded, never queued or failed.
      const counted = (await pool.request().input("detour", sql.UniqueIdentifier, detour).query<{ n: number }>(
        `SELECT COUNT(DISTINCT c.audience) n FROM DetourCommunications c ${communicationStateSql("c")} WHERE c.detour_id=@detour AND cst.counted=1`)).recordset[0].n;
      assert.equal(counted, 1);
    });

    await t.test("a person recording that they sent it themselves is published without delivery facts", async () => {
      const detour = await seedDetour(pool, "fulfilled");
      const communication = await seedCommunication(pool, detour, "email", null);
      const workflow = (await readDetourWorkflows(pool, [detour])).get(detour)!;
      // No recipients is only a refusal for a send WE make.
      const recorded = await recordSentElsewhere({ pool, detourId: detour, communicationId: communication, actor: ACTOR, contractor: CONTRACTOR, workflow, outcome: "Emailed by hand" });
      assert.ok(recorded.ok);
      const row = await readRow(pool, communication);
      assert.deepEqual([row.status, row.delivery_status, row.outcome], ["published", "not_requested", "Emailed by hand"]);
      assert.deepEqual(classifyCommunication(row), { state: "recorded", counted: true });
    });
  } finally {
    await pool.close();
  }
});
