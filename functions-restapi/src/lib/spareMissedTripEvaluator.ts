export const SPARE_MISSED_TRIP_CALC_VERSION = "spare-missed-v1";
const THIRTY_MINUTES_SECONDS = 30 * 60;

export interface SpareMissedTripInput {
  requestId: string;
  dutyId: string | null;
  status: string;
  scheduledPickupAt: Date | null;
  pickupArrivedAt: Date | null;
  pickupLatenessSeconds: number | null;
  dropoffLatenessSeconds: number | null;
  cancellationFault: string | null;
  cancellationReason: string | null;
}

export interface SparePickupSlot {
  slotId: string;
  dutyId: string;
  requestId: string | null;
  type: string;
  scheduledAt: Date | null;
}

export interface SpareMissedTripRules {
  contractorFaultValues: ReadonlySet<string>;
  lateStartSeconds?: number;
  lateArrivalSeconds?: number;
}

export interface SpareMissedTripEvaluation {
  decisionState: "candidate" | "not_missed" | "unknown_data_gap";
  conditionLateStart: boolean;
  conditionSuperseded: boolean;
  conditionLateArrival: boolean;
  startDelaySeconds: number | null;
  arrivalDelaySeconds: number | null;
  supersedingSlotAt: Date | null;
  unknownReason: string | null;
  calculationVersion: string;
}

function normalized(value: string | null): string {
  return value?.trim().toLowerCase() ?? "";
}

export function evaluateSpareMissedTrip(
  input: SpareMissedTripInput,
  dutySlots: SparePickupSlot[],
  rules: SpareMissedTripRules,
): SpareMissedTripEvaluation {
  const lateStartSeconds = rules.lateStartSeconds ?? THIRTY_MINUTES_SECONDS;
  const lateArrivalSeconds = rules.lateArrivalSeconds ?? THIRTY_MINUTES_SECONDS;
  const cancelled = normalized(input.status) === "cancelled";
  const cancellationFault = normalized(input.cancellationFault);
  const contractorCancellation =
    cancelled && cancellationFault !== "" && rules.contractorFaultValues.has(cancellationFault);

  let unknownReason: string | null = null;
  if (cancelled && !contractorCancellation) {
    unknownReason = cancellationFault
      ? "cancellation_not_confirmed_contractor_fault"
      : "cancellation_fault_missing";
  }

  const conditionLateStart =
    contractorCancellation ||
    (!cancelled && input.pickupLatenessSeconds !== null && input.pickupLatenessSeconds > lateStartSeconds);

  const eligibleNextSlots = input.dutyId && input.scheduledPickupAt
    ? dutySlots
        .filter((slot) =>
          slot.dutyId === input.dutyId &&
          normalized(slot.type) === "pickup" &&
          slot.requestId !== input.requestId &&
          slot.scheduledAt !== null &&
          slot.scheduledAt.getTime() > input.scheduledPickupAt!.getTime(),
        )
        .sort((a, b) => a.scheduledAt!.getTime() - b.scheduledAt!.getTime())
    : [];
  const nextSlot = eligibleNextSlots[0] ?? null;
  const nextSlotWithinWindow = Boolean(
    nextSlot?.scheduledAt &&
    input.scheduledPickupAt &&
    nextSlot.scheduledAt.getTime() - input.scheduledPickupAt.getTime() < lateStartSeconds * 1000,
  );
  const conditionSuperseded = Boolean(
    nextSlotWithinWindow &&
    input.pickupArrivedAt &&
    nextSlot?.scheduledAt &&
    input.pickupArrivedAt.getTime() > nextSlot.scheduledAt.getTime(),
  );
  if (nextSlotWithinWindow && !input.pickupArrivedAt && !conditionLateStart && !cancelled) {
    unknownReason = "pickup_actual_missing_for_supersession_check";
  }

  // The current owner spec uses >30 for late start and >=30 for late
  // arrival. Both thresholds remain explicit rule inputs so final sign-off
  // can change them without rewriting the evaluator.
  const conditionLateArrival =
    input.dropoffLatenessSeconds !== null && input.dropoffLatenessSeconds >= lateArrivalSeconds;
  const candidate = conditionLateStart || conditionSuperseded || conditionLateArrival;

  return {
    decisionState: candidate ? "candidate" : unknownReason ? "unknown_data_gap" : "not_missed",
    conditionLateStart,
    conditionSuperseded,
    conditionLateArrival,
    startDelaySeconds: input.pickupLatenessSeconds,
    arrivalDelaySeconds: input.dropoffLatenessSeconds,
    supersedingSlotAt: conditionSuperseded ? nextSlot?.scheduledAt ?? null : null,
    unknownReason: candidate ? null : unknownReason,
    calculationVersion: SPARE_MISSED_TRIP_CALC_VERSION,
  };
}
