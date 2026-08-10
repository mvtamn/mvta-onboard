export type EventRouteCategory = "FixedRoute" | "SpecialEvent" | "OnDemand" | "Unclassified";
export type EventPlanStatus = "draft" | "review" | "approved" | "active" | "suspended" | "completed";

export interface EventScopeObservation {
  routeCategory: EventRouteCategory;
  routeIsActive: boolean;
  planStatus: EventPlanStatus | null;
  planStartDate: string | null;
  planEndDate: string | null;
  serviceDate: string;
  routeLinked: boolean;
  geofenceLinked: boolean;
  geofenceActive: boolean;
  hasDirectionRule: boolean;
}

export type EventScopeDecision =
  | { kind: "operational"; reason: "in_active_scope" }
  | { kind: "unplanned"; reason: "no_active_service_plan" }
  | { kind: "out_of_scope"; reason: "route_not_special_event" | "route_inactive" | "route_not_linked" | "outside_operating_period" | "geofence_not_covered" | "geofence_inactive" | "direction_rule_not_covered" };

export function classifyEventScope(observation: EventScopeObservation): EventScopeDecision {
  if (observation.routeCategory !== "SpecialEvent") return { kind: "out_of_scope", reason: "route_not_special_event" };
  if (!observation.routeIsActive) return { kind: "out_of_scope", reason: "route_inactive" };
  if (observation.planStatus !== "active") return { kind: "unplanned", reason: "no_active_service_plan" };
  if (!observation.routeLinked) return { kind: "out_of_scope", reason: "route_not_linked" };
  if ((observation.planStartDate && observation.serviceDate < observation.planStartDate)
      || (observation.planEndDate && observation.serviceDate > observation.planEndDate)) {
    return { kind: "out_of_scope", reason: "outside_operating_period" };
  }
  if (!observation.geofenceLinked) return { kind: "out_of_scope", reason: "geofence_not_covered" };
  if (!observation.geofenceActive) return { kind: "out_of_scope", reason: "geofence_inactive" };
  if (!observation.hasDirectionRule) return { kind: "out_of_scope", reason: "direction_rule_not_covered" };
  return { kind: "operational", reason: "in_active_scope" };
}
