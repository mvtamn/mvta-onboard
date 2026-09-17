import assert from "node:assert/strict";
import test from "node:test";
import { runFeedIngestion, runFeedsIngestion, type FeedLedger } from "./feedRun";
import type { KpiFeedName } from "./kpiTrust";

type LedgerCall =
  | { kind: "health"; feedName: KpiFeedName; entityCount: number; sourceTimestampSeconds: number | null; coverage?: unknown }
  | { kind: "failure"; feedName: KpiFeedName; reason: string };

function harness(overrides: Partial<FeedLedger> = {}) {
  const calls: LedgerCall[] = [];
  const lines: { level: string; text: string }[] = [];
  const ledger: FeedLedger = {
    recordHealth: async (feedName, entityCount, sourceTimestampSeconds, coverage) => {
      calls.push({ kind: "health", feedName, entityCount, sourceTimestampSeconds, coverage });
    },
    recordFailure: async (feedName, error) => {
      calls.push({ kind: "failure", feedName, reason: error instanceof Error ? error.message : String(error) });
    },
    ...overrides,
  };
  const at = (level: string) => (...args: unknown[]) => lines.push({ level, text: args.map(String).join(" ") });
  const log = { log: at("log"), warn: at("warn"), error: at("error") };
  return { ledger, log, calls, lines };
}

test("a stored run records what reached the table, with its source time and coverage", async () => {
  const h = harness();
  const coverage = { startAt: new Date("2026-09-16T05:00:00Z"), endAt: new Date("2026-09-16T06:00:00Z") };
  const result = await runFeedIngestion("avail_pullout", h.log, async () => ({
    kind: "stored", received: 40, stored: 40, sourceTimestampSeconds: 1_790_000_000, coverage,
  }), h.ledger);

  assert.deepEqual(result, { kind: "health", entityCount: 40, unstoredCount: 0 });
  assert.deepEqual(h.calls, [
    { kind: "health", feedName: "avail_pullout", entityCount: 40, sourceTimestampSeconds: 1_790_000_000, coverage },
  ]);
});

test("storing nothing from a non-empty delivery is recorded as a failure, never a success", async () => {
  // recordFeedHealth advances last_success_at and clears the last failure, so
  // taking that path here is how a total ingestion loss stays invisible.
  const h = harness();
  const result = await runFeedIngestion("avail_otp_daily", h.log, async () => ({
    kind: "stored", received: 12, stored: 0, noun: "OTP Daily reports",
  }), h.ledger);

  assert.equal(result.kind, "failure");
  assert.deepEqual(h.calls, [
    { kind: "failure", feedName: "avail_otp_daily", reason: "Fetched 12 OTP Daily reports but stored none." },
  ]);
});

test("a partial loss is a success at the stored count, and says so", async () => {
  const h = harness();
  const result = await runFeedIngestion("avail_pullout", h.log, async () => ({
    kind: "stored", received: 10, stored: 7, noun: "pullout reports",
  }), h.ledger);

  assert.deepEqual(result, { kind: "health", entityCount: 7, unstoredCount: 3 });
  assert.equal(h.calls[0]?.kind, "health");
  assert.ok(h.lines.some((line) => line.level === "warn" && line.text.includes("3 of 10 pullout reports were not stored")));
});

test("an empty delivery is Current-but-empty, not a fault", async () => {
  const h = harness();
  await runFeedIngestion("gtfs_trip_updates", h.log, async () => ({ kind: "stored", received: 0, stored: 0 }), h.ledger);

  assert.deepEqual(h.calls, [
    { kind: "health", feedName: "gtfs_trip_updates", entityCount: 0, sourceTimestampSeconds: null, coverage: undefined },
  ]);
});

test("a detected failure is recorded with its reason and the run returns normally", async () => {
  const h = harness();
  const result = await runFeedIngestion("gtfs_static", h.log, async () => ({
    kind: "failed", reason: "The static GTFS schedule covers no service on 20260916.",
  }), h.ledger);

  assert.deepEqual(result, { kind: "failure", reason: "The static GTFS schedule covers no service on 20260916." });
  assert.deepEqual(h.calls, [
    { kind: "failure", feedName: "gtfs_static", reason: "The static GTFS schedule covers no service on 20260916." },
  ]);
});

test("a throw anywhere in the run is recorded, then rethrown", async () => {
  // The reconciliation used to throw on a zone gap after its fetch guard, so
  // nothing reached the ledger: On-Demand would have aged to Stale with no
  // reason. Wherever the throw comes from, the ledger now hears about it.
  const h = harness();
  await assert.rejects(
    runFeedIngestion("spare_on_demand_reconciliation", h.log, async () => {
      throw new Error("No active on-demand operational zones are available");
    }, h.ledger),
    /No active on-demand operational zones/,
  );
  assert.deepEqual(h.calls, [
    { kind: "failure", feedName: "spare_on_demand_reconciliation", reason: "No active on-demand operational zones are available" },
  ]);
});

test("a skipped run leaves the ledger untouched", async () => {
  const h = harness();
  const result = await runFeedIngestion("avail_avl", h.log, async () => ({ kind: "skipped" }), h.ledger);

  assert.deepEqual(result, { kind: "skipped" });
  assert.deepEqual(h.calls, []);
});

test("a ledger that cannot be written never costs the caller its run", async () => {
  const h = harness({
    recordHealth: async () => { throw new Error("ledger unavailable"); },
    recordFailure: async () => { throw new Error("ledger unavailable"); },
  });

  const stored = await runFeedIngestion("gtfs_alerts", h.log, async () => ({ kind: "stored", received: 3, stored: 3 }), h.ledger);
  const failed = await runFeedIngestion("gtfs_alerts", h.log, async () => ({ kind: "failed", reason: "bad" }), h.ledger);

  assert.equal(stored.kind, "health");
  assert.equal(failed.kind, "failure");
  assert.ok(h.lines.some((line) => line.level === "error" && line.text.includes("Failed to record gtfs_alerts feed health")));
  assert.ok(h.lines.some((line) => line.level === "error" && line.text.includes("Failed to record gtfs_alerts feed failure")));
});

test("a ledger failure while recording a throw still rethrows the original error", async () => {
  const h = harness({ recordFailure: async () => { throw new Error("ledger unavailable"); } });
  await assert.rejects(
    runFeedIngestion("avail_detours", h.log, async () => { throw new Error("connection reset"); }, h.ledger),
    /connection reset/,
  );
});

test("a multi-feed run settles each feed on its own report", async () => {
  const h = harness();
  const results = await runFeedsIngestion(["spare_requests", "spare_slots"], h.log, async () => ({
    spare_requests: { kind: "stored", received: 5, stored: 5, sourceTimestampSeconds: 1_790_000_000 },
    spare_slots: { kind: "stored", received: 4, stored: 0, noun: "slots" },
  }), h.ledger);

  assert.equal(results.spare_requests.kind, "health");
  assert.equal(results.spare_slots.kind, "failure");
  assert.deepEqual(h.calls.map((call) => `${call.kind}:${call.feedName}`), ["health:spare_requests", "failure:spare_slots"]);
});

test("a multi-feed run that throws records the failure against every feed it covers", async () => {
  // Slots are fetched from the duties Requests names, so a Requests failure
  // takes Slots down with it; marking only one would understate the outage.
  const h = harness();
  await assert.rejects(
    runFeedsIngestion(["spare_requests", "spare_slots"], h.log, async () => { throw new Error("Spare 503"); }, h.ledger),
  );
  assert.deepEqual(h.calls.map((call) => `${call.kind}:${call.feedName}`), ["failure:spare_requests", "failure:spare_slots"]);
});
