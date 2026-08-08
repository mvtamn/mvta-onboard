const DEFAULT_BASE_URL = "https://api.us.sparelabs.com";
const DEFAULT_TIMEOUT_MS = 30_000;

export interface SparePage<T> {
  total: number;
  limit: number;
  skip: number;
  data: T[];
}

export interface SpareCancellationDetails {
  fault?: unknown;
  cancelledBy?: unknown;
  reason?: unknown;
}

export interface SpareRequestRecord {
  id?: unknown;
  updatedAt?: unknown;
  status?: unknown;
  dutyId?: unknown;
  lockedToDutyId?: unknown;
  serviceId?: unknown;
  serviceBrand?: unknown;
  initialScheduledPickupTs?: unknown;
  scheduledPickupTs?: unknown;
  pickupArrivedTs?: unknown;
  initialScheduledDropoffTs?: unknown;
  scheduledDropoffTs?: unknown;
  dropoffArrivedTs?: unknown;
  cancellationDetails?: SpareCancellationDetails | null;
  lateness?: {
    pickupLateness?: unknown;
    dropoffLateness?: unknown;
  } | null;
}

export interface SpareSlotRecord {
  id?: unknown;
  updatedAt?: unknown;
  status?: unknown;
  dutyId?: unknown;
  requestId?: unknown;
  type?: unknown;
  scheduledTs?: unknown;
  startedTs?: unknown;
  arrivedTs?: unknown;
  completedTs?: unknown;
  cancelledTs?: unknown;
}

export function spareString(value: unknown, maxLength = 256): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, maxLength) : null;
}

export function spareNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function spareTimestamp(value: unknown): Date | null {
  const seconds = spareNumber(value);
  if (seconds === null || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function spareServiceName(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  return spareString((value as Record<string, unknown>).name, 128);
}

function configuredBaseUrl(): string {
  return (process.env.SPARE_API_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");
}

function configuredToken(): string {
  const token = process.env.SPARE_API_KEY?.trim();
  if (!token) throw new Error("SPARE_API_KEY is not configured");
  return token;
}

function validPage<T>(payload: unknown): SparePage<T> | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  if (!Array.isArray(value.data)) return null;
  const total = spareNumber(value.total);
  const limit = spareNumber(value.limit);
  const skip = spareNumber(value.skip);
  if (total === null || limit === null || skip === null) return null;
  return { total, limit, skip, data: value.data as T[] };
}

export async function fetchSparePage<T>(
  path: string,
  query: URLSearchParams,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<SparePage<T>> {
  const response = await fetch(`${configuredBaseUrl()}${path}?${query.toString()}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${configuredToken()}`,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    // Do not include the response body: Spare errors can echo request data.
    throw new Error(`Spare ${path} returned HTTP ${response.status}`);
  }
  const page = validPage<T>(await response.json());
  if (!page) throw new Error(`Spare ${path} returned an unexpected response envelope`);
  return page;
}
