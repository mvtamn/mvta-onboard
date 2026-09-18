import { describe, expect, it } from "vitest";
import type { Detour } from "@mvta/shared";
import { managedInLabel, readinessFlags } from "./detourLabels.js";

describe("where a detour is managed", () => {
  const base = { source: "onboard", external_detour_id: null, avail_entry_result: null } as unknown as Detour;

  it("says Avail, and whether the entry is recorded", () => {
    const managed = managedInLabel({ ...base, fulfillment_mode: "avail" } as Detour);
    expect(managed.label).toBe("Avail");
    expect(managed.outside).toBe(false);
    expect(managed.detail).toBeTruthy();
  });

  it("says Outside Avail for a manual path, and which one", () => {
    expect(managedInLabel({ ...base, fulfillment_mode: "fixed_route_manual" } as Detour))
      .toMatchObject({ label: "Outside Avail", detail: "Fixed-route manual", outside: true });
    expect(managedInLabel({ ...base, fulfillment_mode: "mobility_manual" } as Detour))
      .toMatchObject({ label: "Outside Avail", detail: "Mobility manual", outside: true });
  });

  it("does not imply a path that has not been decided", () => {
    const managed = managedInLabel({ ...base, fulfillment_mode: null } as unknown as Detour);
    expect(managed.label).toBe("Not decided");
    expect(managed.outside).toBe(false);
  });
});

describe("what stops OCC acting", () => {
  it("puts an unresolved conflict and an outstanding re-review on the row, worst first", () => {
    expect(readinessFlags({ conflict_status: "unresolved", review_status: "needs_review", conflicts: [] } as unknown as Detour))
      .toEqual([
        { text: "Conflict needs override", bad: true },
        { text: "Needs OCC re-review", bad: true },
      ]);
  });

  it("notes an overridden conflict without calling it a problem", () => {
    expect(readinessFlags({ conflict_status: "overridden", review_status: "current", conflicts: [] } as unknown as Detour))
      .toEqual([{ text: "Conflict overridden", bad: false }]);
  });

  it("says nothing about a detour with nothing in its way", () => {
    expect(readinessFlags({ conflict_status: "none", review_status: "current", conflicts: [] } as unknown as Detour)).toEqual([]);
  });
});
