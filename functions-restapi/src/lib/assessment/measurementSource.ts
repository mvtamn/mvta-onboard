// Where a standard's number comes from.
//
// Four kinds, because the two the schema used to carry each covered two
// genuinely different situations, and the difference decides what the compute
// does:
//
//   api_feed            an external feed this application ingests. Has a
//                       resolver to call at compute time.
//   onboard_compliance  occurrences OnBoard raises from its own compliance
//                       modules. Nothing to call - the rows already exist and
//                       assess.ts aggregates them.
//   manual_entry        a person types the month's figure in.
//   structured_import   a person transcribes it from another system's
//                       structured report - Nexus, Asset Works M5. Stored the
//                       same way as manual_entry, and deliberately so: the
//                       difference is provenance, not mechanism. It is worth
//                       recording because it names who to chase when the
//                       figure is missing, and marks the standards that could
//                       become api_feed once those integrations exist.
export const MEASUREMENT_SOURCES = ["api_feed", "onboard_compliance", "manual_entry", "structured_import"] as const;
export type MeasurementSource = (typeof MEASUREMENT_SOURCES)[number];

// The external systems MVTA reports from today. Offered as a picker so the
// same system is not spelled three ways across the catalog, with free text
// still allowed for one nobody has named yet.
export const KNOWN_SOURCE_SYSTEMS = [
  { value: "Nexus", label: "Nexus (Trackit)", description: "Customer contacts and operator conduct complaints." },
  { value: "Asset Works M5", label: "Asset Works M5", description: "Fleet maintenance, road calls and vehicle availability." },
] as const;

// Rows written before migration 104, and AssessmentPeriodStandards snapshots
// that are deliberately left in the old vocabulary because they record what a
// finalized month was scored under. The compute has to read both, and an
// unrecognised value is treated as manual entry rather than throwing: a
// standard whose source cannot be read still has a hand-entered figure to fall
// back on, and that is the least surprising reading of an unknown value.
export function normalizeMeasurementSource(
  value: string | null | undefined,
  standardType: "threshold" | "occurrence",
): MeasurementSource {
  if (value && (MEASUREMENT_SOURCES as readonly string[]).includes(value)) return value as MeasurementSource;
  if (value === "auto") return standardType === "occurrence" ? "onboard_compliance" : "api_feed";
  return "manual_entry";
}

// Whether the month's figure is typed rather than computed. Both manual kinds
// read the same ManualMetricEntries row; only their provenance differs.
export function isHandEntered(source: MeasurementSource): boolean {
  return source === "manual_entry" || source === "structured_import";
}

export const MEASUREMENT_SOURCE_LABELS: Record<MeasurementSource, string> = {
  api_feed: "Ingested from a feed",
  onboard_compliance: "Raised by OnBoard compliance",
  manual_entry: "Entered by hand",
  structured_import: "Transcribed from another system",
};
