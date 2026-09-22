import { describe, expect, it } from "vitest";
import type { ReducedServiceMonth } from "@mvta/shared";
import { dayName, evidenceText, listDays, reducedServiceNote } from "./reducedServiceNote";

const september = (over: Partial<ReducedServiceMonth> = {}): ReducedServiceMonth => ({
  days: [{
    id: "d1", service_date: "20260907", day_of_week: "Mon", label: "Labor Day",
    schedule_operated: "Sunday schedule", notes: null,
    declared_by: "occ@example.com", declared_at: "2026-09-22T12:00:00Z",
  }],
  evidence: [{ service_date: "20260907", coverage: "corroborated", departures: 1043, typical: 2574.5, share: 0.405 }],
  affected_day_of_week: ["Mon"],
  ...over,
});

describe("the reduced-service note", () => {
  it("says nothing at all when no day is declared", () => {
    // Not an empty reassurance: most months are ordinary and deserve no note.
    expect(reducedServiceNote({ days: [], evidence: [], affected_day_of_week: [] })).toBeNull();
    expect(reducedServiceNote(null)).toBeNull();
  });

  it("names the affected bucket and why it is affected", () => {
    const note = reducedServiceNote(september())!;
    expect(note.headline).toMatch(/Monday figures include 1 day that did not run a normal schedule/);
    expect(note.headline).toMatch(/Avail groups by day of week/);
  });

  it("carries the feed's corroboration where it has it", () => {
    expect(reducedServiceNote(september())!.days).toEqual([
      "09/07 — Labor Day, Sunday schedule (ran 41% of a normal day's departures)",
    ]);
  });

  it("asks for the date to be checked when the feed contradicts the declaration", () => {
    const note = reducedServiceNote(september({
      evidence: [{ service_date: "20260907", coverage: "contradicted", departures: 2560, typical: 2574.5, share: 0.994 }],
    }))!;
    expect(note.days[0]).toMatch(/ran 99% of a normal day's departures — check the date/);
  });

  it("stays quiet about evidence it does not have, rather than printing 'no data'", () => {
    // The daily feed holds nothing before 2026-09-14, so most declarations
    // will have none; saying so on every line would bury the ones that do.
    for (const coverage of ["no_daily_data", "insufficient_comparison"] as const) {
      const note = reducedServiceNote(september({
        evidence: [{ service_date: "20260907", coverage, departures: null, typical: null, share: null }],
      }))!;
      expect(note.days[0]).toBe("09/07 — Labor Day, Sunday schedule");
    }
  });

  it("reads as a sentence when several buckets are affected", () => {
    expect(listDays(["Mon"])).toBe("Monday");
    expect(listDays(["Mon", "Thur"])).toBe("Monday and Thursday");
    expect(listDays(["Mon", "Thur", "Fri"])).toBe("Monday, Thursday and Friday");
    expect(listDays([])).toBe("");
  });

  it("spells Avail's own abbreviations out in full", () => {
    // The feed says Tues and Thur; a sentence should not.
    expect(dayName("Tues")).toBe("Tuesday");
    expect(dayName("Thur")).toBe("Thursday");
    // An abbreviation nobody has seen before is shown as it came.
    expect(dayName("Weekday")).toBe("Weekday");
  });

  it("has nothing to say without a share to report", () => {
    expect(evidenceText(undefined)).toBeNull();
    expect(evidenceText({ service_date: "x", coverage: "corroborated", departures: 1, typical: null, share: null })).toBeNull();
  });
});
