// Which of a route's flags its schedule can fix, decided here once so the
// Schedule Review page ranks routes by the server's rule, not its own.
//
// Two checks describe the route itself rather than its schedule: the longest
// gap between timepoints and the longest stop-free distance (owner
// "structural", "Not a schedule fix"). The 2026-10-16 critique found route 490
// topping the list on six flags, two of them those; on a page whose reader's
// job is fixing the schedule, they are shown, muted, and do not rank.
//
// Pure: stored routes and today's check definitions in, counts out. Counts
// are computed when the review is read, never stored, so a check's owner can
// change without restating history.
import type { PredictionRiskCheckDefinition, PredictionRiskRoute } from "./types";

export interface RankedRoute extends PredictionRiskRoute {
  /** Flagged checks an owner other than "structural" can act on. */
  fixable_flag_count: number;
  /** Flagged checks that describe the route, not its schedule. */
  structural_flag_count: number;
}

export function withFlagCounts(
  routes: readonly PredictionRiskRoute[],
  checks: readonly PredictionRiskCheckDefinition[],
): RankedRoute[] {
  const structural = new Set(checks.filter((c) => c.owner === "structural").map((c) => c.id));
  return routes.map((route) => {
    const flagged = route.checks.filter((c) => c.flagged);
    const structuralCount = flagged.filter((c) => structural.has(c.id)).length;
    return { ...route, fixable_flag_count: flagged.length - structuralCount, structural_flag_count: structuralCount };
  });
}
