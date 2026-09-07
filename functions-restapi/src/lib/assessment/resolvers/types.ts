import type { Transaction } from "mssql";
import type { MeasurementSource } from "../measurementSource";

// What measuring one standard for one month produces.
//
// Raw / excluded / assessable are carried separately rather than netted,
// because Attachment G's dispute process turns on being able to show what was
// left out and why. assess.ts writes all three onto PeriodKpiAssessments.
export interface ResolvedMeasurement {
  /** The assessable value the tier ladder is matched against; null means not measurable. */
  metricValue: number | null;
  /** Before exclusions, for the report's "raw" column. */
  rawMetricValue: number | null;
  /** The part exclusions removed, or null when nothing was excluded. */
  excludedMetricValue: number | null;
  rawQuantity: number;
  excludedQuantity: number;
  /** Multiplier for per-unit penalty bases; 1 for a single monthly figure. */
  quantity: number;
  occurrenceCount: number;
  /** 0 means nothing was measurable, which assess.ts scores as not_assessable. */
  completeness: number;
  /** Where the number came from, e.g. "OtpMonthlyRouteStopDay:202608". */
  sourceRefs: string[];
  /**
   * Set when the number could not be produced for a reason worth reporting -
   * a misconfiguration rather than a quiet month. assess.ts records it on the
   * assessment so the period's exception list names the cause.
   */
  unresolvedReason?: string;
}

export interface ResolverContext {
  tx: Transaction;
  contractorId: string;
  /** CHAR(6) YYYYMM. */
  month: string;
  standardCode: string;
}

export type ThresholdResolver = (context: ResolverContext) => Promise<ResolvedMeasurement>;

export interface RegisteredResolver {
  key: string;
  /** Shown in the console's standards administration, so an administrator picking one knows what it reads. */
  label: string;
  description: string;
  /** Which standard type this resolver can serve. */
  appliesTo: "threshold" | "occurrence";
  /** The measurement source kind a standard must declare to use it. */
  source: MeasurementSource;
  resolve?: ThresholdResolver;
}

export function notMeasurable(reason: string, sourceRefs: string[] = []): ResolvedMeasurement {
  return {
    metricValue: null, rawMetricValue: null, excludedMetricValue: null,
    rawQuantity: 0, excludedQuantity: 0, quantity: 0, occurrenceCount: 0,
    completeness: 0, sourceRefs, unresolvedReason: reason,
  };
}
