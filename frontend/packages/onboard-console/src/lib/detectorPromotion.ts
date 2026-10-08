// What the Detector promotion page says, without React.
//
// Promotion is a dated decision: a detector counts toward an assessment from a
// service date onward (ADR-0035). The server decides whether a decision may be
// recorded; these helpers put the same rules in front of the person filling the
// form, so a refusal is something they read before pressing the button rather
// than after.
import type {
  DetectorPromotionEntry,
  DetectorPromotionInput,
  DetectorStanding,
  MissedTripDetectorName,
} from "@mvta/shared";

/** CONTEXT's bar, mirrored from the server so the form can say it up front. */
export const PRECISION_BAR = 0.95;

const LABELS: Record<MissedTripDetectorName, string> = {
  gtfs_cancellation: "Advance cancellations",
  gtfs_silent_no_show: "Silent no-shows",
  spare: "On-demand service failures",
};

const SOURCES: Record<MissedTripDetectorName, string> = {
  gtfs_cancellation: "Fixed route · GTFS-RT",
  gtfs_silent_no_show: "Fixed route · GTFS-RT",
  spare: "MVTA Connect · Spare",
};

export function detectorLabel(detector: MissedTripDetectorName): string {
  return LABELS[detector] ?? detector;
}

export function detectorSource(detector: MissedTripDetectorName): string {
  return SOURCES[detector] ?? "";
}

/** "20260901" as a date somebody reads. An unparseable key is shown as it is. */
export function serviceDateLabel(key: string | null | undefined): string {
  const value = (key ?? "").trim();
  if (!/^\d{8}$/.test(value)) return value || "—";
  const date = new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8))));
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** An <input type="date"> value as the service date key the server wants. */
export function serviceDateKey(input: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(input) ? input.replaceAll("-", "") : "";
}

export function standingSentence(standing: DetectorStanding): string {
  return standing.promoted
    ? `Counts toward assessments from ${serviceDateLabel(standing.since)}.`
    : "In Shadow detection. Its confirmations are reviewed, but never reach an assessment.";
}

export function measurementText(entry: Pick<DetectorPromotionEntry, "measured_precision" | "sample_size">): string {
  if (entry.measured_precision === null) return "No measurement recorded";
  const percent = `${(entry.measured_precision * 100).toFixed(1)}%`;
  return entry.sample_size === null ? `${percent} precision` : `${percent} precision over ${entry.sample_size} cases`;
}

export function decisionTitle(entry: Pick<DetectorPromotionEntry, "detector" | "promoted">): string {
  return `${detectorLabel(entry.detector)} ${entry.promoted ? "promoted" : "taken back into Shadow detection"}`;
}

export interface PromotionDraft {
  detector: MissedTripDetectorName;
  effectiveDate: string;
  promoted: boolean;
  reason: string;
  precisionPercent: string;
  sampleSize: string;
  onDemandConditionsMet: boolean;
}

export const EMPTY_DRAFT: PromotionDraft = {
  detector: "gtfs_silent_no_show",
  effectiveDate: "",
  promoted: true,
  reason: "",
  precisionPercent: "",
  sampleSize: "",
  onDemandConditionsMet: false,
};

export type DraftField = "effectiveDate" | "reason" | "precisionPercent" | "sampleSize" | "onDemandConditionsMet";

/**
 * What is still missing, by field. Demotion asks for none of the evidence
 * promotion does: taking a misfiring detector back out should never be the
 * harder thing to do.
 */
export function draftErrors(draft: PromotionDraft): Partial<Record<DraftField, string>> {
  const errors: Partial<Record<DraftField, string>> = {};
  if (!serviceDateKey(draft.effectiveDate)) errors.effectiveDate = "Choose the service date this applies from.";
  if (!draft.reason.trim()) {
    errors.reason = draft.promoted
      ? "Say what this detector measured, and over which service week."
      : "Say why this detector is being taken back out.";
  }
  if (!draft.promoted) return errors;

  const percent = Number(draft.precisionPercent);
  if (!draft.precisionPercent.trim() || Number.isNaN(percent)) {
    errors.precisionPercent = "Record the precision measured over a complete service week.";
  } else if (percent < PRECISION_BAR * 100) {
    errors.precisionPercent = `A detector leaves Shadow detection at ${PRECISION_BAR * 100}% precision or better.`;
  } else if (percent > 100) {
    errors.precisionPercent = "Precision cannot be above 100%.";
  }
  const sample = Number(draft.sampleSize);
  if (!draft.sampleSize.trim() || Number.isNaN(sample) || sample <= 0) {
    errors.sampleSize = "Say how many cases the measurement covers.";
  }
  if (draft.detector === "spare" && !draft.onDemandConditionsMet) {
    errors.onDemandConditionsMet = "Confirm the on-demand conditions before promoting this detector.";
  }
  return errors;
}

/** The draft as the server's request body. Only call it on a draft with no errors. */
export function promotionInput(draft: PromotionDraft): DetectorPromotionInput {
  const promoting = draft.promoted;
  return {
    detector: draft.detector,
    effective_service_date: serviceDateKey(draft.effectiveDate),
    promoted: promoting,
    reason: draft.reason.trim(),
    measured_precision: promoting ? Number(draft.precisionPercent) / 100 : null,
    sample_size: promoting ? Number(draft.sampleSize) : null,
    on_demand_conditions_met: promoting && draft.detector === "spare" ? draft.onDemandConditionsMet : undefined,
  };
}

/**
 * The warning for detector names the stored history mentions that this build
 * does not know. They promote nothing, so a decision that looks applied is not.
 */
export function ignoredWarning(ignored: readonly string[]): string | null {
  if (ignored.length === 0) return null;
  return `The history names ${ignored.length === 1 ? "a detector" : "detectors"} OnBoard does not know (${ignored.join(", ")}). ${ignored.length === 1 ? "That decision promotes" : "Those decisions promote"} nothing.`;
}
