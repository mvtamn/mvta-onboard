import type { PredictionRiskCheckDefinition, PredictionRiskOwner } from "@mvta/shared";

// How the schedule review's figures and owners read, shared by the summary on
// Integrations & Data Health and the route view in Compliance › OTP.

export const OWNER_LABEL: Record<PredictionRiskOwner, string> = {
  scheduling: "MVTA scheduling",
  avail: "Avail schedule export",
  operations: "Operations",
  structural: "Not a schedule fix",
};

export function formatRiskValue(definition: Pick<PredictionRiskCheckDefinition, "unit">, value: number | null): string {
  if (value === null) return "—";
  if (definition.unit === "%") return `${value}%`;
  if (definition.unit === "trips") return value.toLocaleString();
  if ((definition.unit === "stops" || definition.unit === "segments") && value === 1) return `1 ${definition.unit.slice(0, -1)}`;
  return `${value} ${definition.unit}`;
}

/** "flagged at 30 min or more", or "or less" for a check that flags downward. */
export function thresholdSentence(definition: PredictionRiskCheckDefinition): string {
  return `flagged at ${formatRiskValue(definition, definition.threshold)} or ${definition.comparison === "at_most" ? "less" : "more"}`;
}

/** The Schedule Review page, opened on one route. */
export function scheduleReviewPath(routeId: string): string {
  return `/schedule-review?route=${encodeURIComponent(routeId)}`;
}

// feed_info dates are GTFS YYYYMMDD.
export function feedDate(value: string | null): string | null {
  const match = value?.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function feedSentence(feed: { version: string | null; start_date: string | null; end_date: string | null }): string {
  const from = feedDate(feed.start_date);
  const to = feedDate(feed.end_date);
  return `${feed.version ? `Feed ${feed.version}` : "Feed"}${from && to ? ` · ${from} – ${to}` : ""}`;
}
