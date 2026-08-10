export const DETOUR_FULFILLMENT_MODES = [
  "avail",
  "fixed_route_manual",
  "mobility_manual",
] as const;
export type DetourFulfillmentMode = (typeof DETOUR_FULFILLMENT_MODES)[number];

export const DETOUR_LIFECYCLE_STATES = [
  "approved",
  "pending_avail_build",
  "built_in_avail",
  "build_failed",
  "active",
  "expired",
  "rejected",
  "duplicate",
] as const;
export type DetourLifecycleState = (typeof DETOUR_LIFECYCLE_STATES)[number];

export interface DetourWorkflowInput {
  fulfillment_mode: DetourFulfillmentMode;
  lifecycle_state: DetourLifecycleState;
}

const TRANSITIONS: Record<DetourLifecycleState, readonly DetourLifecycleState[]> = {
  approved: ["pending_avail_build", "active", "rejected", "duplicate"],
  pending_avail_build: ["built_in_avail", "build_failed", "rejected"],
  built_in_avail: ["active", "pending_avail_build"],
  build_failed: ["pending_avail_build", "rejected"],
  active: ["expired", "pending_avail_build"],
  expired: ["active"],
  rejected: [],
  duplicate: [],
};

export function canTransition(
  from: DetourLifecycleState,
  to: DetourLifecycleState,
  fulfillmentMode: DetourFulfillmentMode,
): boolean {
  if (fulfillmentMode !== "avail" && (to === "pending_avail_build" || to === "built_in_avail" || to === "build_failed")) {
    return false;
  }
  if (fulfillmentMode === "avail" && to === "active" && from !== "built_in_avail") {
    return false;
  }
  return TRANSITIONS[from].includes(to);
}

export interface DateWindow {
  start_date: string | null;
  end_date: string | null;
}

function dayNumber(value: string | null): number | null {
  if (!value) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(time) ? null : time;
}

export function dateWindowsOverlap(a: DateWindow, b: DateWindow): boolean {
  const aStart = dayNumber(a.start_date) ?? Number.MIN_SAFE_INTEGER;
  const bStart = dayNumber(b.start_date) ?? Number.MIN_SAFE_INTEGER;
  const aEnd = dayNumber(a.end_date) ?? Number.MAX_SAFE_INTEGER;
  const bEnd = dayNumber(b.end_date) ?? Number.MAX_SAFE_INTEGER;
  return aStart <= bEnd && bStart <= aEnd;
}

export function attachmentPurgeAt(expiredAt: string): Date {
  const date = new Date(expiredAt);
  if (Number.isNaN(date.getTime())) throw new Error("expiredAt must be a valid date");
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date;
}
