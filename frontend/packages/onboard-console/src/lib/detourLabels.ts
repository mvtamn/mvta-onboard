import { DETOUR_LIFECYCLE_LABELS, type Detour } from "@mvta/shared";

// Human labels for the workflow-side fields of a Detour, shared by the
// Detour Reports table and its CSV export so the two can never disagree
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

export function readinessLabel(d: Pick<Detour, "readiness" | "review_status" | "conflict_status">): string {
  const base = d.readiness === "ready_for_avail_entry" ? "Ready for Avail entry"
    : d.readiness === "avail_conflict" ? "Avail conflict"
    : d.readiness === "ready_for_manual_operations" ? "Ready for manual operations"
    : d.readiness === "closed" ? "Closed"
    : "Needs OCC review";
  const flags = [
    d.review_status === "needs_review" ? "Needs OCC re-review" : null,
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
