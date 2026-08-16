import test from "node:test";
import assert from "node:assert/strict";
import {
  selectMatchingDirectionRule,
  snapshotMatchedDirectionRule,
  validateDirectionRule,
  type DirectionRule,
} from "./eventDirectionRules";

const baseRule: DirectionRule = {
  id: "7e5a35b1-dc1b-473d-987d-6942a7b4fae2",
  geofence_id: "8e5a35b1-dc1b-473d-987d-6942a7b4fae2",
  transition: "exit",
  heading_min: 350,
  heading_max: 10,
  destination_label: "Downtown",
  destination_location_id: "9e5a35b1-dc1b-473d-987d-6942a7b4fae2",
  message_type: "custom",
  send_mode: "manual",
  sort_order: 10,
};

test("accepts a valid wrapped direction rule", () => {
  assert.deepEqual(validateDirectionRule({ ...baseRule }, []), { ok: true, value: baseRule });
});

test("rejects malformed direction-rule values", () => {
  const result = validateDirectionRule({
    ...baseRule,
    transition: "leave" as unknown as DirectionRule["transition"],
    heading_min: Number.NaN,
    heading_max: 361,
    destination_label: "   ",
    message_type: "unexpected" as unknown as DirectionRule["message_type"],
    send_mode: "sometimes" as unknown as DirectionRule["send_mode"],
    sort_order: -1,
  }, []);
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.errors, [
    "transition must be enter or exit",
    "heading_min and heading_max must be finite numbers between 0 and 360",
    "message_type must be departing, passed, arriving_soon, or custom",
    "send_mode must be manual or auto",
    "sort_order must be a non-negative integer",
  ]);
});

test("rejects a malformed destination location reference", () => {
  const result = validateDirectionRule({ ...baseRule, destination_location_id: 42 as unknown as string }, []);
  assert.deepEqual(result, { ok: false, errors: ["destination_location_id must be a GUID or null"] });
});

test("rejects duplicate priority within a geofence and transition", () => {
  const result = validateDirectionRule({ ...baseRule, id: "rule-2" }, [baseRule]);
  assert.deepEqual(result, { ok: false, errors: ["sort_order must be unique within the geofence and transition"] });
});

test("selects the lowest-priority matching rule", () => {
  const broad = { ...baseRule, id: "broad", heading_min: 0, heading_max: 360, sort_order: 20 };
  const specific = { ...baseRule, id: "specific", sort_order: 10 };
  assert.equal(selectMatchingDirectionRule([broad, specific], "exit", 355)?.id, "specific");
});

test("creates a stable matched rule snapshot", () => {
  assert.deepEqual(snapshotMatchedDirectionRule(baseRule), {
    matched_rule_id: "7e5a35b1-dc1b-473d-987d-6942a7b4fae2",
    matched_rule_priority: 10,
    matched_destination_label: "Downtown",
    matched_destination_location_id: "9e5a35b1-dc1b-473d-987d-6942a7b4fae2",
    matched_message_type: "custom",
    matched_send_mode: "manual",
  });
});

test("allows a standard message type without custom wording", () => {
  const result = validateDirectionRule({ ...baseRule, message_type: "arriving_soon", destination_label: "" }, []);
  assert.deepEqual(result, { ok: false, errors: ["arriving_soon messages must use an enter transition"] });
});

test("allows arriving soon only when the vehicle enters the geofence", () => {
  const result = validateDirectionRule({ ...baseRule, transition: "enter", message_type: "arriving_soon", destination_label: "" }, []);
  assert.equal(result.ok, true);
});
