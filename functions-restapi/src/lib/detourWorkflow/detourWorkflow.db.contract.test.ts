import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseConnectionString, sql } from "../db";
import { performDetourAct, performDetourActIn, readDetourWorkflows, type Actor } from "./index";

// The Detour workflow acts against a real SQL Server, built from the Detour
// migrations. decide.test.ts covers the decision; this file covers what only
// the database can show:
//
//   Every act writes its row change and exactly one DetourWorkflowHistory row
//   in the same transaction, and a refusal writes neither. Closing once wrote
//   no history at all.
//
//   The conflict gate reads other Detours from inside the act's transaction.
//
//   UPDLOCK + HOLDLOCK: two people acting on one Detour at once are decided
//   one after the other, so the second sees what the first committed.
//
// See subscriberResend.db.contract.test.ts on why the contract job runs one
// file at a time: this file resets the Detour tables.
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
  "migration-061-detour-rereview-closure.sql",
  "migration-069b-detour-intake-evidence-and-operations.sql",
  "migration-088b-detour-location.sql",
  "migration-090-detour-conflict-override.sql",
  "migration-091-detour-map-geometry.sql",
];


async function applyMigration(pool: sql.ConnectionPool, file: string) {
  const text = readFileSync(join(process.cwd(), "sql", file), "utf8");
  for (const batch of text.split(/^\s*GO\s*$/gim).map((p) => p.trim()).filter(Boolean)) {
    await pool.request().batch(batch);
  }
}

async function reset(pool: sql.ConnectionPool) {
  await pool.request().batch(DROP);
  for (const file of MIGRATIONS) {
    // These tests do not use DetourImages, and 069b only touches it when it is
    // there. Every migration here applies as written now that 061 and 069b
    // route their CHECKs through EXEC.
    if (file.startsWith("migration-069b")) await pool.request().batch("DROP TABLE dbo.DetourImages;");
    const migration = readFileSync(join(process.cwd(), "sql", file), "utf8");
    for (const batch of migration.split(/^\s*GO\s*$/gim).map((part) => part.trim()).filter(Boolean)) {
      await pool.request().batch(batch);
    }
  }
}

const occ: Actor = { kind: "person", name: "occ@example.com" };
const other: Actor = { kind: "person", name: "planner@example.com" };

interface Seed {
  closure: string;
  mode?: "avail" | "fixed_route_manual" | "mobility_manual";
  state?: string;
  routes?: string;
  start?: string;
  end?: string | null;
  reviewStatus?: "current" | "needs_review";
  source?: "manual" | "avail";
  fulfillmentChangeReason?: string;
}

// A Detour whose workflow has already started (one history row).
async function seed(pool: sql.ConnectionPool, s: Seed): Promise<string> {
  const id = (await pool.request()
    .input("closure", sql.NVarChar(500), s.closure)
    .input("mode", sql.NVarChar(30), s.mode ?? "avail")
    .input("state", sql.NVarChar(30), s.state ?? "awaiting_fulfillment")
    .input("start", sql.Date, s.start ?? "2026-09-20")
    .input("end", sql.Date, s.end === undefined ? "2026-10-20" : s.end)
    .input("review", sql.NVarChar(20), s.reviewStatus ?? "current")
    .input("source", sql.NVarChar(10), s.source ?? "manual")
    .input("change_reason", sql.NVarChar(1000), s.fulfillmentChangeReason ?? null)
    .query<{ id: string }>(`
      INSERT INTO Detours (closure, start_date, end_date, source, created_by, fulfillment_mode, lifecycle_state, review_status, fulfillment_change_reason)
      OUTPUT INSERTED.id
      VALUES (@closure, @start, @end, @source, 'seed', @mode, @state, @review, @change_reason)`)).recordset[0].id;
  if (s.routes) {
    await pool.request().input("id", sql.UniqueIdentifier, id).input("routes", sql.NVarChar(200), s.routes)
      .query("INSERT INTO DetourSegments (detour_id, routes, sort_order) VALUES (@id, @routes, 0)");
  }
  await pool.request().input("id", sql.UniqueIdentifier, id)
    .query("INSERT INTO DetourWorkflowHistory (detour_id, event_type, to_state, source, changed_by) VALUES (@id, 'created', 'seed', 'manual', 'seed')");
  return id;
}

interface DetourRow {
  lifecycle_state: string;
  fulfillment_mode: string;
  review_status: string;
  closure_reason: string | null;
  closed_by: string | null;
  avail_build_confirmed_at: Date | null;
  avail_entry_result: string | null;
  conflict_override_reason: string | null;
  workflow_updated_by: string | null;
}

