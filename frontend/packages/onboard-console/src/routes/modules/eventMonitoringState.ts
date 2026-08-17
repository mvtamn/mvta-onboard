import type { Event, EventServicePlan } from "@mvta/shared";

export const OPEN_EVENT_NOTIFICATION_STATUSES = ["pending", "acknowledged", "failed"] as const;
export const EVENT_NOTIFICATION_HISTORY_STATUSES = ["sent", "dismissed", "expired"] as const;

export function isOpenEventNotificationStatus(status: string): boolean {
  return OPEN_EVENT_NOTIFICATION_STATUSES.includes(status as (typeof OPEN_EVENT_NOTIFICATION_STATUSES)[number]);
}

export function isEventNotificationHistoryStatus(status: string): boolean {
  return EVENT_NOTIFICATION_HISTORY_STATUSES.includes(status as (typeof EVENT_NOTIFICATION_HISTORY_STATUSES)[number]);
}

/** Auto-select only when exactly one active operating period is unambiguous. */
export function defaultMonitoringEventId(events: Event[], plans: EventServicePlan[]): string {
  const activePlans = plans.filter((plan) => plan.status === "active");
  if (activePlans.length !== 1) return "";
  return events.some((event) => event.id === activePlans[0].event_id) ? activePlans[0].event_id : "";
}

/** Auto-select a plan only when the selected Event has one active period. */
export function defaultMonitoringServicePlanId(eventId: string, plans: EventServicePlan[]): string {
  const activePlans = plans.filter((plan) => plan.event_id === eventId && plan.status === "active");
  return activePlans.length === 1 ? activePlans[0].id : "";
}

export function activePlansMissingPublishedScope(plans: EventServicePlan[]): EventServicePlan[] {
  return plans.filter((plan) => plan.status === "active" && !plan.published_scope);
}

/** No selected Event means the live map should use the shared AVL feed. */
export function eventVehiclePositionQuery(eventId: string, servicePlanId: string): { eventId?: string; servicePlanId?: string } {
  return { eventId: eventId || undefined, servicePlanId: servicePlanId || undefined };
}

// --- Monitoring trust state (ADR-0020) -------------------------------------
//
// Owns the full "what does the operator see right now" decision. Every
// branch below corresponds to a state named in ADR-0020 (Loading, No
// results, Stale, Degraded, Unavailable, Authentication required) or to the
// operating-context selection states that gate them. This is the module
// EventMonitoring.tsx renders off; it should not need its own copy of this
// branching.

export type EventMonitoringTone = "info" | "success" | "warning" | "error";

export interface EventMonitoringDataState {
  tone: EventMonitoringTone;
  title: string;
  action: string | null;
}

export interface DeriveEventMonitoringDataStateInput {
  /** True only when the live-position load failed with HTTP 401. */
  authenticationExpired: boolean;
  /** Human-readable load failure, or the "no vehicles matched" diagnostic message. Null when the load succeeded with results. */
  loadError: string | null;
  vehicles: unknown[] | null;
  hasOperatingContext: boolean;
  activePlanCount: number;
  requiresPlanSelection: boolean;
  missingPublishedScopePlanNames: string[];
  /** Null when the health feed itself could not be reached. */
  health: unknown | null;
  degradedComponentNames: string[];
}

/**
 * Derives the single monitoring-surface state EventMonitoring renders.
 * Precedence matches ADR-0020: an authentication or load failure with no
 * vehicles yet loaded takes priority over every other read, including
 * whether an operating context is even selected.
 */
export function deriveEventMonitoringDataState(input: DeriveEventMonitoringDataStateInput): EventMonitoringDataState {
  const {
    authenticationExpired, loadError, vehicles, hasOperatingContext, activePlanCount,
    requiresPlanSelection, missingPublishedScopePlanNames, health, degradedComponentNames,
  } = input;

  if (loadError && vehicles === null) {
    return authenticationExpired
      ? { tone: "error", title: "Event AVL needs you to sign in again.", action: loadError }
      : { tone: "error", title: "Event AVL could not load live vehicle positions.", action: loadError };
  }

  if (!hasOperatingContext) {
    if (vehicles === null) return { tone: "info", title: "Connecting to live AVL vehicles…", action: null };
    return vehicles.length
      ? { tone: "success", title: "Showing all active AVL vehicles.", action: "Select an Event to see plan membership and geofence scope." }
      : { tone: "warning", title: "No active AVL vehicles are reporting.", action: "Select an Event to see plan membership and geofence scope." };
  }

  if (activePlanCount === 0) {
    return { tone: "warning", title: "This Event has no active operating period.", action: "Create or activate an operating period in Event Planning." };
  }
  if (requiresPlanSelection) {
    return { tone: "warning", title: "Select an operating period to monitor this Event.", action: "Choose one active Service Plan before opening live vehicles, alerts, and scope-specific controls." };
  }
  if (missingPublishedScopePlanNames.length > 0) {
    return { tone: "error", title: "Published Event AVL scope is unavailable.", action: "Repair or reactivate this operating period in Event Planning before monitoring." };
  }
  if (health === null && vehicles === null) {
    return { tone: "error", title: "Event AVL data is unavailable.", action: "The API health or vehicle-position feed could not be reached." };
  }
  if (vehicles === null) {
    return { tone: "info", title: "Connecting to Event AVL data…", action: null };
  }
  if (vehicles.length > 0 && vehicles.every((vehicle) => Boolean((vehicle as { is_stale?: boolean }).is_stale))) {
    return { tone: "warning", title: "Event AVL positions are stale.", action: "Live positions remain visible but do not support reporting-now claims." };
  }
  if (degradedComponentNames.length > 0) {
    return { tone: "warning", title: "Event AVL is degraded.", action: `Vehicle positions remain visible; ${degradedComponentNames.join(", ")} cannot support every monitoring claim or action.` };
  }
  if (vehicles.length) {
    return { tone: "success", title: "Event AVL data is flowing.", action: null };
  }
  return { tone: "warning", title: "No active vehicles are reporting.", action: "No active vehicles matched this Event operating context." };
}
