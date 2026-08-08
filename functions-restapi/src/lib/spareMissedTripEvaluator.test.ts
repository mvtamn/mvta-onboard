import { test } from "node:test";
import assert from "node:assert";
import { evaluateSpareMissedTrip, type SpareMissedTripInput } from "./spareMissedTripEvaluator";

const BASE: SpareMissedTripInput = {
  requestId: "request-1",
  dutyId: "duty-1",
  status: "completed",
  scheduledPickupAt: new Date("2026-08-07T15:00:00Z"),
  pickupArrivedAt: new Date("2026-08-07T15:05:00Z"),
  pickupLatenessSeconds: 300,
  dropoffLatenessSeconds: 300,
  cancellationFault: null,
  cancellationReason: null,
};

const RULES = { contractorFaultValues: new Set(["operator", "contractor"]) };

test("flags a start more than 30 minutes late", () => {
  const result = evaluateSpareMissedTrip({ ...BASE, pickupLatenessSeconds: 1801 }, [], RULES);
  assert.strictEqual(result.decisionState, "candidate");
  assert.strictEqual(result.conditionLateStart, true);
});

test("does not flag a start exactly 30 minutes late under the current >30 rule", () => {
  const result = evaluateSpareMissedTrip({ ...BASE, pickupLatenessSeconds: 1800 }, [], RULES);
  assert.strictEqual(result.decisionState, "not_missed");
});

test("flags an arrival exactly 30 minutes late under the current >=30 rule", () => {
  const result = evaluateSpareMissedTrip({ ...BASE, dropoffLatenessSeconds: 1800 }, [], RULES);
  assert.strictEqual(result.conditionLateArrival, true);
});

test("flags a contractor-attributable cancellation", () => {
  const result = evaluateSpareMissedTrip(
    { ...BASE, status: "cancelled", cancellationFault: "Operator" },
    [],
    RULES,
  );
  assert.strictEqual(result.conditionLateStart, true);
  assert.strictEqual(result.decisionState, "candidate");
});

test("keeps an unattributed cancellation unknown instead of auto-flagging it", () => {
  const result = evaluateSpareMissedTrip(
    { ...BASE, status: "cancelled", cancellationFault: null },
    [],
    RULES,
  );
  assert.strictEqual(result.conditionLateStart, false);
  assert.strictEqual(result.decisionState, "unknown_data_gap");
  assert.strictEqual(result.unknownReason, "cancellation_fault_missing");
});

test("flags a pickup that occurs after the next pickup on the same duty", () => {
  const result = evaluateSpareMissedTrip(
    { ...BASE, pickupArrivedAt: new Date("2026-08-07T15:25:00Z") },
    [{
      slotId: "slot-2",
      dutyId: "duty-1",
      requestId: "request-2",
      type: "pickup",
      scheduledAt: new Date("2026-08-07T15:20:00Z"),
    }],
    RULES,
  );
  assert.strictEqual(result.conditionSuperseded, true);
  assert.strictEqual(result.supersedingSlotAt?.toISOString(), "2026-08-07T15:20:00.000Z");
});

test("keeps missing pickup evidence unknown when a superseding slot exists", () => {
  const result = evaluateSpareMissedTrip(
    { ...BASE, pickupArrivedAt: null },
    [{
      slotId: "slot-2",
      dutyId: "duty-1",
      requestId: "request-2",
      type: "pickup",
      scheduledAt: new Date("2026-08-07T15:20:00Z"),
    }],
    RULES,
  );
  assert.strictEqual(result.decisionState, "unknown_data_gap");
  assert.strictEqual(result.conditionSuperseded, false);
});

test("ignores a cancelled next pickup when checking same-duty supersession", () => {
  const result = evaluateSpareMissedTrip(
    { ...BASE, pickupArrivedAt: new Date("2026-08-08T15:25:00Z") },
    [{
      slotId: "cancelled-next",
      dutyId: BASE.dutyId!,
      requestId: "other-request",
      type: "pickup",
      status: "cancelled",
      scheduledAt: new Date("2026-08-08T15:20:00Z"),
    }],
    RULES,
  );
  assert.equal(result.conditionSuperseded, false);
  assert.equal(result.decisionState, "not_missed");
});
