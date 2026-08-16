import type { Event, EventServicePlan } from "@mvta/shared";

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
