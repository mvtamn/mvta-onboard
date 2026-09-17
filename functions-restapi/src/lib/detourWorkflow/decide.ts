// The Detour workflow decision: given what is stored about one Detour and
// the act someone intends, either a named refusal or the row change and the
// one history entry the act produces. Pure; store.ts loads the snapshot under
// a row lock and writes what this returns. This is the module's internal
// seam - callers go through index.ts.
import { conflictStatus } from "../detourConflicts";
import type { LikelyDuplicate } from "../detourDuplicates";
import {
  type Actor,
  type ActAvailability,
  type AvailEntryResult,
  type DetourAct,
  type DetourFulfillmentMode,
  type DetourLifecycleState,
  type DetourReadiness,
  type OfferedAct,
  type Refusal,
  type RefusalCode,
  type ReviewedFacts,
} from "./types";

export interface WorkflowSnapshot {
  id: string;
  // As stored; the column's CHECK constraint holds it to DetourLifecycleState.
  lifecycle_state: string;
  fulfillment_mode: DetourFulfillmentMode;
  review_status: "current" | "needs_review";
  review_reason: string | null;
  history_count: number;
  facts: ReviewedFacts;
  override_reason: string | null;
  override_ids: string[];
  // Loaded only for the acts that need them (see needsConflicts).
  conflicts: LikelyDuplicate[] | null;
}

export interface RowPatch {
  lifecycle_state?: DetourLifecycleState;
  fulfillment_mode?: DetourFulfillmentMode;
  // Stamp workflow_updated_by/at.
  workflow?: true;
  avail_build_confirmed?: "now" | "clear";
  avail_entry?: { result: AvailEntryResult; external_detour_id: string | null };
  fulfillment_change_reason?: string;
  closure_reason?: string;
  conflict_override?: { reason: string; ids: string[] };
  review?: { status: "current" | "needs_review"; reason: string | null };
}

export type HistoryEventType = "created" | "state_transition" | "source_observation" | "manual_correction" | "fulfillment_confirmation";

export interface HistoryEntry {
  event_type: HistoryEventType;
  from_state: string | null;
  to_state: string | null;
  detail: string | null;
}

export type Decision = { refusal: Refusal } | { patch: RowPatch; history: HistoryEntry };

export const RE_REVIEW_REASON = "Material operational details changed; OCC review required before next steps";

export function needsConflicts(act: DetourAct): boolean {
  return (act.act === "avail_entry" && act.result === "entered") || act.act === "override_conflict";
}

const STATE_WORDS: Record<string, string> = {
  awaiting_fulfillment: "awaiting Avail entry",
  fulfilled: "fulfilled",
  fulfillment_failed: "held by a failed Avail entry",
  closed: "closed",
};

function refuse(code: RefusalCode, sentence: string, conflicts?: LikelyDuplicate[]): Decision {
  return { refusal: conflicts ? { code, sentence, conflicts } : { code, sentence } };
}

function clip(text: string): string {
  return text.slice(0, 1000);
}

function startState(mode: DetourFulfillmentMode): DetourLifecycleState {
  return mode === "avail" ? "awaiting_fulfillment" : "fulfilled";
}

