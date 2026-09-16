import assert from "node:assert";
import { test } from "node:test";
import {
  AWAITING_CONFIRMATION,
  NO_SHOW_CONFIRMATION_SECONDS,
  SCHEDULE_AGREEMENT_MIN_SAMPLE,
  STATIC_SCHEDULE_STALE_AFTER_HOURS,
  blockContinuity,
  confirmationDue,
  noShowDecision,
  scheduleAgreement,
  staticScheduleConfidence,
  type BlockTripEvidence,
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
    block: { anyPosition: true, operatedBefore: false, operatedAfter: false },
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
  assert.deepEqual(
    noShowDecision(context({ block: { anyPosition: false, operatedBefore: false, operatedAfter: false } })),
    { outcome: "undecidable", reason: "block_never_reported" },
  );
});

test("a trip with no block id is still judged - an absent column is not evidence", () => {
  assert.equal(noShowDecision(context({ block: null })).outcome, "pending");
});

test("the broadest explanation wins over the narrowest", () => {
  // A stale schedule makes the block question meaningless: those trip ids were
  // never going to appear whatever the buses did.
  const verdict = noShowDecision(
    context({
      staticSchedule: { trusted: false, explanation: "old" },
      block: { anyPosition: false, operatedBefore: false, operatedAfter: false },
    }),
  );
  assert.equal(verdict.reason, "static_schedule_stale");
});

test("an outage outranks a stale schedule", () => {
  const verdict = noShowDecision(
    context({ vehiclePositionsCurrent: false, staticSchedule: { trusted: false, explanation: "old" } }),
  );
  assert.equal(verdict.reason, "vehicle_position_feed_not_current");
});

// A block's trips, in the order one bus runs them. `operated` is positive
// progress past the first stop; `reportedPosition` is any position at all.
function blockTrip(departureSeconds: number, operated: boolean, reportedPosition = true): BlockTripEvidence {
  return { departureSeconds, operated, reportedPosition };
}

const MIDDAY = 12 * 3600;

test("a block reports operating on both sides of a mid-block trip", () => {
  const verdict = blockContinuity(
    [blockTrip(MIDDAY - 3600, true), blockTrip(MIDDAY, false), blockTrip(MIDDAY + 3600, true)],
    MIDDAY,
  );
  assert.deepEqual(verdict, { anyPosition: true, operatedBefore: true, operatedAfter: true });
});

test("a trip is never its own witness", () => {
  const verdict = blockContinuity([blockTrip(MIDDAY, true)], MIDDAY);
  assert.equal(verdict.operatedBefore, false);
  assert.equal(verdict.operatedAfter, false);
});

test("a trip leaving at the same second is not a witness either", () => {
  const verdict = blockContinuity([blockTrip(MIDDAY, true), blockTrip(MIDDAY, true)], MIDDAY);
  assert.equal(verdict.operatedBefore, false);
  assert.equal(verdict.operatedAfter, false);
});

test("a block that only reported positions has no witnesses, but is not silent", () => {
  // Positions arrived, so the transponder is alive; nothing progressed past a
  // first stop, so nothing can vouch for a neighbour.
  const verdict = blockContinuity([blockTrip(MIDDAY - 3600, false), blockTrip(MIDDAY + 3600, false)], MIDDAY);
  assert.deepEqual(verdict, { anyPosition: true, operatedBefore: false, operatedAfter: false });
});

test("a block with no position on any trip is silent", () => {
  const verdict = blockContinuity(
    [blockTrip(MIDDAY - 3600, false, false), blockTrip(MIDDAY + 3600, false, false)],
    MIDDAY,
  );
  assert.equal(verdict.anyPosition, false);
});

test("a bus that operated either side of this trip decides nothing", () => {
  assert.deepEqual(
    noShowDecision(context({ block: { anyPosition: true, operatedBefore: true, operatedAfter: true } })),
    { outcome: "undecidable", reason: "block_ran_around_this_trip" },
  );
});

// The two patterns this guard must NOT swallow. Both are genuine missed trips
// with only one side of a witness, and both are the highest-value findings the
// detector produces.
test("a block whose evidence stops and never resumes is still a candidate", () => {
  // The bus went out of service mid-day: every remaining trip is missed.
  assert.equal(
    noShowDecision(context({ block: { anyPosition: true, operatedBefore: true, operatedAfter: false } })).outcome,
    "pending",
  );
});

test("a block that started late is still a candidate", () => {
  // Nothing before, service afterwards: the early trips genuinely did not run.
  assert.equal(
    noShowDecision(context({ block: { anyPosition: true, operatedBefore: false, operatedAfter: true } })).outcome,
    "pending",
  );
});

test("a silent block outranks the question of what it ran", () => {
  // anyPosition false makes operatedBefore/After unreachable in practice; the
  // ordering is asserted so a future edit cannot quietly invert it.
  const verdict = noShowDecision(
    context({ block: { anyPosition: false, operatedBefore: true, operatedAfter: true } }),
  );
  assert.equal(verdict.reason, "block_never_reported");
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
