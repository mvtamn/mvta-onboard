import { describe, expect, it } from "vitest";
import { arrivalClock, arrivalHistory, recordArrival } from "./feedArrivals.js";

const SEC = 1_000;
const MIN = 60_000;
const CADENCE = 5 * MIN;
// A slot boundary on the poller's UTC grid: 01:20:00Z.
const SLOT = Date.parse("2026-09-14T01:20:00Z");

describe("recordArrival", () => {
  // Nine in ten console re-reads return the same delivery time.
  it("adds a delivery once, however many times it is re-read", () => {
    let arrivals: number[] = [];
    for (let read = 0; read < 10; read++) arrivals = recordArrival(arrivals, SLOT + 2 * SEC, CADENCE);
    expect(arrivals).toEqual([SLOT + 2 * SEC]);
  });

  // gtfsDelaysPoll and gtfsMissedTripsPoll both stamp the ledger each slot,
  // seconds apart. Seen on dev in 288 of 288 slots over 24 hours.
  it("treats a second poller's stamp in the same slot as the same delivery", () => {
    const arrivals = recordArrival(recordArrival([], SLOT + 3 * SEC, CADENCE), SLOT + 9 * SEC, CADENCE);
    expect(arrivals).toEqual([SLOT + 3 * SEC]);
  });

  // After a host restart the timer runs a missed occurrence late - on dev the
  // 01:25 poll ran at 01:27:28 as a past-due catch-up.
  it("treats a catch-up run landing later in a delivered slot as the same delivery", () => {
    const arrivals = recordArrival(recordArrival([], SLOT + 5 * MIN + 22 * SEC, CADENCE), SLOT + 7 * MIN + 35 * SEC, CADENCE);
    expect(arrivals).toEqual([SLOT + 5 * MIN + 22 * SEC]);
  });

  it("counts a late catch-up as that slot's delivery when the slot had none", () => {
    const arrivals = recordArrival(recordArrival([], SLOT + 2 * SEC, CADENCE), SLOT + 7 * MIN + 35 * SEC, CADENCE);
    expect(arrivals).toEqual([SLOT + 2 * SEC, SLOT + 7 * MIN + 35 * SEC]);
  });

  it("never moves the clock backwards for an older response", () => {
    const arrivals = recordArrival(recordArrival([], SLOT + CADENCE, CADENCE), SLOT, CADENCE);
    expect(arrivals).toEqual([SLOT + CADENCE]);
  });

  it("ignores a missing delivery time, and collapses only exact repeats without a cadence", () => {
    expect(recordArrival([SLOT], Number.NaN, CADENCE)).toEqual([SLOT]);
    expect(recordArrival([SLOT], SLOT + 9 * SEC, null)).toEqual([SLOT, SLOT + 9 * SEC]);
  });
});

describe("arrivalClock", () => {
  it("is null until a delivery and a cadence are both known", () => {
    expect(arrivalClock([], CADENCE)).toBeNull();
    expect(arrivalClock([SLOT], null)).toBeNull();
  });

  it("anchors to the slot on the poller's grid, not to the stamp", () => {
    expect(arrivalClock([SLOT + 2 * SEC, SLOT + CADENCE + 22 * SEC], CADENCE)).toEqual({
      lastArrivalAt: SLOT + CADENCE + 22 * SEC,
      slotStartAt: SLOT + CADENCE,
      cadenceMs: CADENCE,
    });
  });

  it("uses the slot's first stamp when a slot was recorded twice before the cadence was known", () => {
    expect(arrivalClock([SLOT + 3 * SEC, SLOT + 9 * SEC], CADENCE)).toEqual({
      lastArrivalAt: SLOT + 3 * SEC,
      slotStartAt: SLOT,
      cadenceMs: CADENCE,
    });
  });
});

describe("arrivalHistory", () => {
  it("shows one bar per slot that delivered", () => {
    const arrivals = [SLOT + 2 * SEC, SLOT + CADENCE + 4 * SEC, SLOT + 2 * CADENCE + 3 * SEC];
    expect(arrivalHistory(arrivals, CADENCE, SLOT + 2 * CADENCE + MIN)).toEqual([true, true, true]);
  });

  it("does not add a bar for a second stamp in the same slot", () => {
    const arrivals = [SLOT + 3 * SEC, SLOT + 9 * SEC, SLOT + CADENCE + 3 * SEC];
    expect(arrivalHistory(arrivals, CADENCE, SLOT + CADENCE + MIN)).toEqual([true, true]);
  });

  it("marks the slots a gap between deliveries skipped", () => {
    const arrivals = [SLOT + 2 * SEC, SLOT + 3 * CADENCE + 2 * SEC];
    expect(arrivalHistory(arrivals, CADENCE, SLOT + 3 * CADENCE + MIN)).toEqual([true, false, false, true]);
  });

  // Only deliveries fill bars, so a stopped feed empties them while nobody acts.
  it("keeps adding empty bars while a stopped feed stays silent", () => {
    const arrivals = [SLOT + 2 * SEC, SLOT + CADENCE + 2 * SEC];
    const next = SLOT + 2 * CADENCE;
    expect(arrivalHistory(arrivals, CADENCE, next + 1 * MIN)).toEqual([true, true]);
    expect(arrivalHistory(arrivals, CADENCE, next + 3 * MIN)).toEqual([true, true, false]);
    expect(arrivalHistory(arrivals, CADENCE, next + CADENCE + 1 * MIN)).toEqual([true, true, false]);
    expect(arrivalHistory(arrivals, CADENCE, next + CADENCE + 3 * MIN)).toEqual([true, true, false, false]);
  });

  it("does not count the slot in progress missed while it is only slow to land", () => {
    const arrivals = [SLOT + 2 * SEC];
    expect(arrivalHistory(arrivals, CADENCE, SLOT + CADENCE + 2 * MIN)).toEqual([true]);
  });

  it("keeps the most recent bars and shows none without a cadence", () => {
    const arrivals = Array.from({ length: 9 }, (_, i) => SLOT + i * CADENCE + 2 * SEC);
    expect(arrivalHistory(arrivals, CADENCE, SLOT + 8 * CADENCE + MIN)).toHaveLength(6);
    expect(arrivalHistory(arrivals, null, SLOT)).toEqual([]);
    expect(arrivalHistory([], CADENCE, SLOT)).toEqual([]);
  });
});
