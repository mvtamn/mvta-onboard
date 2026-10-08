import { DETOUR_LIFECYCLE_LABELS, type Detour } from "@mvta/shared";

// Human labels for the workflow-side fields of a Detour, shared by the
// Detour Register table and its CSV export so the two can never disagree
// about what a row says. Detours.tsx phrases its "next step" as an
// instruction ("Enter this detour in Avail") and keeps its own copy.

export function fulfillmentPathLabel(d: Pick<Detour, "fulfillment_mode">): string {
  switch (d.fulfillment_mode) {
    case "avail": return "Enter in Avail";
    case "mobility_manual": return "Mobility manual";
    case "fixed_route_manual": return "Fixed-route manual";
    default: return "—";
  }
}

// The next step as an instruction, for the Detours page.
export function nextStepLabel(readiness: Detour["readiness"]): string {
  switch (readiness) {
    case "ready_for_avail_entry": return "Enter this detour in Avail";
    case "avail_conflict": return "Resolve the Avail conflict";
    case "in_avail": return "In Avail; close it when the detour ends";
    case "ready_for_manual_operations": return "Ready for manual operations";
    case "closed": return "Closed";
    default: return "Needs OCC review";
  }
}

export function readinessLabel(d: Pick<Detour, "readiness" | "review_status" | "conflict_status">): string {
  const reReview = d.review_status === "needs_review";
  const base = d.readiness === "ready_for_avail_entry" ? "Ready for Avail entry"
    : d.readiness === "avail_conflict" ? "Avail conflict"
    : d.readiness === "in_avail" ? "In Avail"
    : d.readiness === "ready_for_manual_operations" ? "Ready for manual operations"
    : d.readiness === "closed" ? "Closed"
    : reReview ? "Needs OCC re-review"
    : "Needs OCC review";
  const flags = [
    reReview && base !== "Needs OCC re-review" ? "Needs OCC re-review" : null,
    d.conflict_status === "unresolved" ? "Conflict needs override" : d.conflict_status === "overridden" ? "Conflict overridden" : null,
  ].filter(Boolean);
  return flags.length ? `${base} · ${flags.join(" · ")}` : base;
}

export function conflictLabel(d: Pick<Detour, "conflicts" | "conflict_status" | "conflict_override_reason">): string {
  if (!d.conflicts?.length) return "";
  const names = d.conflicts.map((c) => c.label).join("; ");
  return d.conflict_status === "overridden" ? `Overridden (${d.conflict_override_reason ?? ""}): ${names}` : `Unresolved: ${names}`;
}

export function communicationStatusLabel(d: Pick<Detour, "communication_status">): string {
  switch (d.communication_status) {
    case "published": return "Ready / published";
    case "draft": return "Draft in progress";
    case "needs_communication": return "Needs communication";
    default: return "Not recorded";
  }
}

export function workflowLabel(d: Pick<Detour, "lifecycle_state">): string {
  return d.lifecycle_state ? DETOUR_LIFECYCLE_LABELS[d.lifecycle_state] : "—";
}

export function sourceLabel(d: Pick<Detour, "source" | "external_detour_id">): string {
  return d.source === "avail" ? "Avail feed" : d.external_detour_id ? "OnBoard · Avail linked" : "OnBoard manual";
}

export function createdByLabel(d: Pick<Detour, "source" | "created_by">): string {
  return d.source === "avail" ? "Avail sync" : d.created_by;
}

export function availEntryLabel(d: Pick<Detour, "fulfillment_mode" | "avail_entry_result">): string {
  if (d.fulfillment_mode !== "avail") return "";
  return d.avail_entry_result?.replace("_", " ") ?? "Entry not recorded";
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
    return {
      label: "Outside Avail",
      detail: d.fulfillment_mode === "fixed_route_manual" ? "Fixed-route manual" : "Mobility manual",
      outside: true,
    };
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
 * waiting inside it - an unresolved conflict blocks the Avail entry, and an
 * outstanding re-review makes whatever is communicated possibly untrue.
 */
export function readinessFlags(
  d: Pick<Detour, "conflict_status" | "review_status" | "conflicts">,
): { text: string; bad: boolean }[] {
  const flags: { text: string; bad: boolean }[] = [];
  if (d.conflict_status === "unresolved") flags.push({ text: "Conflict needs override", bad: true });
  if (d.review_status === "needs_review") flags.push({ text: "Needs OCC re-review", bad: true });
  if (d.conflict_status === "overridden") flags.push({ text: "Conflict overridden", bad: false });
  return flags;
}
