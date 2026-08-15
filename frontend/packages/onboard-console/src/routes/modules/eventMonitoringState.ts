import type { Event, EventServicePlan } from "@mvta/shared";

const workableStatuses = new Set<EventServicePlan["status"]>(["draft", "review", "approved"]);

/** Prefer an operating Event that can actually drive Event AVL. */
export function defaultMonitoringEventId(events: Event[], plans: EventServicePlan[]): string {
  const activeEvent = events.find((event) => plans.some((plan) => plan.event_id === event.id && plan.status === "active"));
  if (activeEvent) return activeEvent.id;
  const preparedEvent = events.find((event) => plans.some((plan) => plan.event_id === event.id && workableStatuses.has(plan.status)));
  return preparedEvent?.id ?? "";
}

export function activePlansMissingPublishedScope(plans: EventServicePlan[]): EventServicePlan[] {
  return plans.filter((plan) => plan.status === "active" && !plan.published_scope);
}

/** No selected Event means the live map should use the shared AVL feed. */
export function eventVehiclePositionQuery(eventId: string, servicePlanId: string): { eventId?: string; servicePlanId?: string } {
  return { eventId: eventId || undefined, servicePlanId: servicePlanId || undefined };
}
