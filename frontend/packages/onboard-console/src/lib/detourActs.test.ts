import { describe, expect, it } from "vitest";
import type { Detour, DetourActAvailability, DetourOfferedAct } from "@mvta/shared";
import { actOffer, availEntryOffer } from "./detourActs.js";

const ALL: DetourOfferedAct[] = ["avail_entry.entered", "avail_entry.conflict", "avail_entry.not_entered", "manual_fallback", "close", "override_conflict", "complete_re_review"];

function acts(overrides: Partial<Record<DetourOfferedAct, DetourActAvailability>>): Pick<Detour, "available_acts"> {
  const refused: DetourActAvailability = { available: false, code: "not_allowed_from_state", reason: "Not from this state." };
  return { available_acts: Object.fromEntries(ALL.map((a) => [a, overrides[a] ?? refused])) as Record<DetourOfferedAct, DetourActAvailability> };
}

describe("detour act offers", () => {
  it("offers an available act and hides one that does not apply", () => {
    const d = acts({ close: { available: true } });
    expect(actOffer(d, "close")).toEqual({ show: true, enabled: true, reason: null });
    expect(actOffer(d, "manual_fallback")).toEqual({ show: false, enabled: false, reason: null });
  });

  it("shows a held act disabled, with the reason the API gave", () => {
    const d = acts({ manual_fallback: { available: false, code: "re_review_outstanding", reason: "Mark the re-review complete first." } });
    expect(actOffer(d, "manual_fallback")).toEqual({ show: true, enabled: false, reason: "Mark the re-review complete first." });
  });

  it("offers nothing when the API did not say", () => {
    expect(actOffer({}, "close").show).toBe(false);
    expect(availEntryOffer({}).show).toBe(false);
  });

  it("offers recording an Avail result while confirming it as entered is held by a conflict", () => {
    const offer = availEntryOffer(acts({
      "avail_entry.entered": { available: false, code: "conflict_unresolved", reason: "Record a conflict override first." },
      "avail_entry.conflict": { available: true },
      "avail_entry.not_entered": { available: true },
    }));
    expect(offer.show).toBe(true);
    expect(offer.entered).toEqual({ show: true, enabled: false, reason: "Record a conflict override first." });
  });

  it("does not offer an Avail result once none can be recorded", () => {
    expect(availEntryOffer(acts({})).show).toBe(false);
  });
});
