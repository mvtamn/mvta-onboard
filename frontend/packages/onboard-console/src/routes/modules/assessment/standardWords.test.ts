import { describe, expect, it } from "vitest";
import { kindLabel, standardWords } from "./standardWords.js";

const missedTrips = { standard_type: "occurrence" as const, measurement_source: "onboard_compliance" as const, source_system: null, unit_label: "occurrences", assigned_to: "Rob", responsible_team: "Operations Control" };
const roadCalls = { standard_type: "threshold" as const, measurement_source: "structured_import" as const, source_system: "Nexus", unit_label: "miles", assigned_to: "Maurice", responsible_team: null };

describe("standardWords", () => {
  it("says what kind of figure it is and where it comes from", () => {
    expect(standardWords(missedTrips)).toBe("Counted events · from OnBoard");
    expect(standardWords(roadCalls)).toBe("Monthly value · from Nexus");
    expect(kindLabel("threshold")).toBe("Monthly value");
  });
  it("adds the unit, the team and the owner only when asked, and only when set", () => {
    expect(standardWords(missedTrips, { owner: true })).toBe("Counted events · from OnBoard · Rob");
    expect(standardWords(missedTrips, { team: true, owner: true })).toBe("Counted events · from OnBoard · Operations Control · Rob");
    expect(standardWords(roadCalls, { unit: true, team: true, owner: true })).toBe("Monthly value · from Nexus · miles · Maurice");
    expect(standardWords({ ...roadCalls, assigned_to: null }, { owner: true })).toBe("Monthly value · from Nexus");
  });
});
