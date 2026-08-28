// Shared between the Fixed Route and On-Demand risk workspaces. Both present
// the same operator contract - training scenarios are not live data, actions
// are unavailable while the feed is not current, and stale KPI context may only
// be used after an acknowledgement - so that contract lives in one place.
import { requiresStaleDataAcknowledgement, type KpiTrustStream } from "@mvta/shared";
import type { RiskConfidence } from "./serviceRisk.data.js";

// The widest of the two workspaces' modes; each keeps its own narrower type.
export type RiskDataMode = "loading" | "live" | "preview" | "authentication_required";

export const TRAINING_SCENARIO_NOTICE =
  "Training scenario — local rehearsal only. No operational data or workflow changes will be saved.";

export function confidenceClass(confidence: RiskConfidence | "Unknown"): string {
  if (confidence === "High") return "pill-success";
  if (confidence === "Medium") return "pill-warning";
  return "pill-muted";
}

// A preview or training scenario never writes, so its actions stay available;
// live data that is not current cannot support an operational action.
export function riskActionsDisabled(
  isPreview: boolean,
  dataMode: RiskDataMode,
  feedState: string | undefined,
): boolean {
  return !isPreview && dataMode === "live" && feedState !== "current";
}

// The label and behaviour are shared; the class stays with the caller, whose
// surrounding layout (a view-toggle group or a standard chip) decides it.
export function TrainingScenarioToggle({
  trainingMode,
  onToggle,
  className,
}: {
  trainingMode: boolean;
  onToggle: () => void;
  className: string;
}) {
  return (
    <button className={className} onClick={onToggle}>
      {trainingMode ? "Return to monitoring" : "Training scenario"}
    </button>
  );
}

export type StaleDataAcknowledgement =
  | { required: false }
  | { required: true; reason: string | null };

// Asks for the acknowledgement the prepare endpoint requires, and only when it
// requires one: recording a reason against current coverage is rejected there.
// A null reason means the operator declined, so the caller must not continue.
export function staleDataAcknowledgement(
  state: KpiTrustStream["state"] | undefined,
): StaleDataAcknowledgement {
  if (!requiresStaleDataAcknowledgement(state)) return { required: false };
  const reason = window.prompt("Why is it safe to prepare this customer update from stale KPI data?");
  return { required: true, reason: reason?.trim() ? reason.trim() : null };
}
