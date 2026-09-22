// Vocabulary of the OTP month measurement module.

export interface OtpFigure {
  departures: number;
  ontime: number;
  /** Share on time, 0-1. Null when there are no departures to divide by. */
  pct: number | null;
}

export interface OtpRouteFigure {
  route_id: number;
  route_label: string | null;
  route_category: string;
  raw: OtpFigure;
  /** What every rule took out: raw less assessable. */
  excluded: OtpFigure;
  /** Of that, what the category filter and approved stop exclusions took. */
  stop_excluded: OtpFigure;
  /** Of that, what approved weather and emergency dates took (migration 140). */
  date_excluded: OtpFigure;
  /** The Assessable Input: what the month is judged on. */
  assessable: OtpFigure;
  /** Null when the route has no assessable departures to judge. */
  below_target: boolean | null;
}

/**
 * Where the target came from. A month with an Assessment Period is judged by
 * that period's frozen rule set (ADR 0006), so a finalized month cannot be
 * restated by a band edited afterwards. Otherwise the current catalog answers,
 * and says so.
 */
export type OtpTargetSource = "period_rule_set" | "catalog" | "default";

export interface OtpMonthMeasurement {
  service_month: string;
  target: number;
  target_source: OtpTargetSource;
  raw: OtpFigure;
  excluded: OtpFigure;
  stop_excluded: OtpFigure;
  date_excluded: OtpFigure;
  assessable: OtpFigure;
  routes: OtpRouteFigure[];
  /** Routes below target on the assessable figure. */
  routes_below_target: number;
  /**
   * Weather and emergency days recorded for this month, whatever their state -
   * including the ones nobody has approved.
   */
  weather_days_recorded: number;
  /**
   * How many of those are actually subtracting from the assessable figure:
   * approved, and holding the snapshot of what they took out (migration 140,
   * ADR 0038).
   *
   * This used to be structurally impossible. ADR 0033 recorded that Avail's
   * monthly feed is keyed by day of week, so a single date could not be
   * removed from it, and the console said so. The daily feed carries a real
   * calendar date and was shown on 2026-09-22 to reconcile exactly with the
   * monthly one, so the date's own departures are snapshot on approval and
   * subtracted from the month.
   */
  weather_days_applied: number;
  /** False when OtpMonthlyRouteStopDay is absent; every figure is then empty. */
  feed_ready: boolean;
}

export interface MeasureOtpMonthOptions {
  /**
   * The Assessment Period to take the target from. Callers that already know
   * it (the resolver) pass it; otherwise the month's only period is used, and
   * the catalog answers when the month has none or more than one.
   */
  periodId?: string | null;
  now?: Date;
}
