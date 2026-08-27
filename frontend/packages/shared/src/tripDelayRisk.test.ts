import { describe, expect, it } from "vitest";
import {
  DEPARTURE_RISK_THRESHOLD_SECONDS,
  departureRiskSeconds,
  isDepartureAtRisk,
  isDepartureWatch,
} from "./tripDelayRisk.js";

describe("fixed-route departure risk", () => {
  it.each([
    [900, false],
    [901, true],
    [915, true],
    [929, true],
    [930, true],
  ])("classifies %i predicted seconds as risk=%s", (predicted, expected) => {
    expect(
      isDepartureAtRisk({
        delay_seconds: 0,
        predicted_max_departure_delay_seconds: predicted,
      }),
    ).toBe(expected);
  });

  it("falls back to current delay when prediction is missing", () => {
    expect(
      departureRiskSeconds({
        delay_seconds: 901,
        predicted_max_departure_delay_seconds: null,
      }),
    ).toBe(901);
    expect(
      isDepartureAtRisk({
        delay_seconds: 901,
        predicted_max_departure_delay_seconds: null,
      }),
    ).toBe(true);
  });

  it("does not OR current delay into a present prediction", () => {
    expect(
      isDepartureAtRisk({
        delay_seconds: DEPARTURE_RISK_THRESHOLD_SECONDS + 100,
        predicted_max_departure_delay_seconds: 600,
      }),
    ).toBe(false);
  });

  it.each([
    [599, false],
    [600, true],
    [900, true],
    [901, false],
  ])("classifies %i predicted seconds as Watch=%s", (predicted, expected) => {
    expect(isDepartureWatch({ delay_seconds: 0, predicted_max_departure_delay_seconds: predicted })).toBe(expected);
  });
});
