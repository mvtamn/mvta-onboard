import assert from "node:assert/strict";
import test from "node:test";
import { feedHealthOutcome } from "./kpiFeedHealth";

test("counts what was stored, not what the source returned", () => {
  // The ledger's entity count backs KPI trust, so it has to describe the
  // table's contents. Recording the fetched count let a run that stored only a
  // fraction of its records still claim full volume.
  assert.deepEqual(feedHealthOutcome(400, 397), {
    kind: "health",
    entityCount: 397,
    unstoredCount: 3,
  });
});

test("a partial loss is still a successful run", () => {
  // One malformed record must not discard an otherwise good run - the loss is
  // reflected in the count and left for the caller to warn about, not
  // escalated to a feed failure.
  assert.equal(feedHealthOutcome(400, 1).kind, "health");
});

test("storing nothing from a non-empty fetch is a failure, not an empty success", () => {
  // recordFeedHealth advances last_success_at and clears last_failure_reason.
  // Taking that path here is how a total ingestion loss stays invisible, and
  // how it erases the previous run's recorded failure on the way past.
  const outcome = feedHealthOutcome(400, 0);
  assert.equal(outcome.kind, "failure");
  assert.match(outcome.kind === "failure" ? outcome.reason : "", /Fetched 400 records but stored none/);
});

test("names the records in the failure reason so the ledger says which feed lost what", () => {
  const outcome = feedHealthOutcome(12, 0, "pullout reports");
  assert.match(outcome.kind === "failure" ? outcome.reason : "", /Fetched 12 pullout reports but stored none/);
});

test("an empty fetch stays a healthy empty run", () => {
  // Overnight polls legitimately return nothing. Per ADR 0027 that is
  // Current-but-empty, not a fault, and entity_count 0 is what the trust
  // contract reads to say so.
  assert.deepEqual(feedHealthOutcome(0, 0), { kind: "health", entityCount: 0, unstoredCount: 0 });
});
