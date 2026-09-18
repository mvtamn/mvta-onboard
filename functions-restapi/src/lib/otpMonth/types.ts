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
  /** What the exclusions and the category filter took out. */
  excluded: OtpFigure;
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
  assessable: OtpFigure;
  routes: OtpRouteFigure[];
  /** Routes below target on the assessable figure. */
  routes_below_target: number;
  /**
   * Weather and emergency days recorded for this month. They are NOT applied:
   * Avail's monthly feed is keyed by day of week, not date, so a single date
   * cannot be removed from it (ADR 0033). Reported so the console can say so
   * rather than leave a reviewer wondering.
   */
  weather_days_recorded: number;
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
