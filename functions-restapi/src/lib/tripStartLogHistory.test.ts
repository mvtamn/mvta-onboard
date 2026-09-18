import test from "node:test";
import assert from "node:assert/strict";
import { shapeVerificationEvent } from "./tripStartLogHistory";

const row = {
  id: 41,
  previous_observation: null,
  observation: "observed_on_time",
  recorded_by: "ocs@example.org",
  recorded_initials: "JD",
  note: null,
  recorded_at: new Date("2026-09-08T11:05:00Z"),
};

test("an event says what the cell went from, what it went to, and who changed it", () => {
  assert.deepEqual(shapeVerificationEvent(row), {
    id: 41,
    previous_observation: null,
    observation: "observed_on_time",
    recorded_by: "ocs@example.org",
    recorded_initials: "JD",
    note: null,
    recorded_at: "2026-09-08T11:05:00.000Z",
  });
});

test("a cleared cell keeps the observation it was cleared from", () => {
  const cleared = shapeVerificationEvent({
    ...row,
    previous_observation: "observed_left_late",
    observation: null,
    note: "Entered against the wrong trip",
  });
  assert.equal(cleared.previous_observation, "observed_left_late");
  assert.equal(cleared.observation, null);
  assert.equal(cleared.note, "Entered against the wrong trip");
});

// The table ties on recorded_at at the second, so nothing but the id tells two
// entries a cycle click apart from each other (the tie that made PR #320 flaky).
test("two entries recorded in the same second stay distinct", () => {
  const first = shapeVerificationEvent({ ...row, id: 41 });
  const second = shapeVerificationEvent({ ...row, id: 42, previous_observation: "observed_on_time", observation: "observed_left_late" });
  assert.equal(first.recorded_at, second.recorded_at);
  assert.notEqual(first.id, second.id);
});
