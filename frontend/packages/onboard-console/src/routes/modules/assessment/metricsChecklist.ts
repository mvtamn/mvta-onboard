import type { ContractorPerformanceStandard, ManualMetricEntry, PeriodKpiAssessment } from "@mvta/shared";
import { isHandEntered } from "../../performanceStandardsVocabulary.js";

// The month's hand-entered figures as a checklist: which of them the month
// scores, which are in, which are still missing, and which hand-entered
// standards the Agreement does not score at all. The scored set is read from
// the period's own rows - the rule set it was opened with - not from the
// catalog's is_scored flag, which can have changed since.

export interface ChecklistItem {
  /** The period's row for this standard; null before the month is first computed. */
  row: PeriodKpiAssessment | null;
  standard: ContractorPerformanceStandard;
  /** The month's entry for this standard, when one has been saved. */
  entry: ManualMetricEntry | undefined;
}

export interface MetricsChecklist {
  /** Missing figures first, then entered ones; each in the scorecard's order. */
  scored: ChecklistItem[];
  /** Hand-entered monthly standards the month does not score. */
  unscored: ContractorPerformanceStandard[];
  entered: number;
}

const isMonthlyFigure = (standard: ContractorPerformanceStandard) =>
  standard.standard_type === "threshold" && isHandEntered(standard.measurement_source);

export function metricsChecklist(
  rows: readonly PeriodKpiAssessment[],
  standards: readonly ContractorPerformanceStandard[],
  metrics: readonly ManualMetricEntry[],
): MetricsChecklist {
  const byId = new Map(standards.map((standard) => [standard.id, standard]));
  const items: ChecklistItem[] = [];
  for (const row of rows) {
    const standard = byId.get(row.standard_id);
    if (!standard || !isMonthlyFigure(standard)) continue;
    items.push({ row, standard, entry: metrics.find((metric) => metric.standard_id === standard.id) });
  }
  // A month not yet computed has no rows to read its rule set from, and its
  // figures are entered before that first compute. The catalog's scored flag
  // stands in until the rows exist.
  if (!rows.length) {
    for (const standard of standards) {
      if (isMonthlyFigure(standard) && standard.is_scored) items.push({ row: null, standard, entry: metrics.find((metric) => metric.standard_id === standard.id) });
    }
  }
  const scoredIds = new Set(items.map((item) => item.standard.id));
  return {
    scored: [...items.filter((item) => !item.entry), ...items.filter((item) => item.entry)],
    unscored: standards.filter((standard) => isMonthlyFigure(standard) && !scoredIds.has(standard.id)),
    entered: items.filter((item) => item.entry).length,
  };
}