async function row(pool: sql.ConnectionPool, id: string): Promise<DetourRow> {
  return (await pool.request().input("id", sql.UniqueIdentifier, id).query<DetourRow>(`
    SELECT lifecycle_state, fulfillment_mode, review_status, closure_reason, closed_by, avail_build_confirmed_at,
           avail_entry_result, conflict_override_reason, workflow_updated_by
    FROM Detours WHERE id = @id`)).recordset[0];
}

interface HistoryRow { event_type: string; from_state: string | null; to_state: string | null; source: string; detail: string | null; changed_by: string }

// History written after the seed row, oldest first.
async function history(pool: sql.ConnectionPool, id: string): Promise<HistoryRow[]> {
  return (await pool.request().input("id", sql.UniqueIdentifier, id).query<HistoryRow & { changed_at: Date }>(`
    SELECT event_type, from_state, to_state, source, detail, changed_by, changed_at
    FROM DetourWorkflowHistory WHERE detour_id = @id AND changed_by <> 'seed'
    ORDER BY changed_at, id`)).recordset.map(({ event_type, from_state, to_state, source, detail, changed_by }) => ({ event_type, from_state, to_state, source, detail, changed_by }));
}

const skip = { skip: !connectionString && "DECISION_MATRIX_TEST_SQL_CONNECTION_STRING not set" };

