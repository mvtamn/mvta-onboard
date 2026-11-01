import { describe, expect, it } from "vitest";
import type { FirstStopRecord } from "@mvta/shared";
import { barDraftErrors, barSummary, deadZoneRows, isLikelyDeadZone } from "./deadZoneBar.js";

const LIMITS = { ran_percent: { min: 50, max: 100 }, min_cases: { min: 3, max: 50 } };
// Dev, 2026-11-01: the five stops both feeds pointed at.
const STOPS: FirstStopRecord[] = [
  { stop_id: "1", name: "Savage Park & Ride", cases: 52, ran: 49 },
  { stop_id: "2", name: "Mystic Lake Casino", cases: 24, ran: 17 },
  { stop_id: "3", name: "Apple Valley Transit Station NB", cases: 14, ran: 10 },
  { stop_id: "4", name: "MSP Terminal 1 Transit Station", cases: 12, ran: 11 },
  { stop_id: "5", name: "Gateway Ramp", cases: 11, ran: 11 },
  { stop_id: "6", name: null, cases: 3, ran: 3 },
];
const SAVED = { ran_percent: 80, min_cases: 5 };

describe("the dead-zone bar", () => {
  it("is the server's rule: enough cases, and enough of them run", () => {
    expect(isLikelyDeadZone(5, 4, SAVED)).toBe(true);
    expect(isLikelyDeadZone(4, 4, SAVED)).toBe(false);
    expect(isLikelyDeadZone(0, 0, { ran_percent: 50, min_cases: 0 })).toBe(false);
  });

  it("shows each stop's share and whether the saved bar flags it", () => {
    const rows = deadZoneRows(STOPS, SAVED, SAVED);
    expect(rows.map((r) => [r.name, r.percent, r.flagged])).toEqual([
      ["Savage Park & Ride", 94, true],
      ["Mystic Lake Casino", 70, false],
      ["Apple Valley Transit Station NB", 71, false],
      ["MSP Terminal 1 Transit Station", 91, true],
      ["Gateway Ramp", 100, true],
      ["Stop 6", 100, false],
    ]);
    expect(rows.every((r) => r.change === null)).toBe(true);
  });

  it("marks the stops a draft bar would add or drop", () => {
    const lower = deadZoneRows(STOPS, SAVED, { ran_percent: 70, min_cases: 3 });
    expect(lower.filter((r) => r.change === "added").map((r) => r.name)).toEqual([
      "Mystic Lake Casino", "Apple Valley Transit Station NB", "Stop 6",
    ]);
    const higher = deadZoneRows(STOPS, SAVED, { ran_percent: 95, min_cases: 5 });
    expect(higher.filter((r) => r.change === "removed").map((r) => r.name)).toEqual([
      "Savage Park & Ride", "MSP Terminal 1 Transit Station",
    ]);
  });

  it("says how many stops the draft flags against the saved bar", () => {
    expect(barSummary(deadZoneRows(STOPS, SAVED, SAVED))).toBe("3 of 6 stops are flagged.");
    expect(barSummary(deadZoneRows(STOPS, SAVED, { ran_percent: 70, min_cases: 3 }))).toBe("6 of 6 stops would be flagged, up from 3.");
    expect(barSummary(deadZoneRows(STOPS, SAVED, { ran_percent: 100, min_cases: 5 }))).toBe("1 of 6 stops would be flagged, down from 3.");
    expect(barSummary([])).toBe("No first stop has a judged no-show yet.");
  });

  it("refuses a draft outside the declared range, or not a whole number", () => {
    expect(barDraftErrors({ ran_percent: "80", min_cases: "5" }, LIMITS)).toEqual({});
    expect(barDraftErrors({ ran_percent: "45", min_cases: "5" }, LIMITS)).toEqual({ ran_percent: "Enter a whole percent from 50 to 100." });
    expect(barDraftErrors({ ran_percent: "80.5", min_cases: "" }, LIMITS)).toEqual({
      ran_percent: "Enter a whole percent from 50 to 100.",
      min_cases: "Enter a whole number from 3 to 50.",
    });
  });
});
