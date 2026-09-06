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
// Pure: the poll fetches and stores, this decides. The departure itself
// carries ids only; the label resolvers below turn a vehicle id into its
// fleet number and a driver id into a name, the way the fixed-route feed
// already names its operators, so that the two views read alike.
import { spareString, spareTimestamp, type SpareDriverRecord, type SpareDutyRecord, type SpareSlotRecord, type SpareVehicleRecord } from "./spareApi";

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

// Remembers a label per Spare id so the poll does not ask Spare the same
// question for every duty of every run. A failed read is remembered too, for
// a shorter while, so an outage at Spare costs one call per id per hour
// rather than one per duty per run - and the departure is still stored, with
// the id and no label, because the label is a convenience and the departure
// is the record.
class LabelCache<L> {
  private readonly labels = new Map<string, { label: L | null; at: number }>();
  private readonly now: () => number;

  constructor(
    private readonly ttlMs: number,
    private readonly failureTtlMs: number,
    now?: () => number,
  ) {
    this.now = now ?? Date.now;
  }

  async get(id: string, read: () => Promise<L | null>): Promise<L | null> {
    const at = this.now();
    const known = this.labels.get(id);
    if (known && at - known.at < (known.label === null ? this.failureTtlMs : this.ttlMs)) return known.label;
    let label: L | null = null;
    try {
      label = await read();
    } catch {
      label = null;
    }
    this.labels.set(id, { label, at });
    return label;
  }

  get size(): number {
    return this.labels.size;
  }
}

// Resolves a Spare vehicle id to its fleet number.
export class VehicleLabelResolver {
  private readonly cache: LabelCache<string>;

  constructor(
    private readonly fetch: (vehicleId: string) => Promise<SpareVehicleRecord>,
    ttlMs = 24 * 60 * 60_000,
    failureTtlMs = 60 * 60_000,
    now?: () => number,
  ) {
    this.cache = new LabelCache<string>(ttlMs, failureTtlMs, now);
  }

  label(vehicleId: string): Promise<string | null> {
    return this.cache.get(vehicleId, async () => spareString((await this.fetch(vehicleId)).identifier, 64));
  }

  get size(): number {
    return this.cache.size;
  }
}

// What the console shows for a driver: the name in the fixed-route feed's
// "Last, First" order, and Spare's driver identifier when the agency keeps
// one (the counterpart of Avail's badge). A record with neither is no label.
export interface DriverLabel {
  name: string | null;
  identifier: string | null;
}

export function driverLabelFrom(record: SpareDriverRecord): DriverLabel | null {
  const first = spareString(record.firstName, 64);
  const last = spareString(record.lastName, 64);
  const name = last && first ? `${last}, ${first}` : last ?? first;
  const identifier = spareString(record.identifier, 64);
  return name || identifier ? { name, identifier } : null;
}

// Resolves a Spare driver id to its label, once per driver per day.
export class DriverLabelResolver {
  private readonly cache: LabelCache<DriverLabel>;

  constructor(
    private readonly fetch: (driverId: string) => Promise<SpareDriverRecord>,
    ttlMs = 24 * 60 * 60_000,
    failureTtlMs = 60 * 60_000,
    now?: () => number,
  ) {
    this.cache = new LabelCache<DriverLabel>(ttlMs, failureTtlMs, now);
  }

  label(driverId: string): Promise<DriverLabel | null> {
    return this.cache.get(driverId, async () => driverLabelFrom(await this.fetch(driverId)));
  }

  get size(): number {
    return this.cache.size;
  }
}
