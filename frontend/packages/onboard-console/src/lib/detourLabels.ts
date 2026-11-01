import {
  DETOUR_AVAIL_RESULT_LABELS,
  DETOUR_FULFILLMENT_MODE_LABELS,
  DETOUR_LIFECYCLE_LABELS,
  detourLifecycleLabel,
  type Detour,
  type DetourLikelyDuplicate,
  type DetourWorkflowHistoryEntry,
} from "@mvta/shared";

// Human labels for the workflow-side fields of a Detour, shared by the
// Detour Register table and its CSV export so the two can never disagree
// about what a row says. Detours.tsx phrases its "next step" as an
// instruction ("Enter this detour in Avail") and keeps its own copy.
//
// "Conflict" is shown for one thing only: this Detour overlapping another
// open one, which a Conflict override settles - and even that is said as
// "overlaps". Avail refusing an entry is said as "Avail refused it".

export function fulfillmentPathLabel(d: Pick<Detour, "fulfillment_mode">): string {
  return d.fulfillment_mode ? DETOUR_FULFILLMENT_MODE_LABELS[d.fulfillment_mode] ?? "—" : "—";
}

// The next step as an instruction, for the Detours page.
export function nextStepLabel(readiness: Detour["readiness"]): string {
  switch (readiness) {
    case "ready_for_avail_entry": return "Enter this detour in Avail";
    case "avail_conflict": return "Avail refused it — retry or run it manually";
    case "in_avail": return "In Avail; close it when the detour ends";
    case "ready_for_manual_operations": return "Ready for manual operations";
    case "closed": return "Closed";
    default: return "Needs OCC review";
  }
}

export const OVERLAP_UNRESOLVED = "Overlaps another detour — override needed";
export const OVERLAP_OVERRIDDEN = "Overlap overridden";

export function readinessLabel(d: Pick<Detour, "readiness" | "review_status" | "conflict_status">): string {
  const reReview = d.review_status === "needs_review";
  const base = d.readiness === "ready_for_avail_entry" ? "Ready for Avail entry"
    : d.readiness === "avail_conflict" ? "Avail refused it"
    : d.readiness === "in_avail" ? "In Avail"
    : d.readiness === "ready_for_manual_operations" ? "Ready for manual operations"
    : d.readiness === "closed" ? "Closed"
    : reReview ? "Needs OCC re-review"
    : "Needs OCC review";
  const flags = [
    reReview && base !== "Needs OCC re-review" ? "Needs OCC re-review" : null,
    d.conflict_status === "unresolved" ? OVERLAP_UNRESOLVED : d.conflict_status === "overridden" ? OVERLAP_OVERRIDDEN : null,
  ].filter(Boolean);
  return flags.length ? `${base} · ${flags.join(" · ")}` : base;
}

export function conflictLabel(d: Pick<Detour, "conflicts" | "conflict_status" | "conflict_override_reason">): string {
  if (!d.conflicts?.length) return "";
  const names = d.conflicts.map((c) => c.label).join("; ");
  return d.conflict_status === "overridden" ? `Overridden (${d.conflict_override_reason ?? ""}): ${names}` : `Unresolved: ${names}`;
}

/**
 * Where the Detour stands on telling its audiences. A Detour that names no
 * audience at all is stored as needs_communication and can never clear by
 * publishing (eligibility.ts communicationStatus), so it says what is actually
 * missing. The stored value is unchanged.
 */
export function communicationStatusLabel(d: Pick<Detour, "communication_status"> & Partial<Pick<Detour, "required_audiences">>): string {
  switch (d.communication_status) {
    case "published": return "All audiences told";
    case "draft": return "Draft in progress";
    case "needs_communication":
      return Array.isArray(d.required_audiences) && d.required_audiences.length === 0 ? "No audiences named" : "Needs communication";
    default: return "Not recorded";
  }
}

export function workflowLabel(d: Pick<Detour, "lifecycle_state"> & Partial<Pick<Detour, "fulfillment_mode">>): string {
  return d.lifecycle_state ? detourLifecycleLabel(d.lifecycle_state, d.fulfillment_mode) : "—";
}

/**
 * The state of another record named in an overlap or a likely duplicate. A
 * Detour's is its workflow state (the mode is not carried, so "In place"); an
 * intake's is its queue state, named by the caller.
 */
