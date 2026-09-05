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
  vehicleId?: unknown;
  lockedToDutyId?: unknown;
  serviceId?: unknown;
  serviceBrand?: unknown;
  requestedPickupTs?: unknown;
  initialScheduledPickupTs?: unknown;
  scheduledPickupTs?: unknown;
  estimatedPickupTime?: unknown;
  pickupArrivedTs?: unknown;
  pickupLocation?: unknown;
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

// A driver/vehicle shift. Read for on-demand garage departure only: the
// duty's requested start stands in for a scheduled departure when Spare has
// no startLocation slot, and metrics.firstSeenInServiceAreaTs stands in for
// the actual (onboard-spare-integration-spec.md section 6.3). Driver and
// vehicle are ids, never names.
export interface SpareDutyRecord {
  id?: unknown;
  updatedAt?: unknown;
  identifier?: unknown;
  driverId?: unknown;
  vehicleId?: unknown;
  status?: unknown;
  startRequestedTs?: unknown;
  endRequestedTs?: unknown;
  metrics?: {
    firstSeenInServiceAreaTs?: unknown;
    lastSeenInServiceAreaTs?: unknown;
  } | null;
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

export function assertSpareSlotsFilter(query: URLSearchParams): void {
  if (!["dutyId", "requestId", "ids"].some((name) => query.get(name)?.trim())) {
    throw new Error("Spare /v1/slots requires dutyId, requestId, or ids");
  }
}

export async function fetchSparePage<T>(
  path: string,
  query: URLSearchParams,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<SparePage<T>> {
  if (path === "/v1/slots") assertSpareSlotsFilter(query);
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

async function fetchSpareResource<T>(
  collection: "/v1/requests" | "/v1/duties",
  id: string,
  timeoutMs: number,
): Promise<T> {
  const response = await fetch(`${configuredBaseUrl()}${collection}/${encodeURIComponent(id)}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${configuredToken()}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Spare ${collection}/{id} returned HTTP ${response.status}`);
  const value = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Spare ${collection}/{id} returned an unexpected payload`);
  }
  return value as T;
}

export function fetchSpareRequest<T>(requestId: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  return fetchSpareResource<T>("/v1/requests", requestId, timeoutMs);
}

// One duty by id. The duties list endpoint is confirmed to exist, but which
// list filters it honours is not, so the departure poll reads each duty it
// already knows about by id rather than guessing at a bulk filter.
export function fetchSpareDuty(dutyId: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<SpareDutyRecord> {
  return fetchSpareResource<SpareDutyRecord>("/v1/duties", dutyId, timeoutMs);
}
