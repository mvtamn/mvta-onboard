export const DETOUR_FULFILLMENT_MODES = [
  "avail",
  "fixed_route_manual",
  "mobility_manual",
] as const;
export type DetourFulfillmentMode = (typeof DETOUR_FULFILLMENT_MODES)[number];

export const DETOUR_LIFECYCLE_STATES = [
  "approved",
  "awaiting_fulfillment",
  "fulfilled",
  "fulfillment_failed",
  "closed",
] as const;
export type DetourLifecycleState = (typeof DETOUR_LIFECYCLE_STATES)[number];

export interface DetourWorkflowInput {
  fulfillment_mode: DetourFulfillmentMode;
  lifecycle_state: DetourLifecycleState;
}

const TRANSITIONS: Record<DetourLifecycleState, readonly DetourLifecycleState[]> = {
  approved: ["awaiting_fulfillment", "fulfilled", "closed"],
  awaiting_fulfillment: ["fulfilled", "fulfillment_failed", "closed"],
  fulfilled: ["closed"],
  fulfillment_failed: ["awaiting_fulfillment", "closed"],
  closed: [],
};

export function canTransition(
  from: DetourLifecycleState,
  to: DetourLifecycleState,
  fulfillmentMode: DetourFulfillmentMode,
): boolean {
  if (fulfillmentMode !== "avail" && (to === "awaiting_fulfillment" || to === "fulfillment_failed")) {
    return false;
  }
  if (fulfillmentMode === "avail" && to === "fulfilled" && from !== "awaiting_fulfillment") {
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
