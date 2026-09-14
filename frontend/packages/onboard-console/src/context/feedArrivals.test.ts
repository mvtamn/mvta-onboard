import { describe, expect, it } from "vitest";
import { arrivalClock, arrivalHistory, recordArrival } from "./feedArrivals.js";

const MIN = 60_000;
const CADENCE = 5 * MIN;
const T0 = Date.parse("2026-09-13T19:30:00-05:00");

describe("recordArrival", () => {
  // Nine in ten console re-reads return the same delivery time.
  it("adds a delivery once, however many times it is re-read", () => {
    let arrivals: number[] = [];
    for (let read = 0; read < 10; read++) arrivals = recordArrival(arrivals, T0);
    expect(arrivals).toEqual([T0]);
  });

  it("never moves the clock backwards for an older response", () => {
    const arrivals = recordArrival(recordArrival([], T0 + CADENCE), T0);
    expect(arrivals).toEqual([T0 + CADENCE]);
  });

  it("ignores a missing delivery time", () => {
    expect(recordArrival([T0], Number.NaN)).toEqual([T0]);
  });
});

describe("arrivalClock", () => {
  it("is null until a delivery and a cadence are both known", () => {
    expect(arrivalClock([], CADENCE)).toBeNull();
    expect(arrivalClock([T0], null)).toBeNull();
    expect(arrivalClock([T0, T0 + CADENCE], CADENCE)).toEqual({ lastArrivalAt: T0 + CADENCE, cadenceMs: CADENCE });
  });
});

describe("arrivalHistory", () => {
  it("shows one bar per delivery when the feed keeps its cadence", () => {
    const arrivals = [T0, T0 + CADENCE, T0 + 2 * CADENCE];
    expect(arrivalHistory(arrivals, CADENCE, T0 + 2 * CADENCE + MIN)).toEqual([true, true, true]);
  });

  it("marks the slots a gap between deliveries skipped", () => {
    const arrivals = [T0, T0 + 3 * CADENCE];
    expect(arrivalHistory(arrivals, CADENCE, T0 + 3 * CADENCE)).toEqual([true, false, false, true]);
  });

  // The console re-reads every 30 seconds; the feed delivers every five minutes.
  // Only deliveries fill bars, so a stopped feed empties them while nobody acts.
  it("keeps adding empty bars while a stopped feed stays silent", () => {
    const arrivals = [T0, T0 + CADENCE];
    const last = T0 + CADENCE;
    expect(arrivalHistory(arrivals, CADENCE, last + 2 * MIN)).toEqual([true, true]);
    expect(arrivalHistory(arrivals, CADENCE, last + 8 * MIN)).toEqual([true, true, false]);
    expect(arrivalHistory(arrivals, CADENCE, last + 13 * MIN)).toEqual([true, true, false, false]);
  });

  it("does not count a delivery missed while it is only slow to land", () => {
    const arrivals = [T0, T0 + CADENCE + 2 * MIN];
    expect(arrivalHistory(arrivals, CADENCE, T0 + CADENCE + 2 * MIN)).toEqual([true, true]);
  });

  it("keeps the most recent bars and shows none without a cadence", () => {
    const arrivals = Array.from({ length: 9 }, (_, i) => T0 + i * CADENCE);
    expect(arrivalHistory(arrivals, CADENCE, T0 + 8 * CADENCE)).toHaveLength(6);
    expect(arrivalHistory(arrivals, null, T0)).toEqual([]);
    expect(arrivalHistory([], CADENCE, T0)).toEqual([]);
  });
});
