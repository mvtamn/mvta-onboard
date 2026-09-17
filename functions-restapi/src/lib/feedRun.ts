// The one place that decides what an ingestion run may claim on the KPI feed
// health ledger.
//
// Every poller used to write this ritual out itself: guard the fetch, record a
// failure, apply feedHealthOutcome, record a failure or a success, and wrap
// each ledger write in its own try/catch. Fourteen copies drifted. Some
// recorded a failed fetch and some only logged it; one recorded a success from
// the raw entity count when its evidence table was missing; one let a throw
// escape after its fetch guard, so the ledger stayed frozen on its last
// success with no reason - the 2026-09-03 failure mode, fixed in one poller
// and still live in another. Fixes had to be made poller by poller
// (6dcb885, bcacffe, 3bc6a4f).
//
// A poller now does its feed-specific work and returns a report of what
// happened. This module alone turns that into a ledger write:
//
// - A thrown error is a failure. It is recorded for every feed the run covers,
//   then rethrown so the invocation still fails visibly.
// - `failed` is a failure the poller detected without throwing (a missing
//   table, an expired schedule, a source that returned nothing usable). It is
//   recorded and the run returns normally.
// - `stored` goes through feedHealthOutcome: storing nothing from a non-empty
//   delivery is a failure, a partial loss is a success with a warning, and an
//   empty delivery is Current-but-empty (ADR 0027).
// - `skipped` writes nothing. It is for runs that made no attempt on the feed
//   (deliberately disabled, or a lease not yet due), where the ledger's last
//   entry is still the truth.
//
// A ledger write never throws out of here: telemetry must not take down the
// ingestion it describes, and a poller that has more work to do after its
// feed is settled must still get to do it.
import { getPool } from "./db";
import { feedHealthOutcome, recordFeedFailure, recordFeedHealth } from "./kpiFeedHealth";
import type { KpiFeedName } from "./kpiTrust";

export interface FeedCoverage {
  startAt?: Date | null;
  endAt?: Date | null;
}

export type FeedRunReport =
  | {
      kind: "stored";
      // What this run intended to write, after subtracting anything it
      // declined on purpose; see feedHealthOutcome.
      received: number;
      stored: number;
      noun?: string;
      sourceTimestampSeconds?: number | null;
      coverage?: FeedCoverage;
    }
  | { kind: "failed"; reason: string }
  | { kind: "skipped"; reason?: string };

export type FeedRunResult =
  | { kind: "health"; entityCount: number; unstoredCount: number }
  | { kind: "failure"; reason: string }
  | { kind: "skipped" };

export interface FeedLedger {
  recordHealth(feedName: KpiFeedName, entityCount: number, sourceTimestampSeconds: number | null, coverage?: FeedCoverage): Promise<void>;
  recordFailure(feedName: KpiFeedName, error: unknown): Promise<void>;
}

export interface FeedRunLog {
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export const sqlFeedLedger: FeedLedger = {
  async recordHealth(feedName, entityCount, sourceTimestampSeconds, coverage) {
    await recordFeedHealth(await getPool(), feedName, entityCount, sourceTimestampSeconds, coverage);
  },
  async recordFailure(feedName, error) {
    await recordFeedFailure(await getPool(), feedName, error);
  },
};

async function settle(
  feedName: KpiFeedName,
  report: FeedRunReport,
  log: FeedRunLog,
  ledger: FeedLedger,
): Promise<FeedRunResult> {
  if (report.kind === "skipped") {
    if (report.reason) log.log(`${feedName}: ${report.reason}`);
    return { kind: "skipped" };
  }
  if (report.kind === "failed") {
    log.error(`${feedName}: ${report.reason}`);
    await failure(feedName, new Error(report.reason), log, ledger);
    return { kind: "failure", reason: report.reason };
  }
  const outcome = feedHealthOutcome(report.received, report.stored, report.noun);
  if (outcome.kind === "failure") {
    log.error(`${feedName}: ${outcome.reason}`);
    await failure(feedName, new Error(outcome.reason), log, ledger);
    return outcome;
  }
  if (outcome.unstoredCount > 0) {
    log.warn(`${feedName}: ${outcome.unstoredCount} of ${report.received} ${report.noun ?? "records"} were not stored.`);
  }
  try {
    await ledger.recordHealth(feedName, outcome.entityCount, report.sourceTimestampSeconds ?? null, report.coverage);
  } catch (healthError) {
    log.error(`Failed to record ${feedName} feed health:`, healthError);
  }
  return outcome;
}

async function failure(feedName: KpiFeedName, error: unknown, log: FeedRunLog, ledger: FeedLedger): Promise<void> {
  try {
    await ledger.recordFailure(feedName, error);
  } catch (healthError) {
    log.error(`Failed to record ${feedName} feed failure:`, healthError);
  }
}

// For a run that supplies more than one feed, such as the Spare ingest that
// reads Requests and then the Slots those requests name. A throw is recorded
// against every feed, because a Requests failure takes Slots down with it and
// marking only one would understate the outage.
export async function runFeedsIngestion<F extends KpiFeedName>(
  feedNames: readonly F[],
  log: FeedRunLog,
  run: () => Promise<Record<F, FeedRunReport>>,
  ledger: FeedLedger = sqlFeedLedger,
): Promise<Record<F, FeedRunResult>> {
  let reports: Record<F, FeedRunReport>;
  try {
    reports = await run();
  } catch (err) {
    log.error(`${feedNames.join(", ")} ingestion failed:`, err);
    for (const feedName of feedNames) await failure(feedName, err, log, ledger);
    throw err;
  }
  const results = {} as Record<F, FeedRunResult>;
  for (const feedName of feedNames) {
    results[feedName] = await settle(feedName, reports[feedName], log, ledger);
  }
  return results;
}

export async function runFeedIngestion(
  feedName: KpiFeedName,
  log: FeedRunLog,
  run: () => Promise<FeedRunReport>,
  ledger: FeedLedger = sqlFeedLedger,
): Promise<FeedRunResult> {
  const results = await runFeedsIngestion([feedName], log, async () => ({ [feedName]: await run() }) as Record<KpiFeedName, FeedRunReport>, ledger);
  return results[feedName];
}
