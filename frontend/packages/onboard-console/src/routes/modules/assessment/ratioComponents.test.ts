import { describe, expect, it } from "vitest";
import { ratioComponents, ratioText, ratioValue } from "./ratioComponents.js";

describe("ratioComponents", () => {
  it("names miles and chargeable road calls for Average Miles Between Road Calls", () => {
    const parts = ratioComponents({ code: "AVG_MILES_ROAD_CALLS" });
    expect(parts?.numerator).toEqual({ label: "Miles operated", unit: "miles" });
    expect(parts?.denominator).toEqual({ label: "Chargeable road calls", unit: "road calls" });
  });

  it("knows nothing about a standard typed whole", () => {
    expect(ratioComponents({ code: "OPERATOR_CONDUCT" })).toBeNull();
  });
});

describe("ratioValue", () => {
  it("divides and rounds to the whole unit", () => {
    expect(ratioValue(412_300, 31)).toBe(13_300);
    expect(ratioValue(100, 3)).toBe(33);
  });

  it("records the miles run as the figure when there were no road calls", () => {
    expect(ratioValue(412_300, 0)).toBe(412_300);
  });

  it("makes no figure from a missing or negative part", () => {
    expect(ratioValue(Number.NaN, 31)).toBeNull();
    expect(ratioValue(412_300, Number.NaN)).toBeNull();
    expect(ratioValue(-1, 31)).toBeNull();
    expect(ratioValue(412_300, -1)).toBeNull();
  });
});

describe("ratioText", () => {
  const parts = ratioComponents({ code: "AVG_MILES_ROAD_CALLS" })!;

  it("shows the division", () => {
    expect(ratioText(parts, 412_300, 31)).toBe("412,300 miles ÷ 31 road calls");
  });

  it("says when there was nothing to divide by", () => {
    expect(ratioText(parts, 412_300, 0)).toBe("412,300 miles, no road calls");
  });
});
