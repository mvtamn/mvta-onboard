// Vocabulary of the reduced-service-day module.

/** A day the agency declares did not run a normal schedule. */
export interface ReducedServiceDay {
  id: string;
  /** YYYYMMDD. */
  service_date: string;
  /** Avail's own spelling, stamped when the day was declared. */
  day_of_week: string;
  /** What the day was: 'Labor Day', 'Thanksgiving'. */
  label: string;
  /** What ran instead: 'Sunday schedule', 'Reduced weekday'. */
  schedule_operated: string;
  notes: string | null;
  declared_by: string;
  declared_at: Date;
}

/**
 * What the daily OTP feed can say about a declared day.
 *
 * `contradicted` is not an error state - it is the finding. A day declared a
 * holiday that ran a full schedule is either the wrong date or a schedule that
 * was not actually reduced, and both are worth a reviewer's attention.
 */
export type ReducedServiceCoverage =
  | "corroborated"
  | "contradicted"
  | "no_daily_data"
  | "insufficient_comparison";

export interface ReducedServiceDayEvidence {
  service_date: string;
  coverage: ReducedServiceCoverage;
  /** Departures the feed recorded that date. */
  departures: number | null;
  /** The median for that day of week in that month, declared days removed. */
  typical: number | null;
  /** departures / typical. Below 0.9 corroborates the declaration. */
  share: number | null;
}
