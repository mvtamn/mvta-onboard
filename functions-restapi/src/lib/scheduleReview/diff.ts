// What changed between two schedule reviews (plans/schedule-review-module-plan.md
// increment 4).
//
// The static feed changes a few times a year; the review runs on every daily
// import. Comparing the review of one feed with the review of the next says
// whether a new schedule fixed what was flagged or brought new problems: a
// scheduler who added peak running times to 420 should see "same running
// time all day" leave 420, and nothing else move.
//
// Two reviews can also differ on the SAME feed, because the review itself
// changed: v1.5.324 added four checks and measured distance along the route.
// That is not news about the schedule, so the diff says which kind it is,
// and a check one side never ran is reported as added or removed, never as a
// flag gained or lost.
//
// Pure: two stored summaries in, changes out. Values and flags are compared
// as they were stored, each under the thresholds of its own day.
import type { PredictionRiskCheckId, PredictionRiskFeedInfo, PredictionRiskRoute } from "./types";

/** A stored review, as much of it as the diff needs. */
export interface ReviewSnapshot {
  review_id: number;
  reviewed_at: string;
  feed: PredictionRiskFeedInfo;
  routes: PredictionRiskRoute[];
}

export interface FlagChange {
  route_id: string;
  route_short_name: string;
  check_id: PredictionRiskCheckId;
  from_value: number | null;
  to_value: number | null;
}

export interface ReviewRef {
  review_id: number;
  reviewed_at: string;
  feed_version: string | null;
}

export interface ReviewDiff {
  from: ReviewRef;
  to: ReviewRef;
  /**
   * feed: the published schedule changed (a new feed version).
   * checks: same feed, the review changed (new or retuned checks).
   */
  cause: "feed" | "checks";
  gained: FlagChange[];
  lost: FlagChange[];
  /** Checks the later review ran that the earlier one did not, and the reverse. */
  checks_added: PredictionRiskCheckId[];
  checks_removed: PredictionRiskCheckId[];
  routes_added: { route_id: string; route_short_name: string; flag_count: number }[];
  routes_removed: { route_id: string; route_short_name: string }[];
  flagged_routes: { from: number; to: number };
}

function ref(snapshot: ReviewSnapshot): ReviewRef {
  return { review_id: snapshot.review_id, reviewed_at: snapshot.reviewed_at, feed_version: snapshot.feed.version };
}

function checkIds(snapshot: ReviewSnapshot): Set<PredictionRiskCheckId> {
  const ids = new Set<PredictionRiskCheckId>();
  for (const route of snapshot.routes) for (const check of route.checks) ids.add(check.id);
  return ids;
}

export function diffReviews(from: ReviewSnapshot, to: ReviewSnapshot, checkOrder: readonly PredictionRiskCheckId[]): ReviewDiff {
  const fromChecks = checkIds(from);
  const toChecks = checkIds(to);
  // Only a check both reviews ran can have gained or lost a flag.
  const shared = new Set([...toChecks].filter((id) => fromChecks.has(id)));
  const order = (id: PredictionRiskCheckId) => {
    const i = checkOrder.indexOf(id);
    return i === -1 ? checkOrder.length : i;
  };

  const fromRoutes = new Map(from.routes.map((r) => [r.route_id, r]));
  const toRoutes = new Map(to.routes.map((r) => [r.route_id, r]));
  const gained: FlagChange[] = [];
  const lost: FlagChange[] = [];

  // In the later review's order, so the routes needing most attention come first.
  for (const after of to.routes) {
    const before = fromRoutes.get(after.route_id);
    if (!before) continue;
    const beforeChecks = new Map(before.checks.map((c) => [c.id, c]));
    for (const check of after.checks) {
      if (!shared.has(check.id)) continue;
      const was = beforeChecks.get(check.id);
      if (!was || was.flagged === check.flagged) continue;
      const change: FlagChange = {
        route_id: after.route_id,
        route_short_name: after.route_short_name,
        check_id: check.id,
        from_value: was.value,
        to_value: check.value,
      };
      (check.flagged ? gained : lost).push(change);
    }
  }
  const byCheckThenRoute = (a: FlagChange, b: FlagChange) => order(a.check_id) - order(b.check_id);
  gained.sort(byCheckThenRoute);
  lost.sort(byCheckThenRoute);

  return {
    from: ref(from),
    to: ref(to),
    cause: from.feed.version !== null && from.feed.version === to.feed.version ? "checks" : "feed",
    gained,
    lost,
    checks_added: [...toChecks].filter((id) => !fromChecks.has(id)).sort((a, b) => order(a) - order(b)),
    checks_removed: [...fromChecks].filter((id) => !toChecks.has(id)).sort((a, b) => order(a) - order(b)),
    routes_added: to.routes
      .filter((r) => !fromRoutes.has(r.route_id))
      .map((r) => ({ route_id: r.route_id, route_short_name: r.route_short_name, flag_count: r.flag_count })),
    routes_removed: from.routes
      .filter((r) => !toRoutes.has(r.route_id))
      .map((r) => ({ route_id: r.route_id, route_short_name: r.route_short_name })),
    flagged_routes: {
      from: from.routes.filter((r) => r.flag_count > 0).length,
      to: to.routes.filter((r) => r.flag_count > 0).length,
    },
  };
}