export function otherRecordStatusLabel(
  match: Pick<DetourLikelyDuplicate, "kind" | "status">,
  intakeLabels: Record<string, string> = {},
): string {
  const known = match.kind === "intake" ? intakeLabels[match.status] : (DETOUR_LIFECYCLE_LABELS as Record<string, string>)[match.status];
  if (known) return known;
  const words = match.status.replace(/_/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "—";
}

export function sourceLabel(d: Pick<Detour, "source" | "external_detour_id">): string {
  return d.source === "avail" ? "Avail feed" : d.external_detour_id ? "OnBoard · Avail linked" : "OnBoard manual";
}

export function createdByLabel(d: Pick<Detour, "source" | "created_by">): string {
  return d.source === "avail" ? "Avail sync" : d.created_by;
}

export function availEntryLabel(d: Pick<Detour, "fulfillment_mode" | "avail_entry_result">): string {
  if (d.fulfillment_mode !== "avail") return "";
  return d.avail_entry_result ? DETOUR_AVAIL_RESULT_LABELS[d.avail_entry_result] : "Entry not recorded";
}

/**
 * Where this Detour is actually managed, for the working pane.
 *
 * OCC runs the workflow from Detours & Closures, and the first thing that
 * decides what they can do is whether the Detour lives in Avail or is operated
 * outside it: an Avail Detour is entered and confirmed there, a manual one never
 * will be and is carried by a recorded fallback instead. The old Source column
 * answered a different question - where the record came from - which is in the
 * expanded row and is not what anybody acts on.
 */
export function managedInLabel(
  d: Pick<Detour, "fulfillment_mode" | "avail_entry_result" | "source" | "external_detour_id">,
): { label: string; detail: string; outside: boolean } {
  if (d.fulfillment_mode === "avail") {
    return { label: "Avail", detail: availEntryLabel(d), outside: false };
  }
  if (d.fulfillment_mode === "fixed_route_manual" || d.fulfillment_mode === "mobility_manual") {
    return { label: "Outside Avail", detail: DETOUR_FULFILLMENT_MODE_LABELS[d.fulfillment_mode], outside: true };
  }
  // No path decided yet: say so rather than implying one.
  return { label: "Not decided", detail: sourceLabel(d), outside: false };
}

/**
 * The pill class for a communication status. Shared, because Detours & Closures
 * and the Detour Register show the same badge and must not drift apart.
 */
export const COMMUNICATION_PILL: Record<string, string> = {
  published: "pill-success",
  draft: "pill-accent",
  needs_communication: "pill-warning",
};

/**
 * What is wrong with this Detour beyond its next step, worst first. These are
 * the things that stop OCC acting, so they are shown on the row rather than
 * waiting inside it - an unresolved overlap blocks the Avail entry, and an
 * outstanding re-review makes whatever is communicated possibly untrue.
 */
export function readinessFlags(
  d: Pick<Detour, "conflict_status" | "review_status" | "conflicts">,
): { text: string; bad: boolean }[] {
  const flags: { text: string; bad: boolean }[] = [];
  if (d.conflict_status === "unresolved") flags.push({ text: OVERLAP_UNRESOLVED, bad: true });
  if (d.review_status === "needs_review") flags.push({ text: "Needs OCC re-review", bad: true });
  if (d.conflict_status === "overridden") flags.push({ text: OVERLAP_OVERRIDDEN, bad: false });
  return flags;
}

/**
 * The history row's event name. The server stores five event types, and
 * manual_correction covers several different acts; the detail text it writes
 * for each (detourWorkflow/decide.ts) starts the same way every time, so the
 * act can be told apart without a new event type. Anything unrecognised stays
 * "Correction" rather than guessing.
 */
export function historyEventLabel(entry: Pick<DetourWorkflowHistoryEntry, "event_type" | "detail" | "from_state" | "to_state">): string {
  switch (entry.event_type) {
    case "created": return "Created";
    case "state_transition": return "Workflow";
    case "source_observation": return "Avail observation";
    case "fulfillment_confirmation": return "Avail result recorded";
    case "manual_correction": {
      const detail = entry.detail?.trim() ?? "";
      if (entry.from_state === "fulfillment_failed" && entry.to_state === "fulfilled") return "Switched to running manually";
      if (/^Assigned to /.test(detail) || detail === "Owner cleared") return "Owner changed";
      if (/^Conflict override:/.test(detail)) return "Overlap overridden";
      if (/^OCC re-review completed/.test(detail)) return "Re-review done";
      if (/^Manual correction to authoritative Detour fields/.test(detail)) return "Edited";
      return "Correction";
    }
    default: return String(entry.event_type);
  }
}
