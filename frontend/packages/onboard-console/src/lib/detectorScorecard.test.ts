import { describe, expect, it } from "vitest";
import type { DetectorPeriodFigures } from "@mvta/shared";
import {
  availRecallText,
  dispatcherText,
  draftFromWeek,
  featuredWeek,
  heldReasonsText,
  precisionText,
  rateText,
  reviewBurdenText,
  shortDateLabel,
  weeksMetText,
  weekTone,
} from "./detectorScorecard.js";

const bar = (meets: boolean) => ({ complete: meets, meets_bar: meets, sentence: "" });

describe("what the scorecard says", () => {
  it("reads rates and precision", () => {
    expect(rateText(0.9725)).toBe("97.3%");
    expect(rateText(null)).toBe("—");
    expect(precisionText({ precision: 0.75, sample: 4 })).toBe("75.0% of 4");
    expect(precisionText({ precision: null, sample: 0 })).toBe("No decisive review");
  });

  it("names held reasons in words", () => {
    expect(heldReasonsText([{ reason: "unknown_data_gap", count: 3 }, { reason: "feed_gap", count: 1 }]))
      .toBe("data gap 3 · feed gap 1");
  });

  it("says what reviewing cost", () => {
    expect(reviewBurdenText({ reviewed: 12, awaiting_review: 2, average_hours_to_review: 3.5 }))
      .toBe("12 reviewed · 2 waiting · 3.5 h to review");
    expect(reviewBurdenText({ reviewed: 0, awaiting_review: 0, average_hours_to_review: null })).toBe("0 reviewed · 0 waiting");
  });

  it("says when there is nothing to compare rather than showing 0%", () => {
    expect(dispatcherText({ dispatcher: null })).toBe("—");
    expect(dispatcherText({ dispatcher: { not_observed: 0, observed_on_time: 0, observed_left_late: 0, agreement: null } }))
      .toBe("None observed");
    expect(availRecallText({ whole_misses: 0, caught: 0, linked_not_flagged: 0, awaiting_reviewer: 0, unmatched: 0, recall: null, unmatched_rate: null }))
      .toBe("No Avail misses");
    expect(availRecallText({ whole_misses: 10, caught: 6, linked_not_flagged: 1, awaiting_reviewer: 1, unmatched: 2, recall: 6 / 9, unmatched_rate: 0.2 }))
      .toBe("66.7% · 2 unmatched · 1 probable");
  });
});

describe("using a week in the promotion form", () => {
  const figures = (overrides: Partial<DetectorPeriodFigures> = {}) => ({
    detector: "gtfs_silent_no_show" as const, precision: 0.9725, sample: 143, bar: bar(true), ...overrides,
  });

  it("fills the measurement from a week that meets the bar", () => {
    const fill = draftFromWeek({ start: "20261012" }, figures());
    expect(fill).toMatchObject({ detector: "gtfs_silent_no_show", promoted: true, precisionPercent: "97.2", sampleSize: "143" });
    expect(fill?.reason).toMatch(/97\.2% precision over 143 reviewed cases in the service week of/);
  });

  it("never rounds a week up over the bar", () => {
    expect(draftFromWeek({ start: "20261012" }, figures({ precision: 0.94996 }))?.precisionPercent).toBe("94.9");
  });

  it("offers nothing for a week short of the bar", () => {
    expect(draftFromWeek({ start: "20261012" }, figures({ bar: bar(false) }))).toBeNull();
    expect(draftFromWeek({ start: "20261012" }, figures({ bar: null }))).toBeNull();
  });
});

describe("reading a detector's weeks", () => {
  const period = (start: string, bar: { complete: boolean; meets_bar: boolean } | null) =>
    ({ start, detectors: [{ detector: "spare" as const, bar: bar && { ...bar, sentence: "" } }] }) as never;

  it("reads the verdict from the latest complete week", () => {
    const weeks = [period("1", bar(true)), period("2", { complete: true, meets_bar: false }), period("3", { complete: false, meets_bar: false })];
    expect((featuredWeek(weeks, "spare") as { start: string }).start).toBe("2");
    expect(weeksMetText(weeks, "spare")).toBe("1 of 3 weeks met the bar");
  });

  it("falls back to the latest week when none is complete", () => {
    const weeks = [period("1", { complete: false, meets_bar: false }), period("2", null)];
    expect((featuredWeek(weeks, "spare") as { start: string }).start).toBe("2");
    expect(featuredWeek([], "spare")).toBeNull();
  });

  it("tones a week met, short, or open", () => {
    expect(weekTone({ bar: bar(true) })).toBe("met");
    expect(weekTone({ bar: { complete: true, meets_bar: false, sentence: "" } })).toBe("short");
    expect(weekTone({ bar: null })).toBe("open");
  });

  it("labels the strip briefly", () => {
    expect(shortDateLabel("20261012")).toMatch(/12/);
    expect(shortDateLabel("bad")).toBe("bad");
  });
});
