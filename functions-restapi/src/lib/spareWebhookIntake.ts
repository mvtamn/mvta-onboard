// Load discipline for the Spare webhook receiver.
//
// On 2026-09-05 the receiver took the dev REST app down. Spare delivers
// roughly 5,000 events an hour through a service day, nine in ten of them
// vehicle locations, and once an operational zone was active every delivery
// did real database work: a zones query, then a MERGE. On the single B1 core,
// with a ten-connection pool shared with every poller, deliveries queued for
// minutes each, hundreds sat in flight at once, and the worker pinned at 100%
// CPU until nothing - not even /api/health - answered. A restart bought a few
// minutes before the flood re-saturated it.
//
// Three rules, each pure and clocked so they can be tested:
//
//   1. An intake gate bounds how many deliveries may touch the database at
//      once, gives each a time budget, and after a timeout or failure refuses
//      new work for a short cool-down. Beyond the bound, or during the
//      cool-down, a delivery is answered 503 immediately instead of joining a
//      queue that only grows. Spare retries a 503; a delivery that waited ten
//      minutes to fail was retried anyway, at ten times the cost.
//
//   2. Vehicle-location deliveries for the same duty and vehicle are
//      coalesced: the store only records which vehicle a duty has and when it
//      was last seen, so a second sighting of the same vehicle seconds later
//      carries no new fact. One write per duty per minute keeps that record
//      current at a fiftieth of the load.
//
//   3. The contract diagnostic logs a payload's field names only the first
//      time that set of names is seen per event type. It exists to learn the
//      source contract, and learning it once is enough.
//
// The gate protects the pool for everything else too: a receiver that could
// take all ten connections was starving the pollers behind the KPI feeds.

export interface IntakeGateOptions {
  // Deliveries allowed inside the gate at once. Below the pool size, so the
  // receiver can never hold every connection.
  maxInFlight: number;
  // Longest a delivery may spend inside the gate before it is failed and the
  // gate cools down.
  budgetMs: number;
  // How long the gate refuses work after a timeout or failure.
  cooldownMs: number;
  now?: () => number;
}

export type IntakeOutcome<T> =
  | { kind: "done"; value: T }
  | { kind: "shed"; reason: "in_flight" | "cooling_down" }
  | { kind: "failed"; reason: "timeout" | "error"; error?: unknown };

export class IntakeGate {
  private inFlight = 0;
  private coolingUntil = 0;
  private readonly now: () => number;

  constructor(private readonly options: IntakeGateOptions) {
    this.now = options.now ?? Date.now;
  }

  get state(): { inFlight: number; coolingDown: boolean } {
    return { inFlight: this.inFlight, coolingDown: this.now() < this.coolingUntil };
  }

  async run<T>(work: () => Promise<T>): Promise<IntakeOutcome<T>> {
    if (this.now() < this.coolingUntil) return { kind: "shed", reason: "cooling_down" };
    if (this.inFlight >= this.options.maxInFlight) return { kind: "shed", reason: "in_flight" };
    this.inFlight++;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const value = await Promise.race<T | typeof TIMED_OUT>([
        work(),
        new Promise<typeof TIMED_OUT>((resolve) => {
          timer = setTimeout(() => resolve(TIMED_OUT), this.options.budgetMs);
        }),
      ]);
      if (value === TIMED_OUT) {
        // The work itself keeps running to completion in the background - a
        // query cannot be cancelled from here - but nothing new joins it.
        this.coolingUntil = this.now() + this.options.cooldownMs;
        return { kind: "failed", reason: "timeout" };
      }
      return { kind: "done", value };
    } catch (error) {
      this.coolingUntil = this.now() + this.options.cooldownMs;
      return { kind: "failed", reason: "error", error };
    } finally {
      if (timer) clearTimeout(timer);
      this.inFlight--;
    }
  }
}

const TIMED_OUT = Symbol("timed_out");

// Decides whether a vehicle-location delivery is worth a write. Same duty,
// same vehicle, within the interval: no. Anything else: yes, and remember it.
export class VehicleWriteCoalescer {
  private readonly last = new Map<string, { vehicleId: string; writtenAt: number }>();
  private readonly now: () => number;

  constructor(private readonly intervalMs: number, now?: () => number, private readonly maxEntries = 2_000) {
    this.now = now ?? Date.now;
  }

  shouldWrite(dutyId: string, vehicleId: string): boolean {
    const at = this.now();
    const previous = this.last.get(dutyId);
    if (previous && previous.vehicleId === vehicleId && at - previous.writtenAt < this.intervalMs) return false;
    this.last.set(dutyId, { vehicleId, writtenAt: at });
    if (this.last.size > this.maxEntries) this.evict(at);
    return true;
  }

  private evict(at: number): void {
    for (const [dutyId, entry] of this.last) {
      if (at - entry.writtenAt >= this.intervalMs) this.last.delete(dutyId);
    }
    // Still over after dropping the stale ones: drop the oldest insertions.
    while (this.last.size > this.maxEntries) {
      const oldest = this.last.keys().next().value;
      if (oldest === undefined) break;
      this.last.delete(oldest);
    }
  }
}

// Remembers which field-name sets have been logged per event type.
export class ContractSchemaLog {
  private readonly seen = new Set<string>();

  constructor(private readonly maxEntries = 200) {}

  isNew(eventType: string, schema: unknown): boolean {
    const key = `${eventType}:${JSON.stringify(schema)}`;
    if (this.seen.has(key)) return false;
    if (this.seen.size >= this.maxEntries) return false; // never grow unbounded on a noisy source
    this.seen.add(key);
    return true;
  }
}

// A value that is re-read at most once per interval, serving the last good
// value while a refresh fails, so a transient database fault does not turn
// every delivery into a fault of its own.
export class CachedValue<T> {
  private value: T | undefined;
  private loadedAt = Number.NEGATIVE_INFINITY;
  private pending: Promise<T> | null = null;
  private readonly now: () => number;

  constructor(private readonly load: () => Promise<T>, private readonly ttlMs: number, now?: () => number) {
    this.now = now ?? Date.now;
  }

  async get(): Promise<T> {
    const at = this.now();
    if (this.value !== undefined && at - this.loadedAt < this.ttlMs) return this.value;
    if (!this.pending) {
      this.pending = this.load().then(
        (loaded) => { this.value = loaded; this.loadedAt = this.now(); this.pending = null; return loaded; },
        (error) => {
          this.pending = null;
          if (this.value !== undefined) return this.value;
          throw error;
        },
      );
    }
    return this.pending;
  }

  invalidate(): void {
    this.value = undefined;
    this.loadedAt = Number.NEGATIVE_INFINITY;
  }
}