test("Detour workflow acts against SQL Server", skip, async (t) => {
  const pool = await new sql.ConnectionPool({ ...parseConnectionString(connectionString!), pool: { max: 4 } }).connect();
  try {
    await reset(pool);

    await t.test("closing writes the closure and one history row, and a second close is refused and writes nothing", async () => {
      const id = await seed(pool, { closure: "Aldrich", state: "fulfilled", mode: "fixed_route_manual" });
      const closed = await performDetourAct(pool, id, { act: "close", reason: "Work finished" }, occ);
      assert.ok(closed.ok);
      const stored = await row(pool, id);
      assert.deepEqual([stored.lifecycle_state, stored.closure_reason, stored.closed_by, stored.workflow_updated_by], ["closed", "Work finished", occ.name, occ.name]);
      assert.deepEqual(await history(pool, id), [
        { event_type: "state_transition", from_state: "fulfilled", to_state: "closed", source: "manual", detail: "Work finished", changed_by: occ.name },
      ]);

      const again = await performDetourAct(pool, id, { act: "close", reason: "Again" }, occ);
      assert.ok(!again.ok && again.refusal.code === "not_allowed_from_state");
      assert.equal((await row(pool, id)).closure_reason, "Work finished");
      assert.equal((await history(pool, id)).length, 1);
    });

    await t.test("an unknown or deleted Detour is not_found", async () => {
      const id = await seed(pool, { closure: "Bellwether", state: "fulfilled", mode: "fixed_route_manual" });
      await pool.request().input("id", sql.UniqueIdentifier, id).query("UPDATE Detours SET is_deleted = 1 WHERE id = @id");
      const outcome = await performDetourAct(pool, id, { act: "close", reason: "x" }, occ);
      assert.ok(!outcome.ok && outcome.refusal.code === "not_found");
    });

    await t.test("confirming an Avail entry waits for a conflict override that covers the current conflicts", async () => {
      const subject = await seed(pool, { closure: "Cobalt", routes: "460 SB" });
      const neighbour = await seed(pool, { closure: "Driftwood", routes: "460 NB", mode: "fixed_route_manual", state: "fulfilled" });

      const blocked = await performDetourAct(pool, subject, { act: "avail_entry", result: "entered", externalDetourId: "A-100" }, occ);
      assert.ok(!blocked.ok && blocked.refusal.code === "conflict_unresolved");
      assert.deepEqual(blocked.refusal.conflicts?.map((c) => c.id.toLowerCase()), [neighbour.toLowerCase()]);
      assert.equal((await row(pool, subject)).lifecycle_state, "awaiting_fulfillment");
      assert.equal((await history(pool, subject)).length, 0);

      // A failed attempt is still recordable while the conflict stands.
      const failed = await performDetourAct(pool, subject, { act: "avail_entry", result: "conflict" }, occ);
      assert.ok(failed.ok && failed.detour.lifecycle_state === "fulfillment_failed");

      const overridden = await performDetourAct(pool, subject, { act: "override_conflict", reason: "Same work zone, one detour" }, occ);
      assert.ok(overridden.ok);
      assert.equal((await row(pool, subject)).conflict_override_reason, "Same work zone, one detour");

      const entered = await performDetourAct(pool, subject, { act: "avail_entry", result: "entered", externalDetourId: "A-100" }, occ);
      assert.ok(entered.ok && entered.detour.lifecycle_state === "fulfilled");
      const stored = await row(pool, subject);
      assert.equal(stored.avail_entry_result, "entered");
      assert.ok(stored.avail_build_confirmed_at instanceof Date);
      assert.deepEqual((await history(pool, subject)).map((h) => [h.event_type, h.from_state, h.to_state]), [
        ["fulfillment_confirmation", "awaiting_fulfillment", "fulfillment_failed"],
        ["manual_correction", "fulfillment_failed", "fulfillment_failed"],
        ["fulfillment_confirmation", "fulfillment_failed", "fulfilled"],
      ]);

      const views = await readDetourWorkflows(pool, [subject]);
      const view = [...views.values()][0];
      assert.equal(view.next_step, "in_avail");
      assert.equal(view.conflict_status, "overridden");
      assert.equal(view.acts.close.available, true);

      // A conflict that appears after the override reopens the gate.
      const late = await seed(pool, { closure: "Evergreen", routes: "460", mode: "fixed_route_manual", state: "fulfilled" });
      assert.equal([...(await readDetourWorkflows(pool, [subject])).values()][0].conflict_status, "unresolved");
      await performDetourAct(pool, late, { act: "close", reason: "cleanup" }, occ);
      await performDetourAct(pool, neighbour, { act: "close", reason: "cleanup" }, occ);
    });

    await t.test("saving unchanged facts records the edit without raising re-review; a real change raises it and holds the Avail entry", async () => {
      const id = await seed(pool, { closure: "Foxglove", routes: "477" });
      const edit = async (proposed: Parameters<typeof performDetourActIn>[2] & { act: "record_edit" }) => {
        const tx = new sql.Transaction(pool);
        await tx.begin();
        const outcome = await performDetourActIn(tx, id, proposed, other);
        await tx.commit();
        return outcome;
      };

      const unchanged = await edit({ act: "record_edit", proposed: { closure: "Foxglove", start_date: "2026-09-20", end_date: "2026-10-20", riders_directed: "", segments: [{ routes: "477", directions: null }] } });
      assert.ok(unchanged.ok && unchanged.detour.review_status === "current");
      assert.equal((await row(pool, id)).review_status, "current");

      const changed = await edit({ act: "record_edit", proposed: { end_date: "2026-11-01" } });
      assert.ok(changed.ok && changed.detour.review_status === "needs_review");
      assert.deepEqual((await history(pool, id)).map((h) => [h.event_type, h.changed_by]), [["manual_correction", other.name], ["manual_correction", other.name]]);

      const held = await performDetourAct(pool, id, { act: "avail_entry", result: "entered", externalDetourId: "A-200" }, occ);
      assert.ok(!held.ok && held.refusal.code === "re_review_outstanding");

      const reviewed = await performDetourAct(pool, id, { act: "complete_re_review", notes: "Dates confirmed" }, occ);
      assert.ok(reviewed.ok && reviewed.detour.review_status === "current");
      const entered = await performDetourAct(pool, id, { act: "avail_entry", result: "entered", externalDetourId: "A-200" }, occ);
      assert.ok(entered.ok);
    });

    await t.test("manual fallback after an Avail conflict makes a fulfilled fixed-route manual Detour", async () => {
      const id = await seed(pool, { closure: "Gantry", state: "fulfillment_failed" });
      const outcome = await performDetourAct(pool, id, { act: "manual_fallback", reason: "Avail cannot model the stop closure" }, occ);
      assert.ok(outcome.ok);
      const stored = await row(pool, id);
      assert.deepEqual([stored.fulfillment_mode, stored.lifecycle_state], ["fixed_route_manual", "fulfilled"]);
      assert.deepEqual((await history(pool, id)).map((h) => [h.event_type, h.from_state, h.to_state, h.detail]), [
        ["manual_correction", "fulfillment_failed", "fulfilled", "Avail cannot model the stop closure"],
      ]);
    });

    await t.test("create and an Avail observation start a Detour inside the caller's transaction, once", async () => {
      const insert = async (tx: sql.Transaction, closure: string) => (await new sql.Request(tx)
        .input("closure", sql.NVarChar(500), closure)
        .query<{ id: string }>("INSERT INTO Detours (closure, source, created_by) OUTPUT INSERTED.id VALUES (@closure, 'manual', 'test')")).recordset[0].id;

      const tx = new sql.Transaction(pool);
      await tx.begin();
      const created = await insert(tx, "Hollow");
      const started = await performDetourActIn(tx, created, { act: "create", mode: "avail" }, occ);
      assert.ok(started.ok && started.detour.lifecycle_state === "awaiting_fulfillment");
      const twice = await performDetourActIn(tx, created, { act: "create", mode: "avail" }, occ);
      assert.ok(!twice.ok && twice.refusal.code === "already_started");
      const observed = await insert(tx, "Ironwood");
      const seen = await performDetourActIn(tx, observed, { act: "avail_observation", externalDetourId: "A-300", kind: "new" }, { kind: "avail_sync" });
      assert.ok(seen.ok);
      await tx.commit();

      assert.deepEqual((await history(pool, created)).map((h) => [h.event_type, h.to_state, h.source]), [["created", "awaiting_fulfillment", "manual"]]);
      const fromFeed = await row(pool, observed);
      assert.deepEqual([fromFeed.fulfillment_mode, fromFeed.lifecycle_state, fromFeed.avail_build_confirmed_at], ["avail", "fulfilled", null]);
      assert.deepEqual((await history(pool, observed)).map((h) => [h.event_type, h.source, h.changed_by, h.detail]), [
        ["source_observation", "avail", "avail-sync", "Observed Avail detour A-300"],
      ]);
    });

    await t.test("two people acting at once are decided one after the other", async () => {
      const id = await seed(pool, { closure: "Kestrel", state: "awaiting_fulfillment" });
      const outcomes = await Promise.all([
        performDetourAct(pool, id, { act: "close", reason: "First" }, occ),
        performDetourAct(pool, id, { act: "close", reason: "Second" }, other),
      ]);
      assert.equal(outcomes.filter((o) => o.ok).length, 1);
      const refused = outcomes.find((o) => !o.ok);
      assert.ok(refused && !refused.ok && refused.refusal.code === "not_allowed_from_state");
      assert.equal((await history(pool, id)).length, 1);

      // Different acts racing: whichever lands second is judged against the first.
      const raced = await seed(pool, { closure: "Larkspur", state: "awaiting_fulfillment" });
      const [entry, close] = await Promise.all([
        performDetourAct(pool, raced, { act: "avail_entry", result: "conflict" }, occ),
        performDetourAct(pool, raced, { act: "close", reason: "Cancelled" }, other),
      ]);
      const stored = await row(pool, raced);
      assert.equal(stored.lifecycle_state, entry.ok && !close.ok ? "fulfillment_failed" : "closed");
      assert.equal((await history(pool, raced)).length, [entry, close].filter((o) => o.ok).length);
    });
  } finally {
    await pool.close();
  }
});

