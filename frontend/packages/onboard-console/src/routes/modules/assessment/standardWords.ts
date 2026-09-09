import type { ContractorPerformanceStandard } from "@mvta/shared";
import { sourceLabel } from "../../performanceStandardsVocabulary.js";

// A standard in one line of words, for the places a code used to sit.
//
// MISSED_TRIPS_FR is a machine key for resolvers and SQL; under a name on a
// scorecard it told a reader nothing. What a reader wants beside the name is
// how the figure is produced and who answers for it: "Counted events · from
// OnBoard · Rob". The code stays on the Administration detail header, where
// an administrator may be matching it to a resolver or a query.

export type StandardWordsInput = Pick<ContractorPerformanceStandard, "standard_type" | "measurement_source" | "source_system"> &
  Partial<Pick<ContractorPerformanceStandard, "unit_label" | "assigned_to" | "responsible_team">>;

export interface StandardWordsOptions {
  /** Include the unit ("miles") after how it is measured. */
  unit?: boolean;
  /** Include the assigned owner. */
  owner?: boolean;
  /** Include the responsible team. */
  team?: boolean;
}

/** "Counted events" or "Monthly value": what kind of figure this standard is. */
export function kindLabel(standardType: string): string {
  return standardType === "occurrence" ? "Counted events" : "Monthly value";
}

/** "Counted events · from OnBoard · Rob", with the parts the caller asks for. */
export function standardWords(standard: StandardWordsInput, options: StandardWordsOptions = {}): string {
  const parts = [kindLabel(standard.standard_type), sourceLabel(standard.measurement_source, standard.source_system)];
  if (options.unit && standard.unit_label) parts.push(standard.unit_label);
  if (options.team && standard.responsible_team) parts.push(standard.responsible_team);
  if (options.owner && standard.assigned_to) parts.push(standard.assigned_to);
  return parts.join(" · ");
}
