import { describe, expect, it } from "vitest";
import { crossingEvidenceLabel } from "./crossingEvidence.js";

describe("crossingEvidenceLabel", () => {
  it("shows the evidence retained for an interpolated boundary movement", () => {
    expect(crossingEvidenceLabel({
      detection_method: "path_interpolated",
      source_report_from_at: "2026-08-22T12:00:00Z",
      source_report_to_at: "2026-08-22T12:00:15Z",
      source_displacement_meters: 123.4,
    })).toBe("GPS path detected · 15 sec between reports · 123 m moved");
  });

  it("keeps confirmed point crossings understandable", () => {
    expect(crossingEvidenceLabel({ detection_method: "point_confirmed" })).toBe("Confirmed by two GPS reports");
  });
});
