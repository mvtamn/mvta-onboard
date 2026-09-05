// On-demand garage departure, resolved from Spare duty and slot records.
//
// ADR 0028 makes garage departure one concept with one source per service
// type. This is the Spare side, at duty grain, per
// onboard-spare-integration-spec.md section 6.3: the duty's startLocation slot
// is the departure when Spare has one, and the duty record stands in when it
// does not. Both halves record which source they came from, because a
// departure inferred from the vehicle first appearing in the service area is
// weaker evidence than a slot the driver actually started, and a reader
// deciding whether to raise it with a contractor needs to know which it was.
//
// Pure: the poll fetches and stores, this decides. Nothing here touches PII -
// driver and vehicle are ids.
import { spareString, spareTimestamp, type SpareDutyRecord, type SpareSlotRecord } from "./spareApi";

export type OnDemandScheduledSource = "slots_startLocation" | "duties_startRequested";
export type OnDemandDepartureSource = "slots_startLocation" | "duties_firstSeenInServiceArea";

export interface ResolvedOnDemandDeparture {
  dutyId: string;
  dutyIdentifier: string | null;
  driverId: string | null;
  vehicleId: string | null;
  dutyStatus: string | null;
  departureScheduled: Date | null;
  scheduledSource: OnDemandScheduledSource | null;
  departureActual: Date | null;
  departureSource: OnDemandDepartureSource | null;
  slotId: string | null;
  sourceUpdatedAt: Date | null;
}

export function onDemandDeparturesEnabled(): boolean {
  return process.env.ON_DEMAND_DEPARTURES_ENABLED?.trim().toLowerCase() === "true";
}

function normalized(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

// The duty's start-location slot: Spare's own record of leaving the start
// location. A duty should carry one; if it carries several (a re-planned
// duty), the earliest scheduled non-cancelled one is the departure, because a
// later start-location slot is a return to base mid-duty, not the pullout.
export function startLocationSlot(slots: readonly SpareSlotRecord[]): SpareSlotRecord | null {
  const candidates = slots
    .filter((slot) => normalized(slot.type) === "startlocation" && normalized(slot.status) !== "cancelled")
    .map((slot) => ({ slot, scheduled: spareTimestamp(slot.scheduledTs) }))
    .sort((a, b) => (a.scheduled?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.scheduled?.getTime() ?? Number.MAX_SAFE_INTEGER));
  return candidates[0]?.slot ?? null;
}

function newest(...dates: Array<Date | null>): Date | null {
  const known = dates.filter((date): date is Date => date !== null);
  return known.length === 0 ? null : new Date(Math.max(...known.map((date) => date.getTime())));
}

export function resolveOnDemandDeparture(
  duty: SpareDutyRecord,
  slots: readonly SpareSlotRecord[],
): ResolvedOnDemandDeparture | null {
  const dutyId = spareString(duty.id, 64);
  if (!dutyId) return null;

  const slot = startLocationSlot(slots);
  const slotScheduled = slot ? spareTimestamp(slot.scheduledTs) : null;
  const slotStarted = slot ? spareTimestamp(slot.startedTs) : null;
  const firstSeen = spareTimestamp(duty.metrics?.firstSeenInServiceAreaTs);
  const startRequested = spareTimestamp(duty.startRequestedTs);

  // Scheduled: the slot's time when Spare planned the pullout as a slot,
  // else what the duty was asked to start at.
  const departureScheduled = slotScheduled ?? startRequested;
  const scheduledSource: OnDemandScheduledSource | null =
    slotScheduled ? "slots_startLocation" : startRequested ? "duties_startRequested" : null;

  // Actual: the slot the driver started, else the vehicle turning up in the
  // service area. The fallback applies whether the slot is missing or merely
  // not yet started, which is what the spec's "if actual is null" means.
  const departureActual = slotStarted ?? firstSeen;
  const departureSource: OnDemandDepartureSource | null =
    slotStarted ? "slots_startLocation" : firstSeen ? "duties_firstSeenInServiceArea" : null;

  return {
    dutyId,
    dutyIdentifier: spareString(duty.identifier, 64),
    driverId: spareString(duty.driverId, 64),
    vehicleId: spareString(duty.vehicleId, 64),
    dutyStatus: spareString(duty.status, 32),
    departureScheduled,
    scheduledSource,
    departureActual,
    departureSource,
    slotId: slot ? spareString(slot.id, 64) : null,
    sourceUpdatedAt: newest(spareTimestamp(duty.updatedAt), slot ? spareTimestamp(slot.updatedAt) : null),
  };
}
