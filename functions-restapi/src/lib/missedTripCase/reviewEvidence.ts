// The evidence a reviewer decided a GTFS case on, kept with the decision.
//
// A GTFS case's start evidence is read live (caseEvidence.ts) from tables that
// do not keep it: the Dispatch Log and vehicle evidence are rebuilt and pruned,
// a stop's record moves as other cases are decided, and otpDailyFeedPoll
// purges OTP Daily after 90 days. A contractor can dispute a charge long after
// that, so CONTEXT.md's Retained missed-trip evidence requires what the
// reviewer cited to survive its sources.
//
// So each review writes a snapshot of the readings into the case's
// evidence_json, under "review_evidence", keyed to the MissedTripReviewHistory
// row it belongs to. A re-review adds its own snapshot beside the earlier
// ones; nothing is overwritten. Reads show the latest snapshot on a reviewed
// case instead of reading live.
//
// The read happens before the review's transaction, as the promotion read
// does, so the evidence tables are never read under the case's lock. If the
// read fails the review still records, and the snapshot says the evidence
// could not be read: the reviewer was told so on the page ("Reload before
// deciding"), and the record has to say what they decided without.
//
// Spare cases are not snapshotted: their evidence is the evaluation stored on
// the case when it was observed (adapters/spare.ts).
import { sql } from "../db";
import { readCaseEvidence, type GtfsCaseEvidence } from "./caseEvidence";

export const REVIEW_EVIDENCE_KEY = "review_evidence";

/** What one review saw. Stored in evidence_json.review_evidence, oldest first. */
export interface ReviewEvidenceSnapshot {
  /** MissedTripReviewHistory.review_id of the review this was taken for. */
  review_id: number | null;
  /** When the evidence was read, just before the review was recorded. ISO. */
  read_at: string;
  reviewed_by: string;
  /** The validation_status the review recorded. */
  outcome: string;
  /** The readings, as the console showed them. Null when the read failed. */
  evidence: GtfsCaseEvidence | null;
  /** Why evidence is null; null when the read worked. */
  read_failed: string | null;
}

/** The read taken before the review's transaction opens. */
export interface CapturedEvidence {
  read_at: Date;
  evidence: GtfsCaseEvidence | null;
  read_failed: string | null;
}

const READ_FAILED_MAX = 300;

interface CaseForEvidence {
  trip_id: string;
  service_date: string;
  source_system: string | null;
  scheduled_departure_at: Date;
  grace_deadline_at: Date;
}

/** Reads the case's evidence for its review. Null for a Spare case. Never throws. */
export async function captureReviewEvidence(pool: sql.ConnectionPool, c: CaseForEvidence, now = new Date()): Promise<CapturedEvidence | null> {
  if (c.source_system === "spare") return null;
  try {
    const found = await readCaseEvidence(pool, [c]);
    const evidence = found.get(`${c.trip_id}|${c.service_date}`) ?? null;
    return {
      read_at: now,
      evidence,
      read_failed: evidence ? null : "The Dispatch Log and vehicle evidence tables were not there to read.",
    };
  } catch (err) {
    return { read_at: now, evidence: null, read_failed: failureText(err) };
  }
}

function failureText(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return `The evidence read failed: ${message}`.slice(0, READ_FAILED_MAX);
}

function parseObject(existing: string | null): Record<string, unknown> {
  if (!existing) return {};
  try {
    const parsed: unknown = JSON.parse(existing);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    return { previous: parsed };
  } catch {
    return { previous: existing };
  }
}

/** evidence_json with this snapshot added after any earlier ones. Other keys are kept as they are. */
export function withReviewEvidence(existing: string | null, snapshot: ReviewEvidenceSnapshot): string {
  const base = parseObject(existing);
  const earlier = Array.isArray(base[REVIEW_EVIDENCE_KEY]) ? (base[REVIEW_EVIDENCE_KEY] as unknown[]) : [];
  return JSON.stringify({ ...base, [REVIEW_EVIDENCE_KEY]: [...earlier, snapshot] });
}

function isSnapshot(value: unknown): value is ReviewEvidenceSnapshot {
  return Boolean(value) && typeof value === "object" && typeof (value as ReviewEvidenceSnapshot).read_at === "string"
    && "evidence" in (value as object);
}

/** The latest review's snapshot, from the review_evidence array (or a whole evidence_json). */
export function latestReviewEvidence(json: string | null): ReviewEvidenceSnapshot | null {
  if (!json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const list = Array.isArray(parsed) ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>)[REVIEW_EVIDENCE_KEY])
      ? (parsed as Record<string, unknown[]>)[REVIEW_EVIDENCE_KEY]
      : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (isSnapshot(list[i])) return list[i] as ReviewEvidenceSnapshot;
  }
  return null;
}

/**
 * Writes the snapshot for the review just recorded in this transaction: the
 * case's newest MissedTripReviewHistory row. Call it after the review's own
 * write, inside the same transaction, so a review never commits without it.
 */
export async function writeReviewEvidence(
  tx: sql.Transaction,
  key: { tripId: string; serviceDate: string },
  captured: CapturedEvidence,
  review: { reviewedBy: string; outcome: string },
): Promise<void> {
  const current = await new sql.Request(tx)
    .input("trip_id", sql.NVarChar(100), key.tripId)
    .input("service_date", sql.NVarChar(20), key.serviceDate)
    .query<{ evidence_json: string | null; review_id: number | string | null }>(`
      SELECT m.evidence_json,
             (SELECT MAX(h.review_id) FROM MissedTripReviewHistory h
              WHERE h.trip_id = m.trip_id AND h.service_date = m.service_date) AS review_id
      FROM MonitoredMissedTrips m
      WHERE m.trip_id = @trip_id AND m.service_date = @service_date`);
  const row = current.recordset[0];
  if (!row) return;
  const snapshot: ReviewEvidenceSnapshot = {
    // BIGINT arrives as a string from the driver.
    review_id: row.review_id === null ? null : Number(row.review_id),
    read_at: captured.read_at.toISOString(),
    reviewed_by: review.reviewedBy,
    outcome: review.outcome,
    evidence: captured.evidence,
    read_failed: captured.read_failed,
  };
  await new sql.Request(tx)
    .input("trip_id", sql.NVarChar(100), key.tripId)
    .input("service_date", sql.NVarChar(20), key.serviceDate)
    .input("evidence_json", sql.NVarChar(sql.MAX), withReviewEvidence(row.evidence_json, snapshot))
    .query(`
      UPDATE MonitoredMissedTrips SET evidence_json = @evidence_json
      WHERE trip_id = @trip_id AND service_date = @service_date`);
}
