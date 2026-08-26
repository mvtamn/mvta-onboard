import { spareString, spareTimestamp, type SpareRequestRecord } from "./spareApi";
import type { Point } from "./geofence";

export type OnDemandMonitorState = "active" | "completed" | "cancelled";

export interface NormalizedOnDemandRequest {
  requestId: string;
  dutyId: string | null;
  vehicleId: string | null;
  sourceUpdatedAt: Date;
  originalPickupAt: Date | null;
  commitmentAt: Date;
  predictedPickupAt: Date | null;
  pickupArrivedAt: Date | null;
  pickupCoordinate: Point | null;
  state: OnDemandMonitorState;
}

function timestamp(value: unknown): Date | null {
  return spareTimestamp(value)
    ?? (typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value) : null);
}

function coordinate(value: unknown): Point | null {
  if (!value || typeof value !== "object") return null;
  const point = value as Record<string, unknown>;
  const coordinates = point.coordinates;
  if (Array.isArray(coordinates) && coordinates.length >= 2
    && typeof coordinates[0] === "number" && Number.isFinite(coordinates[0])
    && typeof coordinates[1] === "number" && Number.isFinite(coordinates[1])) {
    return [coordinates[0], coordinates[1]];
  }
  const longitude = point.longitude ?? point.lng;
  const latitude = point.latitude ?? point.lat;
  return typeof longitude === "number" && Number.isFinite(longitude)
    && typeof latitude === "number" && Number.isFinite(latitude)
    ? [longitude, latitude]
    : null;
}

function terminalState(status: string | null, pickupArrivedAt: Date | null, cancellationDetails: unknown): OnDemandMonitorState {
  if (pickupArrivedAt) return "completed";
  if (cancellationDetails || status?.toLowerCase().includes("cancel")) return "cancelled";
  if (status?.toLowerCase().includes("complete")) return "completed";
  return "active";
}

// This is the non-PII seam shared by reconciliation and authenticated
// webhooks. Pickup coordinates are used only by the caller for zone resolution.
export function normalizeOnDemandSpareRequest(value: SpareRequestRecord): NormalizedOnDemandRequest | null {
  const requestId = spareString(value.id, 100);
  const sourceUpdatedAt = timestamp(value.updatedAt);
  const originalPickupAt = timestamp(value.initialScheduledPickupTs);
  const commitmentAt = timestamp(value.scheduledPickupTs) ?? timestamp(value.requestedPickupTs);
  if (!requestId || !sourceUpdatedAt || !commitmentAt) return null;

  const pickupArrivedAt = timestamp(value.pickupArrivedTs);
  const status = spareString(value.status, 40);
  return {
    requestId,
    dutyId: spareString(value.dutyId, 100) ?? spareString(value.lockedToDutyId, 100),
    vehicleId: spareString(value.vehicleId, 100),
    sourceUpdatedAt,
    originalPickupAt,
    commitmentAt,
    predictedPickupAt: timestamp(value.estimatedPickupTime),
    pickupArrivedAt,
    pickupCoordinate: coordinate(value.pickupLocation),
    state: terminalState(status, pickupArrivedAt, value.cancellationDetails),
  };
}

export interface SpareEtaUpdate {
  requestId: string;
  pickupAt: Date | null;
  dropoffAt: Date | null;
}

export interface SpareDutyVehicleUpdate {
  dutyId: string;
  vehicleId: string;
  updatedAt: Date;
}

export interface SpareDutyMatchingUpdate {
  dutyId: string;
  isMatchingEnabled: boolean;
}

// ETA has no source timestamp, so callers must not treat these as an
// authoritative state version. Request Status remains the ordering authority.
export function normalizeSpareEtaUpdates(value: unknown): SpareEtaUpdate[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { updates?: unknown }).updates)) return [];
  return (value as { updates: unknown[] }).updates.flatMap((update) => {
    if (!update || typeof update !== "object") return [];
    const item = update as Record<string, unknown>;
    const requestId = spareString(item.requestId, 100);
    return requestId ? [{ requestId, pickupAt: timestamp(item.pickupETA), dropoffAt: timestamp(item.dropoffETA) }] : [];
  });
}

export function normalizeSpareVehicleLocation(value: unknown): SpareDutyVehicleUpdate | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const dutyId = spareString(item.dutyId, 100);
  const vehicleId = spareString(item.vehicleId, 100);
  const updatedAt = timestamp(item.updatedAt);
  return dutyId && vehicleId && updatedAt ? { dutyId, vehicleId, updatedAt } : null;
}

export function normalizeSpareDutyMatchingStatus(value: unknown): SpareDutyMatchingUpdate | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const dutyId = spareString(item.dutyId, 100);
  return dutyId && typeof item.isMatchingEnabled === "boolean"
    ? { dutyId, isMatchingEnabled: item.isMatchingEnabled }
    : null;
}
