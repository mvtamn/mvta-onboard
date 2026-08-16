import type { DetourFulfillmentMode, DetourLifecycleState } from "./detourWorkflow";

export type DetourReadiness =
  | "needs_occ_review"
  | "ready_for_avail_entry"
  | "avail_conflict"
  | "ready_for_manual_operations"
  | "closed";

export function computeDetourReadiness(
  mode: DetourFulfillmentMode | null | undefined,
  state: DetourLifecycleState | null | undefined,
): DetourReadiness {
  if (state === "closed") return "closed";
  if (state === "approved") return "needs_occ_review";
  if (mode === "avail" && state === "awaiting_fulfillment") return "ready_for_avail_entry";
  if (mode === "avail" && state === "fulfillment_failed") return "avail_conflict";
  if ((mode === "fixed_route_manual" || mode === "mobility_manual") && state === "fulfilled") {
    return "ready_for_manual_operations";
  }
  return "needs_occ_review";
}
