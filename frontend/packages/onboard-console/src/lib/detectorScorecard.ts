// What the Detector scorecard says, without React.
//
// The server counts (scorecard.ts); these helpers turn its figures into the
// words a person deciding a promotion reads, and turn a week that meets the bar
// into the measurement the promotion form asks for - so the figure recorded on
// the decision is the figure measured, not one copied by hand.
import type { DetectorPeriodFigures, DetectorScorecardGrouping, DetectorScorecardPeriod } from "@mvta/shared";
import { serviceDateLabel, type PromotionDraft } from "./detectorPromotion.js";

export function rateText(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;
}

export function periodLabel(period: Pick<DetectorScorecardPeriod, "start" | "end">, grouping: DetectorScorecardGrouping): string {
  return grouping === "week" ? `Week of ${serviceDateLabel(period.start)}` : serviceDateLabel(period.start);
}

export function precisionText(figures: Pick<DetectorPeriodFigures, "precision" | "sample">): string {
  return figures.precision === null ? "No decisive review" : `${rateText(figures.precision)} of ${figures.sample}`;
}

const HELD_LABELS: Record<string, string> = {
  awaiting_operating_window: "operating window open",
  unknown_data_gap: "data gap",
};

/** Why cases are held, most common first: "data gap 3 · operating window open 1". */
export function heldReasonsText(reasons: readonly { reason: string; count: number }[]): string {
  return reasons.map((r) => `${HELD_LABELS[r.reason] ?? r.reason.replaceAll("_", " ")} ${r.count}`).join(" · ");
}

export function reviewBurdenText(review: DetectorPeriodFigures["review"]): string {
  const hours = review.average_hours_to_review === null ? "" : ` · ${review.average_hours_to_review} h to review`;
  return `${review.reviewed} reviewed · ${review.awaiting_review} waiting${hours}`;
}

/** Cases Avail backed, and cases it contradicted. */
export function availText(figures: Pick<DetectorPeriodFigures, "avail" | "cases">): string {
  if (!figures.avail) return "—";
  return `${figures.avail.corroborated} corroborated · ${figures.cases.evidence_conflicts} in conflict`;
}

export function dispatcherText(figures: Pick<DetectorPeriodFigures, "dispatcher">): string {
  const d = figures.dispatcher;
  if (!d) return "—";
  const seen = d.not_observed + d.observed_on_time + d.observed_left_late;
  return seen === 0 ? "None observed" : `${rateText(d.agreement)} of ${seen}`;
}

export function availRecallText(recall: DetectorScorecardPeriod["avail_recall"]): string {
  if (!recall) return "—";
  if (recall.whole_misses === 0) return "No Avail misses";
  const waiting = recall.awaiting_reviewer > 0 ? ` · ${recall.awaiting_reviewer} probable` : "";
  return `${rateText(recall.recall)} · ${recall.unmatched} unmatched${waiting}`;
}

export function dispatcherRecallText(recall: DetectorScorecardPeriod["dispatcher_recall"]): string {
  if (!recall) return "—";
  if (recall.not_observed === 0) return "None not observed";
  return `${rateText(recall.recall)} · ${recall.missed} missed`;
}

/**
 * A week that meets the bar, as the promotion form's measurement. Only a week
 * that meets it: the form would refuse anything less anyway.
 */
export function draftFromWeek(
  period: Pick<DetectorScorecardPeriod, "start">,
  figures: Pick<DetectorPeriodFigures, "detector" | "precision" | "sample" | "bar">,
): Partial<PromotionDraft> | null {
  if (!figures.bar?.meets_bar || figures.precision === null) return null;
  const percent = (Math.floor(figures.precision * 1000) / 10).toFixed(1);
  return {
    detector: figures.detector,
    promoted: true,
    precisionPercent: percent,
    sampleSize: String(figures.sample),
    reason: `${percent}% precision over ${figures.sample} reviewed cases in the service week of ${serviceDateLabel(period.start)} (Detector scorecard).`,
  };
}

/** How a week reads against the bar: met, short of it, or not yet decidable. */
export type WeekTone = "met" | "short" | "open";

export function weekTone(figures: Pick<DetectorPeriodFigures, "bar">): WeekTone {
  if (!figures.bar?.complete) return "open";
  return figures.bar.meets_bar ? "met" : "short";
}

/**
 * The week a detector's verdict is read from: its latest complete week, or the
 * latest week at all when none is complete yet.
 */
/** The fields of a week these helpers read. */
type WeekFigures = { detectors: readonly Pick<DetectorPeriodFigures, "detector" | "bar">[] };

export function featuredWeek<P extends WeekFigures>(
  periods: readonly P[],
  detector: DetectorPeriodFigures["detector"],
): P | null {
  const complete = periods.filter((p) => p.detectors.find((d) => d.detector === detector)?.bar?.complete);
  return complete[complete.length - 1] ?? periods[periods.length - 1] ?? null;
}

export function weeksMetText(periods: readonly WeekFigures[], detector: DetectorPeriodFigures["detector"]): string {
  const met = periods.filter((p) => p.detectors.find((d) => d.detector === detector)?.bar?.meets_bar).length;
  return `${met} of ${periods.length} weeks met the bar`;
}

/** "20261012" as "Oct 12", for a strip label. */
export function shortDateLabel(key: string): string {
  if (!/^\d{8}$/.test(key)) return key;
  return new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(4, 6)) - 1, Number(key.slice(6, 8))))
    .toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}
