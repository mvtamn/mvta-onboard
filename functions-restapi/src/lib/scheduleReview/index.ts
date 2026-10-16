// Which parts of the published static schedule make arrival predictions worse,
// route by route, and the evidence behind each finding.
//
// A prediction engine (Avail today) starts from the schedule and corrects it
// with each GPS ping. Where the schedule is wrong or silent, the correction has
// nothing good to start from, and riders see it as a countdown that jumps or a
// bus that arrives before its prediction. Swiftly's Sep 1-20, 2026 comparison
// put MVTA's current prediction accuracy between 49% (490) and 79% (470).
//
// One module answers it: feedModel.ts parses the feed once, checks/ hold one
// file per check with its threshold, owner, fix and evidence, and this file
// turns them into the summary the health page shows and the per-route detail
// behind it (ADR 0040). Pure: CSV text in, review out. The static sync runs
// it on every import and store.ts keeps the result; nothing here reads the
// database.
import { buildScheduleModel, type PredictionRiskFeed, type RouteModel, type ScheduleModel } from "./feedModel";
import { CHECKS, PREDICTION_RISK_CHECKS, isFlagged } from "./checks";
import { miles } from "./distance";
import type {
  PredictionRiskReview,
  RouteCheckDetail,
  RouteScheduleDetail,
  ScheduleReview,
  TimepointSegmentDetail,
} from "./types";

export type { PredictionRiskFeed } from "./feedModel";
export * from "./types";
export { PREDICTION_RISK_CHECKS, isFlagged } from "./checks";

function segmentDetails(route: RouteModel, model: ScheduleModel): TimepointSegmentDetail[] {
  return route.segments.map((segment) => {
    const byHour = new Map<number, { trips: number; min: number; max: number }>();
    const directions = new Set<string | null>();
    let longest: number | null = null;
    for (const occurrence of segment.occurrences) {
      directions.add(occurrence.trip.directionLabel);
      const hour = occurrence.trip.startHour;
      const known = byHour.get(hour);
      byHour.set(hour, known
        ? { trips: known.trips + 1, min: Math.min(known.min, occurrence.minutes), max: Math.max(known.max, occurrence.minutes) }
        : { trips: 1, min: occurrence.minutes, max: occurrence.minutes });
      if (occurrence.metres !== null) longest = Math.max(longest ?? 0, occurrence.metres);
    }
    return {
      from_stop_id: segment.fromStopId,
      from_stop_name: model.stopName(segment.fromStopId),
      to_stop_id: segment.toStopId,
      to_stop_name: model.stopName(segment.toStopId),
      direction: directions.size === 1 ? [...directions][0] : null,
      miles: longest === null ? null : Math.round(miles(longest) * 10) / 10,
      hours: [...byHour.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([hour, h]) => ({ hour, trips: h.trips, min_minutes: Math.round(h.min), max_minutes: Math.round(h.max) })),
    };
  });
}

export function reviewSchedule(feed: PredictionRiskFeed): ScheduleReview {
  const model = buildScheduleModel(feed);
  const details: RouteScheduleDetail[] = model.routes
    .filter((route) => route.trips.length > 0)
    .map((route) => {
      const checks: RouteCheckDetail[] = CHECKS.map((check) => {
        const { value, evidence } = check.evaluate(route, model);
        return { id: check.definition.id, value, flagged: isFlagged(check.definition, value), evidence };
      });
      const stopIds = new Set<string>();
      const timepointIds = new Set<string>();
      for (const trip of route.trips) {
        for (const stopTime of trip.stopTimes) {
          stopIds.add(stopTime.stopId);
          if (stopTime.exact) timepointIds.add(stopTime.stopId);
        }
      }
      return {
        route_id: route.id,
        route_short_name: route.name,
        trip_count: route.trips.length,
        stop_count: stopIds.size,
        timepoint_count: timepointIds.size,
        pattern_count: route.patterns.length,
        flag_count: checks.filter((c) => c.flagged).length,
        checks,
        segments: segmentDetails(route, model),
      };
    });
  const order = new Map(model.routes.map((route) => [route.id, route.order]));
  details.sort((a, b) =>
    b.flag_count - a.flag_count ||
    (order.get(a.route_id) ?? Infinity) - (order.get(b.route_id) ?? Infinity) ||
    a.route_id.localeCompare(b.route_id));

  const summary: PredictionRiskReview = {
    feed: model.feed,
    checks: PREDICTION_RISK_CHECKS,
    routes: details.map((d) => ({
      route_id: d.route_id,
      route_short_name: d.route_short_name,
      trip_count: d.trip_count,
      flag_count: d.flag_count,
      checks: d.checks.map(({ id, value, flagged }) => ({ id, value, flagged })),
    })),
  };
  return { summary, details, distance: model.distance };
}

/** The summary alone, as the health page has read it since v1.5.319. */
export function reviewPredictionRisk(feed: PredictionRiskFeed): PredictionRiskReview {
  return reviewSchedule(feed).summary;
}
