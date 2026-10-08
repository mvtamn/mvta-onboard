import { describe, expect, it } from "vitest";
import { formatMvtaLocal, instantToMvtaLocal, mvtaLocalToInstant } from "./mvtaLocalTime.js";

// These run wherever the test process's timezone happens to be, which is the
// point: the defect was that every conversion used the machine's own zone.
describe("MVTA-local time", () => {
  it("reads a winter wall clock as Central Standard Time", () => {
    // 18:00 at the garage on a January evening is 00:00 UTC, CST being -6.
    expect(mvtaLocalToInstant("2026-01-15T18:00")?.toISOString()).toBe("2026-01-16T00:00:00.000Z");
  });

  it("reads a summer wall clock as Central Daylight Time", () => {
    // The same wall clock in July is an hour earlier in UTC, CDT being -5.
    expect(mvtaLocalToInstant("2026-07-15T18:00")?.toISOString()).toBe("2026-07-15T23:00:00.000Z");
  });

  it("does not depend on the machine's timezone", () => {
    // A browser in UTC used to store 18:00 UTC for a period meant as 18:00
    // Central - six hours adrift, and every later read repeated the error so
    // nothing looked wrong.
    const instant = mvtaLocalToInstant("2026-01-15T18:00")!;
    expect(instant.toISOString()).not.toBe("2026-01-15T18:00:00.000Z");
  });

  it("round-trips a wall clock through an instant and back", () => {
    for (const wall of ["2026-01-15T18:00", "2026-07-15T06:30", "2026-11-01T23:45", "2026-03-09T00:15"]) {
      expect(instantToMvtaLocal(mvtaLocalToInstant(wall)!)).toBe(wall);
    }
  });

  it("keeps an overnight period in order across midnight", () => {
    const start = mvtaLocalToInstant("2026-07-04T21:00")!;
    const end = mvtaLocalToInstant("2026-07-05T02:00")!;
    expect(start.getTime()).toBeLessThan(end.getTime());
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(5);
  });

  describe("daylight saving", () => {
    it("holds an overnight period across spring forward to four real hours", () => {
      // 2026-03-08: the clock goes 02:00 -> 03:00. 23:00 to 04:00 reads as five
      // hours on the wall and is four hours of service.
      const start = mvtaLocalToInstant("2026-03-07T23:00")!;
      const end = mvtaLocalToInstant("2026-03-08T04:00")!;
      expect((end.getTime() - start.getTime()) / 3_600_000).toBe(4);
    });

    it("holds an overnight period across fall back to six real hours", () => {
      // 2026-11-01: the clock goes 02:00 -> 01:00. 23:00 to 04:00 reads as five
      // hours on the wall and is six hours of service.
      const start = mvtaLocalToInstant("2026-10-31T23:00")!;
      const end = mvtaLocalToInstant("2026-11-01T04:00")!;
      expect((end.getTime() - start.getTime()) / 3_600_000).toBe(6);
    });

    it("resolves a wall clock inside the spring-forward gap to the instant the hour reaches", () => {
      // 02:30 on 2026-03-08 never happens. It is 03:30 CDT, which is what a
      // window written across the gap means - not a rejected period.
      const instant = mvtaLocalToInstant("2026-03-08T02:30")!;
      expect(instant.toISOString()).toBe("2026-03-08T08:30:00.000Z");
      expect(instantToMvtaLocal(instant)).toBe("2026-03-08T03:30");
    });

    it("resolves a repeated fall-back wall clock to the first time it happens", () => {
      // 01:30 on 2026-11-01 happens twice. The first is still CDT (-5), so an
      // evening period does not silently gain an hour.
      expect(mvtaLocalToInstant("2026-11-01T01:30")?.toISOString()).toBe("2026-11-01T06:30:00.000Z");
    });

    it("keeps the hour either side of each transition distinct", () => {
      const beforeSpring = mvtaLocalToInstant("2026-03-08T01:30")!;
      const afterSpring = mvtaLocalToInstant("2026-03-08T03:30")!;
      expect((afterSpring.getTime() - beforeSpring.getTime()) / 3_600_000).toBe(1);
      const beforeFall = mvtaLocalToInstant("2026-11-01T00:30")!;
      const afterFall = mvtaLocalToInstant("2026-11-01T02:30")!;
      expect((afterFall.getTime() - beforeFall.getTime()) / 3_600_000).toBe(3);
    });
  });

  it("refuses anything that is not a wall clock rather than inventing one", () => {
    // Shape is not validity: Date.UTC rolls month 99 over into 2034 and day 32
    // into the next month rather than refusing either.
    for (const bad of ["", "   ", "2026-99-01T00:00", "2026-13-01T00:00", "2026-02-30T00:00", "2026-01-32T00:00", "2026-01-15T25:00", "2026-01-15T10:61", "not a date", "2026-01-15", "15/01/2026 18:00"]) {
      expect(mvtaLocalToInstant(bad)).toBeNull();
    }
  });

  it("displays an instant on the agency clock, not the viewer's", () => {
    expect(formatMvtaLocal("2026-01-16T00:00:00.000Z")).toBe("Jan 15, 2026 at 6:00 PM".replace(" at ", ", "));
    expect(instantToMvtaLocal(null)).toBe("");
    expect(formatMvtaLocal(undefined)).toBe("");
  });
});
