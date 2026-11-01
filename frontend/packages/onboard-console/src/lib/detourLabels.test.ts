import { describe, expect, it } from "vitest";
import type { Detour, DetourWorkflowHistoryEntry } from "@mvta/shared";
import { availEntryLabel, communicationStatusLabel, fulfillmentPathLabel, historyEventLabel, managedInLabel, nextStepLabel, otherRecordStatusLabel, readinessFlags, readinessLabel, workflowLabel } from "./detourLabels.js";

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
      .toMatchObject({ label: "Outside Avail", detail: "Fixed route, run manually", outside: true });
    expect(managedInLabel({ ...base, fulfillment_mode: "mobility_manual" } as Detour))
      .toMatchObject({ label: "Outside Avail", detail: "Mobility, run manually", outside: true });
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
        { text: "Overlaps another detour — override needed", bad: true },
        { text: "Needs OCC re-review", bad: true },
      ]);
  });

  it("notes an overridden conflict without calling it a problem", () => {
    expect(readinessFlags({ conflict_status: "overridden", review_status: "current", conflicts: [] } as unknown as Detour))
      .toEqual([{ text: "Overlap overridden", bad: false }]);
  });

  it("says nothing about a detour with nothing in its way", () => {
    expect(readinessFlags({ conflict_status: "none", review_status: "current", conflicts: [] } as unknown as Detour)).toEqual([]);
  });
});

describe("plain words for stored values", () => {
  it("names the workflow state by what happened, which depends on the mode", () => {
    expect(workflowLabel({ lifecycle_state: "awaiting_fulfillment", fulfillment_mode: "avail" })).toBe("Waiting for Avail entry");
    expect(workflowLabel({ lifecycle_state: "fulfilled", fulfillment_mode: "avail" })).toBe("Built in Avail");
    // A manual Detour starts fulfilled: "Fulfilled" said the opposite of what had happened.
    expect(workflowLabel({ lifecycle_state: "fulfilled", fulfillment_mode: "fixed_route_manual" })).toBe("Running manually");
    expect(workflowLabel({ lifecycle_state: "fulfilled", fulfillment_mode: "mobility_manual" })).toBe("Running manually");
    expect(workflowLabel({ lifecycle_state: "fulfillment_failed", fulfillment_mode: "avail" })).toBe("Avail entry failed");
  });

  it("gives each mode one name", () => {
    expect(fulfillmentPathLabel({ fulfillment_mode: "avail" })).toBe("Build in Avail");
    expect(fulfillmentPathLabel({ fulfillment_mode: "fixed_route_manual" })).toBe("Fixed route, run manually");
    expect(fulfillmentPathLabel({ fulfillment_mode: "mobility_manual" })).toBe("Mobility, run manually");
  });

  it("keeps Avail refusing an entry apart from an overlap", () => {
    expect(nextStepLabel("avail_conflict")).toBe("Avail refused it — retry or run it manually");
    expect(readinessLabel({ readiness: "in_avail", review_status: "current", conflict_status: "unresolved" })).toBe("In Avail · Overlaps another detour — override needed");
    expect(availEntryLabel({ fulfillment_mode: "avail", avail_entry_result: "conflict" })).toBe("Avail refused it");
    expect(availEntryLabel({ fulfillment_mode: "avail", avail_entry_result: "not_entered" })).toBe("Not built yet");
  });

  it("says all audiences told, and that none are named when the record names none", () => {
    expect(communicationStatusLabel({ communication_status: "published" })).toBe("All audiences told");
    expect(communicationStatusLabel({ communication_status: "needs_communication", required_audiences: [] })).toBe("No audiences named");
    expect(communicationStatusLabel({ communication_status: "needs_communication", required_audiences: ["Operators"] })).toBe("Needs communication");
    // An older server sends no list: do not claim there are none.
    expect(communicationStatusLabel({ communication_status: "needs_communication" })).toBe("Needs communication");
  });

  it("names another record's state without underscores", () => {
    expect(otherRecordStatusLabel({ kind: "detour", status: "awaiting_fulfillment" })).toBe("Waiting for Avail entry");
    expect(otherRecordStatusLabel({ kind: "detour", status: "recorded" })).toBe("Recorded");
    expect(otherRecordStatusLabel({ kind: "intake", status: "pending_review" }, { pending_review: "Pending OCC review" })).toBe("Pending OCC review");
  });
});

describe("history event names", () => {
  const entry = (
    event_type: DetourWorkflowHistoryEntry["event_type"],
    detail: string | null,
    from_state: DetourWorkflowHistoryEntry["from_state"] = "fulfilled",
    to_state: DetourWorkflowHistoryEntry["to_state"] = "fulfilled",
  ) => ({ event_type, detail, from_state, to_state });

  it("calls every Avail result recorded, not confirmed", () => {
    expect(historyEventLabel(entry("fulfillment_confirmation", "Avail result: Avail refused it", "awaiting_fulfillment", "fulfillment_failed"))).toBe("Avail result recorded");
  });

  it("tells the corrections apart from the detail the server writes", () => {
    expect(historyEventLabel(entry("manual_correction", "Assigned to Dispatcher A"))).toBe("Owner changed");
    expect(historyEventLabel(entry("manual_correction", "Owner cleared"))).toBe("Owner changed");
    expect(historyEventLabel(entry("manual_correction", "Conflict override: different stops (conflicts: MVTA-DET-2026-0003)"))).toBe("Overlap overridden");
    expect(historyEventLabel(entry("manual_correction", "OCC re-review completed (raised: dates changed)"))).toBe("Re-review done");
    expect(historyEventLabel(entry("manual_correction", "Manual correction to authoritative Detour fields; OCC re-review required", null))).toBe("Edited");
    expect(historyEventLabel(entry("manual_correction", "Avail would not take the shape", "fulfillment_failed", "fulfilled"))).toBe("Switched to running manually");
    expect(historyEventLabel(entry("manual_correction", "Something else entirely"))).toBe("Correction");
  });
});
