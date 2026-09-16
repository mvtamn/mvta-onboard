import assert from "node:assert";
import { test } from "node:test";
import {
  AWAITING_CONFIRMATION,
  NO_SHOW_CONFIRMATION_SECONDS,
  SCHEDULE_AGREEMENT_MIN_SAMPLE,
  STATIC_SCHEDULE_STALE_AFTER_HOURS,
  confirmationDue,
  noShowDecision,
  scheduleAgreement,
  staticScheduleConfidence,
  type NoShowEvidenceContext,
} from "./missedTripConfidence";
import type { KpiFeedHealth } from "./kpiTrust";

const now = new Date("2026-09-15T18:00:00.000Z");

function staticHealth(hoursAgo: number | null): KpiFeedHealth[] {
  return [
    {
      feed_name: "gtfs_static",
      last_success_at: hoursAgo === null ? null : new Date(now.getTime() - hoursAgo * 3_600_000),
      last_entity_count: 1200,
      source_timestamp_at: null,
    },
  ];
}

const trusted = { trusted: true, explanation: null };

function context(overrides: Partial<NoShowEvidenceContext> = {}): NoShowEvidenceContext {
  return {
    vehiclePositionsCurrent: true,
    staticSchedule: trusted,
    agreement: trusted,
    blockReported: true,
    ...overrides,
  };
}

test("a static schedule imported this morning is trusted", () => {
  assert.equal(staticScheduleConfidence(staticHealth(9), now).trusted, true);
});

test("a static schedule beyond the detector limit is not trusted, and says how old it is", () => {
  const verdict = staticScheduleConfidence(staticHealth(STATIC_SCHEDULE_STALE_AFTER_HOURS + 1), now);
  assert.equal(verdict.trusted, false);
  assert.match(verdict.explanation ?? "", /49h ago/);
});

test("a static schedule that has never imported is not trusted", () => {
  const verdict = staticScheduleConfidence(staticHealth(null), now);
  assert.equal(verdict.trusted, false);
  assert.match(verdict.explanation ?? "", /no recorded successful import/);
});

test("a feed health table with no gtfs_static row at all is not trusted", () => {
  assert.equal(staticScheduleConfidence([], now).trusted, false);
});

test("a schedule the feeds recognise agrees", () => {
  assert.equal(scheduleAgreement({ deadlinePassed: 400, knownToFeed: 392 }).trusted, true);
});

test("a schedule almost none of the feeds recognise does not agree", () => {
  const verdict = scheduleAgreement({ deadlinePassed: 400, knownToFeed: 3 });
  assert.equal(verdict.trusted, false);
  assert.match(verdict.explanation ?? "", /3 of 400/);
});

test("a sample too small to mean anything is not judged", () => {
  // Early morning: three trips past their deadline, none yet in a feed. The
  // ratio is 0, and it says nothing.
  const verdict = scheduleAgreement({ deadlinePassed: SCHEDULE_AGREEMENT_MIN_SAMPLE - 1, knownToFeed: 0 });
  assert.equal(verdict.trusted, true);
});

test("a day with nothing scheduled past its deadline does not divide by zero", () => {
  assert.equal(scheduleAgreement({ deadlinePassed: 0, knownToFeed: 0 }).trusted, true);
});

test("a fully-evidenced run holds the trip for confirmation rather than escalating it", () => {
  assert.deepEqual(noShowDecision(context()), { outcome: "pending", reason: AWAITING_CONFIRMATION });
});

test("a position feed that is not current decides nothing", () => {
  assert.deepEqual(noShowDecision(context({ vehiclePositionsCurrent: false })), {
    outcome: "undecidable",
    reason: "vehicle_position_feed_not_current",
  });
});

test("a stale static import decides nothing", () => {
  assert.deepEqual(
    noShowDecision(context({ staticSchedule: { trusted: false, explanation: "old" } })),
    { outcome: "undecidable", reason: "static_schedule_stale" },
  );
});

test("a schedule the feeds do not recognise decides nothing", () => {
  assert.deepEqual(
    noShowDecision(context({ agreement: { trusted: false, explanation: "disagrees" } })),
    { outcome: "undecidable", reason: "schedule_disagrees_with_feed" },
  );
});

test("a block that never reported a position decides nothing", () => {
  assert.deepEqual(noShowDecision(context({ blockReported: false })), {
    outcome: "undecidable",
    reason: "block_never_reported",
  });
});

test("a trip with no block id is still judged - an absent column is not evidence", () => {
  assert.equal(noShowDecision(context({ blockReported: null })).outcome, "pending");
});

test("the broadest explanation wins over the narrowest", () => {
  // A stale schedule makes the block question meaningless: those trip ids were
  // never going to appear whatever the buses did.
  const verdict = noShowDecision(
    context({ staticSchedule: { trusted: false, explanation: "old" }, blockReported: false }),
  );
  assert.equal(verdict.reason, "static_schedule_stale");
});

test("an outage outranks a stale schedule", () => {
  const verdict = noShowDecision(
    context({ vehiclePositionsCurrent: false, staticSchedule: { trusted: false, explanation: "old" } }),
  );
  assert.equal(verdict.reason, "vehicle_position_feed_not_current");
});

test("a trip detected in this run cannot be confirmed by it", () => {
  assert.equal(confirmationDue(now, now), false);
});

test("a trip still unevidenced one poll later is confirmable", () => {
  const detected = new Date(now.getTime() - 300_000); // one five-minute poll
  assert.equal(confirmationDue(detected, now), true);
});

test("the confirmation wait is shorter than the poll interval, so the next run always qualifies", () => {
  assert.ok(NO_SHOW_CONFIRMATION_SECONDS < 300);
});
