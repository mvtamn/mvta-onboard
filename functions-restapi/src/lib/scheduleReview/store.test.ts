import { test } from "node:test";
import assert from "node:assert";
import { detailChanged } from "./store";
import { reviewSchedule } from "./index";
import { feed } from "./fixture.test-support";

test("the same evidence is unchanged; evidence with more in it, or a route more or less, is changed", () => {
  const { details } = reviewSchedule(feed({}));
  const stored = new Map(details.map((d) => [d.route_id, JSON.stringify(d)]));
  assert.strictEqual(detailChanged(stored, details), false);

  // Detail kept before v1.5.330 has no segment direction: the new code's is different.
  const older = new Map(details.map((d) => [d.route_id, JSON.stringify({ ...d, segments: d.segments.map(({ direction: _, ...rest }) => rest) })]));
  assert.strictEqual(detailChanged(older, details), true);

  assert.strictEqual(detailChanged(new Map(), details), true);
  assert.strictEqual(detailChanged(new Map([...stored, ["R9", "{}"]]), details), true);
});
