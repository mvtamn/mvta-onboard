import type { DetourConflictStatus } from "../detourConflicts";
import type { LikelyDuplicate } from "../detourDuplicates";

export const DETOUR_FULFILLMENT_MODES = ["avail", "fixed_route_manual", "mobility_manual"] as const;
export type DetourFulfillmentMode = (typeof DETOUR_FULFILLMENT_MODES)[number];

// `approved` is not a Workflow state: promotion is the approval (ADR-0030,
// migration 122).
export const DETOUR_LIFECYCLE_STATES = ["awaiting_fulfillment", "fulfilled", "fulfillment_failed", "closed"] as const;
export type DetourLifecycleState = (typeof DETOUR_LIFECYCLE_STATES)[number];

export type AvailEntryResult = "entered" | "conflict" | "not_entered";

// The facts OCC reviews. A change to any of them on an open Detour raises
// Outstanding re-review; the rest of the record can change freely.
export interface ReviewedFacts {
  closure: string;
  start_date: string | null;
  end_date: string | null;
  riders_directed: string | null;
  location: string | null;
  geometry_json: string | null;
  segments: { routes: string; directions: string | null }[];
}

export type Actor = { kind: "person"; name: string } | { kind: "avail_sync" };

// One member per Detour workflow act (CONTEXT.md). There is deliberately no
// act that sets a state directly.
export type DetourAct =
  // The Detour row was just inserted by the caller, in the same transaction.
  | { act: "promote"; mode: DetourFulfillmentMode }
  | { act: "create"; mode: DetourFulfillmentMode }
  | { act: "avail_entry"; result: AvailEntryResult; externalDetourId?: string | null; detail?: string | null }
  | { act: "manual_fallback"; reason: string }
  | { act: "close"; reason: string }
  | { act: "override_conflict"; reason: string }
  // Who is carrying this Detour. `owner: null` hands it back to nobody.
  // Ownership is not a state: it says who acts next, not what the Detour is.
  | { act: "assign"; owner: string | null }
  // Called before the caller writes the edited fields, so the stored values
  // are still the ones OCC last saw.
  | { act: "record_edit"; proposed: Partial<ReviewedFacts> }
  | { act: "complete_re_review"; notes?: string | null }
  // `new` requires the row the sync just inserted, in the same transaction.
  | { act: "avail_observation"; externalDetourId: string; kind: "new" | "refreshed" | "preserved" };

export type RefusalCode =
  | "not_found"
  | "already_started"
  | "not_allowed_from_state"
  | "not_avail_backed"
  | "conflict_unresolved"
  | "re_review_outstanding"
  | "no_conflicts_to_override"
  | "no_re_review_outstanding"
  | "invalid_owner"
  | "no_change";

export interface Refusal {
  code: RefusalCode;
  // A sentence a dispatcher can act on; handlers return it unchanged.
  sentence: string;
  conflicts?: LikelyDuplicate[];
}

export interface DetourWorkflowState {
  id: string;
  lifecycle_state: DetourLifecycleState;
  fulfillment_mode: DetourFulfillmentMode;
  review_status: "current" | "needs_review";
}

export type ActOutcome =
  | { ok: true; detour: DetourWorkflowState; conflicts?: LikelyDuplicate[] }
  | { ok: false; refusal: Refusal };

export type DetourReadiness =
  | "needs_occ_review"
  | "ready_for_avail_entry"
  | "avail_conflict"
  | "in_avail"
  | "ready_for_manual_operations"
  | "closed";

// The acts a person can be offered on an existing Detour.
export type OfferedAct =
  | "avail_entry.entered"
  | "avail_entry.conflict"
  | "avail_entry.not_entered"
  | "manual_fallback"
  | "close"
  | "override_conflict"
  | "complete_re_review";

export type ActAvailability = { available: true } | { available: false; refusal: Refusal };

export interface DetourWorkflowView {
  id: string;
  lifecycle_state: string;
  fulfillment_mode: DetourFulfillmentMode;
  re_review_outstanding: boolean;
  conflicts: LikelyDuplicate[];
  conflict_status: DetourConflictStatus;
  acts: Record<OfferedAct, ActAvailability>;
  next_step: DetourReadiness;
}