test("migration 122 retires approved and marks Avail-feed Detours Avail-backed, once", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    const approvedAvail = await seed(pool, { closure: "Aspen", mode: "avail", state: "approved" });
    const approvedManual = await seed(pool, { closure: "Basswood", mode: "mobility_manual", state: "approved" });
    const fromFeed = await seed(pool, { closure: "Chokecherry", source: "avail", mode: "fixed_route_manual", state: "closed" });
    const fellBack = await seed(pool, { closure: "Dogwood", source: "avail", mode: "fixed_route_manual", state: "fulfilled", fulfillmentChangeReason: "Avail could not model it" });
    const untouched = await seed(pool, { closure: "Elderberry", mode: "fixed_route_manual", state: "fulfilled" });

    await applyMigration(pool, "migration-122-detour-workflow-states.sql");
    // Re-runnable: a second pass changes nothing and writes no history.
    await applyMigration(pool, "migration-122-detour-workflow-states.sql");

    assert.deepEqual([(await row(pool, approvedAvail)).lifecycle_state, (await row(pool, approvedManual)).lifecycle_state], ["awaiting_fulfillment", "fulfilled"]);
    assert.deepEqual((await history(pool, approvedAvail)).map((h) => [h.event_type, h.from_state, h.to_state, h.changed_by]), [["state_transition", "approved", "awaiting_fulfillment", "migration-122"]]);
    const feed = await row(pool, fromFeed);
    assert.deepEqual([feed.fulfillment_mode, feed.lifecycle_state, feed.avail_build_confirmed_at], ["avail", "closed", null]);
    assert.equal((await history(pool, fromFeed)).length, 1);
    assert.equal((await row(pool, fellBack)).fulfillment_mode, "fixed_route_manual");
    assert.equal((await history(pool, fellBack)).length, 0);
    assert.equal((await history(pool, untouched)).length, 0);

    await assert.rejects(
      pool.request().input("id", sql.UniqueIdentifier, untouched).query("UPDATE Detours SET lifecycle_state = 'approved' WHERE id = @id"),
      /CK_Detours_LifecycleState/,
    );
    // A formerly approved Detour takes workflow acts like any other.
    const closed = await performDetourAct(pool, approvedManual, { act: "close", reason: "Done" }, occ);
    assert.ok(closed.ok);
  } finally {
    await pool.close();
  }
});
