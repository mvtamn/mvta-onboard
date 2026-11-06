import assert from "node:assert/strict";
import test from "node:test";
import type { sql } from "../db";
import type { GtfsCaseEvidence } from "./caseEvidence";
import { captureReviewEvidence, latestReviewEvidence, REVIEW_EVIDENCE_KEY, withReviewEvidence, type ReviewEvidenceSnapshot } from "./reviewEvidence";

// The evidence kept at review, as JSON. reviewEvidence.db.contract.test.ts
// proves the write inside a review and the read after the sources are gone.

const EVIDENCE: GtfsCaseEvidence = {
  departure: { reading: "departed", at: "2026-10-16T15:24:00.000Z" },
  started_at: "2026-10-16T15:24:00.000Z",
  started_late_minutes: 4,
  started_inside_grace: true,
  vehicle: { reported_at: "2026-10-16T15:10:00.000Z", underway_at: null, vehicle_id: "4265" },
  block: { block_id: "515", trips: 7, trips_reported: 6 },
  origin_stop: { stop_id: "51990", name: "Apple Valley Transit Station", other_cases: 3, other_cases_ran: 2, likely_dead_zone: false },
  avail_otp: { hour: 10, trips_starting: 1, departed: 2, missed: 0, all_left: true },
};

function snapshot(overrides: Partial<ReviewEvidenceSnapshot> = {}): ReviewEvidenceSnapshot {
  return {
    review_id: 41, read_at: "2026-10-17T13:00:00.000Z", reviewed_by: "occ@example.com", outcome: "confirmed",
    evidence: EVIDENCE, read_failed: null, ...overrides,
  };
}

test("a snapshot is added beside the evidence other sources kept", () => {
  const existing = JSON.stringify({ avail: { entireTripMissed: true }, avail_otp_origin: { departures: 2 } });
  const json = JSON.parse(withReviewEvidence(existing, snapshot()));
  assert.deepEqual(json.avail, { entireTripMissed: true });
  assert.deepEqual(json.avail_otp_origin, { departures: 2 });
  assert.deepEqual(json[REVIEW_EVIDENCE_KEY], [snapshot()]);
});

test("a later review's snapshot follows the earlier one, which is kept", () => {
  const first = withReviewEvidence(null, snapshot());
  const second = withReviewEvidence(first, snapshot({ review_id: 42, outcome: "timely_service", evidence: null, read_failed: "The evidence read failed: timeout" }));
  const list = JSON.parse(second)[REVIEW_EVIDENCE_KEY] as ReviewEvidenceSnapshot[];
  assert.deepEqual(list.map((s) => s.review_id), [41, 42]);
  assert.deepEqual(list[0].evidence, EVIDENCE);
  assert.equal(latestReviewEvidence(second)?.review_id, 42);
});

test("evidence_json that is not an object is kept under previous, not lost", () => {
  assert.deepEqual(JSON.parse(withReviewEvidence("not json", snapshot())).previous, "not json");
  assert.deepEqual(JSON.parse(withReviewEvidence("[1,2]", snapshot())).previous, [1, 2]);
});

test("the latest snapshot is read from a whole evidence_json or from the review_evidence array alone", () => {
  const whole = withReviewEvidence(null, snapshot());
  assert.equal(latestReviewEvidence(whole)?.review_id, 41);
  assert.equal(latestReviewEvidence(JSON.stringify(JSON.parse(whole)[REVIEW_EVIDENCE_KEY]))?.review_id, 41);
  assert.equal(latestReviewEvidence(null), null);
  assert.equal(latestReviewEvidence("{oops"), null);
  assert.equal(latestReviewEvidence(JSON.stringify({ avail: {} })), null);
  assert.equal(latestReviewEvidence(JSON.stringify([{ unrelated: true }])), null);
});

const CASE = {
  trip_id: "t1", service_date: "20261016", source_system: "gtfs",
  scheduled_departure_at: new Date("2026-10-16T15:20:00Z"), grace_deadline_at: new Date("2026-10-16T15:50:00Z"),
};
const NOW = new Date("2026-10-17T13:00:00Z");

test("a Spare case is not snapshotted: its evaluation is already stored on the case", async () => {
  const pool = { request: () => { throw new Error("must not read"); } } as unknown as sql.ConnectionPool;
  assert.equal(await captureReviewEvidence(pool, { ...CASE, source_system: "spare" }, NOW), null);
});

test("a failed read is captured as failed, with the reason, and never throws", async () => {
  const pool = { request: () => ({ query: async () => { throw new Error("Connection lost"); } }) } as unknown as sql.ConnectionPool;
  const captured = await captureReviewEvidence(pool, CASE, NOW);
  assert.deepEqual(captured, { read_at: NOW, evidence: null, read_failed: "The evidence read failed: Connection lost" });
});

test("missing evidence tables are captured as a failed read, not as evidence of absence", async () => {
  const pool = { request: () => ({ query: async () => ({ recordset: [{ ok: 0, otp: 0 }] }) }) } as unknown as sql.ConnectionPool;
  const captured = await captureReviewEvidence(pool, CASE, NOW);
  assert.equal(captured?.evidence, null);
  assert.match(captured?.read_failed ?? "", /not there to read/);
});