function text(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function segmentsKey(segments: ReviewedFacts["segments"]): string {
  return JSON.stringify(segments.map((s) => [text(s.routes), text(s.directions)]));
}

// Only fields the caller is actually changing are compared; an absent field
// is not an edit. Blank and null are the same value.
export function reviewedFactsChanged(stored: ReviewedFacts, proposed: Partial<ReviewedFacts>): boolean {
  const textFields = ["closure", "start_date", "end_date", "riders_directed", "location", "geometry_json"] as const;
  for (const field of textFields) {
    if (proposed[field] !== undefined && text(proposed[field]) !== text(stored[field])) return true;
  }
  return proposed.segments !== undefined && segmentsKey(proposed.segments) !== segmentsKey(stored.segments);
}

function currentConflictStatus(snapshot: WorkflowSnapshot) {
  return conflictStatus(snapshot.conflicts ?? [], { reason: snapshot.override_reason, by: null, at: null, ids: snapshot.override_ids });
}

export function decide(snapshot: WorkflowSnapshot, act: DetourAct, actor: Actor): Decision {
  if ((act.act === "avail_observation") !== (actor.kind === "avail_sync")) {
    throw new TypeError(`${act.act} cannot be performed by ${actor.kind}`);
  }
  if (needsConflicts(act) && snapshot.conflicts === null) {
    throw new TypeError(`${act.act} needs the Detour's conflicts loaded`);
  }
  const state = snapshot.lifecycle_state;

  switch (act.act) {
    case "promote":
    case "create":
    case "avail_observation": {
      const starting = act.act !== "avail_observation" || act.kind === "new";
      if (starting && snapshot.history_count > 0) return refuse("already_started", "This Detour's workflow has already started.");
      if (act.act === "avail_observation") {
        const detail = `Observed Avail detour ${act.externalDetourId}${act.kind === "preserved" ? "; preserved OnBoard record" : ""}`;
        return {
          patch: act.kind === "new" ? { fulfillment_mode: "avail", lifecycle_state: "fulfilled" } : {},
          history: { event_type: "source_observation", from_state: null, to_state: act.kind === "new" ? "fulfilled" : null, detail },
        };
      }
      const to = startState(act.mode);
      return {
        patch: { fulfillment_mode: act.mode, lifecycle_state: to, workflow: true },
        history: act.act === "create"
          ? { event_type: "created", from_state: null, to_state: to, detail: null }
          : { event_type: "state_transition", from_state: null, to_state: to, detail: "Promoted from Detour Intake" },
      };
    }

    case "avail_entry": {
      if (snapshot.fulfillment_mode !== "avail") return refuse("not_avail_backed", "Only an Avail-backed Detour can record an Avail entry.");
      if (state !== "awaiting_fulfillment" && state !== "fulfillment_failed") {
        return refuse("not_allowed_from_state", `An Avail entry can be recorded only while the Detour awaits Avail entry or after a failed attempt; this Detour is ${STATE_WORDS[state] ?? state}.`);
      }
      if (act.result === "entered") {
        if (snapshot.review_status === "needs_review") {
          return refuse("re_review_outstanding", "This Detour's details changed since OCC reviewed them. Mark the re-review complete before confirming the Avail entry.");
        }
        if (currentConflictStatus(snapshot) === "unresolved") {
          const conflicts = snapshot.conflicts ?? [];
          return refuse("conflict_unresolved", `This Detour conflicts with ${conflicts.map((c) => c.label).join(", ")}. Record a conflict override with a reason before confirming the Avail entry.`, conflicts);
        }
      }
      const to: DetourLifecycleState = act.result === "entered" ? "fulfilled" : act.result === "conflict" ? "fulfillment_failed" : "awaiting_fulfillment";
      return {
        patch: {
          lifecycle_state: to,
          workflow: true,
          avail_entry: { result: act.result, external_detour_id: text(act.externalDetourId) },
          avail_build_confirmed: act.result === "entered" ? "now" : "clear",
        },
        history: { event_type: "fulfillment_confirmation", from_state: state, to_state: to, detail: clip(text(act.detail) ?? `Human Avail entry result: ${act.result}`) },
      };
    }

    case "manual_fallback": {
      if (snapshot.fulfillment_mode !== "avail") return refuse("not_avail_backed", "A manual fallback is available only for an Avail-backed Detour after an Avail conflict.");
      if (state !== "fulfillment_failed") return refuse("not_allowed_from_state", "A manual fallback is available only after an Avail conflict.");
      if (snapshot.review_status === "needs_review") {
        return refuse("re_review_outstanding", "This Detour's details changed since OCC reviewed them. Mark the re-review complete before switching to manual operations.");
      }
      return {
        patch: { fulfillment_mode: "fixed_route_manual", lifecycle_state: "fulfilled", workflow: true, fulfillment_change_reason: act.reason.trim() },
        history: { event_type: "manual_correction", from_state: state, to_state: "fulfilled", detail: clip(act.reason.trim()) },
      };
    }

    case "close": {
      if (state === "closed") return refuse("not_allowed_from_state", "This Detour is already closed.");
      return {
        patch: { lifecycle_state: "closed", workflow: true, closure_reason: act.reason.trim() },
        history: { event_type: "state_transition", from_state: state, to_state: "closed", detail: clip(act.reason.trim()) },
      };
    }

    case "override_conflict": {
      if (state === "closed") return refuse("not_allowed_from_state", "A closed Detour has no conflicts to override.");
      const conflicts = snapshot.conflicts ?? [];
      if (conflicts.length === 0) return refuse("no_conflicts_to_override", "This Detour has no current conflicts to override.");
      const reason = act.reason.trim();
      return {
        patch: { conflict_override: { reason, ids: conflicts.map((c) => c.id) } },
        history: { event_type: "manual_correction", from_state: state, to_state: state, detail: clip(`Conflict override: ${reason} (conflicts: ${conflicts.map((c) => c.label).join(", ")})`) },
      };
    }

    case "record_edit": {
      const raise = state !== "closed" && reviewedFactsChanged(snapshot.facts, act.proposed);
      return {
        patch: raise ? { review: { status: "needs_review", reason: RE_REVIEW_REASON } } : {},
        history: { event_type: "manual_correction", from_state: null, to_state: state, detail: raise ? "Manual correction to authoritative Detour fields; OCC re-review required" : "Manual correction to authoritative Detour fields" },
      };
    }

    case "complete_re_review": {
      if (snapshot.review_status !== "needs_review") return refuse("no_re_review_outstanding", "This Detour is not awaiting OCC re-review.");
      const notes = text(act.notes);
      return {
        patch: { review: { status: "current", reason: null } },
        history: { event_type: "manual_correction", from_state: state, to_state: state, detail: clip(`OCC re-review completed${snapshot.review_reason ? ` (raised: ${snapshot.review_reason})` : ""}${notes ? `: ${notes}` : ""}`) },
      };
    }

    default: {
      const unhandled: never = act;
      throw new TypeError(`Unknown Detour act ${JSON.stringify(unhandled)}`);
    }
  }
}

const OFFERED: Record<OfferedAct, DetourAct> = {
  "avail_entry.entered": { act: "avail_entry", result: "entered" },
  "avail_entry.conflict": { act: "avail_entry", result: "conflict" },
  "avail_entry.not_entered": { act: "avail_entry", result: "not_entered" },
  manual_fallback: { act: "manual_fallback", reason: "offer" },
  close: { act: "close", reason: "offer" },
  override_conflict: { act: "override_conflict", reason: "offer" },
  complete_re_review: { act: "complete_re_review" },
};

const OFFER_ACTOR: Actor = { kind: "person", name: "offer" };

// What a person could do next, and why not, from the same decision the acts
// enforce. The snapshot must carry conflicts.
export function offeredActs(snapshot: WorkflowSnapshot): Record<OfferedAct, ActAvailability> {
  const result = {} as Record<OfferedAct, ActAvailability>;
  for (const [key, act] of Object.entries(OFFERED) as [OfferedAct, DetourAct][]) {
    const decision = decide(snapshot, act, OFFER_ACTOR);
    result[key] = "refusal" in decision ? { available: false, refusal: decision.refusal } : { available: true };
  }
  return result;
}

export function nextStep(snapshot: WorkflowSnapshot): DetourReadiness {
  const state = snapshot.lifecycle_state;
  if (state === "closed") return "closed";
  if (snapshot.review_status === "needs_review") return "needs_occ_review";
  if (snapshot.fulfillment_mode === "avail") {
    if (state === "awaiting_fulfillment") return "ready_for_avail_entry";
    if (state === "fulfillment_failed") return "avail_conflict";
    if (state === "fulfilled") return "in_avail";
  } else if (state === "fulfilled") {
    return "ready_for_manual_operations";
  }
  return "needs_occ_review";
}

export { currentConflictStatus };
