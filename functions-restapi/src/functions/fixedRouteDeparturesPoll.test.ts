import assert from "node:assert/strict";
import test from "node:test";
import { pulloutHealthOutcome } from "./fixedRouteDeparturesPoll";

test("counts what was stored, not what the feed returned", () => {
  // The ledger's entity count backs the KPI trust state, so it has to describe
  // the table's contents. Reporting the fetched count let a run that stored
  // only a fraction of its reports still claim full volume.
  const outcome = pulloutHealthOutcome(400, 397);
  assert.deepEqual(outcome, { kind: "health", entityCount: 397, unstoredCount: 3 });
});

test("a partial loss is still a successful run", () => {
  // One malformed report must not discard an otherwise good poll - the loss is
  // reflected in the count and warned about, not escalated to a feed failure.
  assert.equal(pulloutHealthOutcome(400, 1).kind, "health");
});

test("storing nothing from a non-empty fetch is a failure, not an empty success", () => {
  // recordFeedHealth clears last_failure_reason and advances last_success_at.
  // Taking that path here is how a total ingestion loss stays invisible.
  const outcome = pulloutHealthOutcome(400, 0);
  assert.equal(outcome.kind, "failure");
  assert.match(
    outcome.kind === "failure" ? outcome.reason : "",
    /Fetched 400 pullout reports but stored none/,
  );
});

test("an empty fetch stays a healthy empty run", () => {
  // Service runs 08:00-22:00, so overnight polls legitimately return nothing.
  // Per ADR 0027 that is Current-but-empty, not a fault - and entity_count 0 is
  // what the trust contract reads to say so.
  assert.deepEqual(pulloutHealthOutcome(0, 0), { kind: "health", entityCount: 0, unstoredCount: 0 });
});
