// The shapes the schedule review produces: the per-route summary the health
// page has shown since v1.5.319, and the per-route detail behind it (which
// stop pairs, which timepoints, which blocks, by hour).
//
// The check definitions live in checks/; this file only names what a check
// is and what it returns, so the console's twin in packages/shared/api.ts has
// one place to mirror.

export type PredictionRiskCheckId =
  | "placeholder_times"
  | "timepoint_gap"
  | "longest_hop"
  | "tight_turnarounds"
  | "interlined"
  | "block_overlaps"
  | "run_time_spread"
  | "run_time_flat"
  | "timepoint_density"
  | "implied_speed"
  | "recovery_time";

export type PredictionRiskUnit = "%" | "min" | "mi" | "trips" | "stops" | "segments";

/** Who can change the thing a check found. */
export type PredictionRiskOwner = "scheduling" | "avail" | "operations" | "structural";

export interface PredictionRiskCheckDefinition {
  id: PredictionRiskCheckId;
  label: string;
  unit: PredictionRiskUnit;
  /** The value that flags, read with `comparison`. */
  threshold: number;
  /** at_least: a value at or above the threshold is flagged. at_most: at or below. */
  comparison: "at_least" | "at_most";
  /** Why it hurts predictions, for the person reading the review. */
  why: string;
  owner: PredictionRiskOwner;
  /** What would fix it, in one sentence, for that owner. */
  fix: string;
}

/**
 * One row of evidence behind a check's value: a stop pair, a block hand-over,
 * a stop pattern, a layover bucket. `text` is complete on its own; the ids
 * are for linking and maps.
 */
export interface ReviewEvidence {
  text: string;
  /** Trips (or hand-overs) the row covers, when counting is what it does. */
  count: number | null;
  /** The row's own figure in the check's unit, when it has one. */
  value: number | null;
  stop_ids: string[];
  /** Capped: the text carries the full count. */
  trip_ids: string[];
}

export interface PredictionRiskCheckResult {
  id: PredictionRiskCheckId;
  /** null when the route has nothing to measure (e.g. no follow-on trips). */
  value: number | null;
  flagged: boolean;
}

export interface RouteCheckDetail extends PredictionRiskCheckResult {
  evidence: ReviewEvidence[];
}

export interface PredictionRiskRoute {
  route_id: string;
  route_short_name: string;
  trip_count: number;
  flag_count: number;
  checks: PredictionRiskCheckResult[];
}

export interface PredictionRiskFeedInfo {
  version: string | null;
  start_date: string | null;
  end_date: string | null;
}

export interface PredictionRiskReview {
  feed: PredictionRiskFeedInfo;
  checks: readonly PredictionRiskCheckDefinition[];
  routes: PredictionRiskRoute[];
}

/** Scheduled minutes over one timepoint segment for trips starting in one hour. */
export interface TimepointSegmentHour {
  /** Start hour of the trip, 0-23 (GTFS hours past 24 are folded). */
  hour: number;
  trips: number;
  min_minutes: number;
  max_minutes: number;
}

export interface TimepointSegmentDetail {
  from_stop_id: string;
  from_stop_name: string;
  to_stop_id: string;
  to_stop_name: string;
  /** Along the route when the feed's shape distances calibrate; else straight-line. */
  miles: number | null;
  hours: TimepointSegmentHour[];
}

export interface RouteScheduleDetail {
  route_id: string;
  route_short_name: string;
  trip_count: number;
  stop_count: number;
  timepoint_count: number;
  pattern_count: number;
  flag_count: number;
  checks: RouteCheckDetail[];
  segments: TimepointSegmentDetail[];
}

/** How the feed's shape_dist_traveled was read. GTFS leaves the unit unspecified. */
export interface DistanceCalibration {
  unit: "feet" | "metres" | "unknown";
  factor_to_metres: number | null;
  /** Hops the calibration was measured on. */
  samples: number;
}

export interface ScheduleReview {
  summary: PredictionRiskReview;
  details: RouteScheduleDetail[];
  distance: DistanceCalibration;
}
