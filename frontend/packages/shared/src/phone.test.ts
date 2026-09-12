import { describe, it, expect } from "vitest";
import { normalizeUsPhone, isE164, formatE164ForDisplay } from "./phone.js";

describe("normalizeUsPhone", () => {
  it("accepts the shapes riders actually type", () => {
    // The number from the failing opt-in: 11 digits, no plus.
    expect(normalizeUsPhone("19523883275")).toBe("+19523883275");
    expect(normalizeUsPhone("9523883275")).toBe("+19523883275");
    expect(normalizeUsPhone("952-388-3275")).toBe("+19523883275");
    expect(normalizeUsPhone("(952) 388-3275")).toBe("+19523883275");
    expect(normalizeUsPhone("1 (952) 388-3275")).toBe("+19523883275");
  });

  it("keeps an explicit country code and strips its punctuation", () => {
    // The form's own placeholder — rejected verbatim by the API before this.
    expect(normalizeUsPhone("+1 612 555 0142")).toBe("+16125550142");
    expect(normalizeUsPhone("+44 20 7946 0958")).toBe("+442079460958");
  });

  it("returns null rather than sending something the API will reject", () => {
    expect(normalizeUsPhone("")).toBeNull();
    expect(normalizeUsPhone("   ")).toBeNull();
    expect(normalizeUsPhone("555-0142")).toBeNull();
    expect(normalizeUsPhone("952388327")).toBeNull();
    expect(normalizeUsPhone("29523883275")).toBeNull();
    expect(normalizeUsPhone("not a phone")).toBeNull();
    expect(normalizeUsPhone("+0123456789")).toBeNull();
  });

  it("produces values the API's E.164 rule accepts", () => {
    for (const typed of ["19523883275", "952-388-3275", "+1 612 555 0142"]) {
      expect(isE164(normalizeUsPhone(typed)!)).toBe(true);
    }
  });
});

describe("formatE164ForDisplay", () => {
  it("makes a US number readable and leaves others alone", () => {
    expect(formatE164ForDisplay("+19523883275")).toBe("+1 (952) 388-3275");
    expect(formatE164ForDisplay("+442079460958")).toBe("+442079460958");
  });
});
