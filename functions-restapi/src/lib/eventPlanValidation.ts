export interface EventPlanReadiness {
  routeCount: number;
  geofenceCount: number;
  geofencesWithRules: number;
  validDates: boolean;
  routeConflict: boolean;
}

export function validateEventPlanReadiness(readiness: EventPlanReadiness): { valid: true } | { valid: false; error: string } {
  if (readiness.routeConflict) return { valid: false, error: "A route is already covered by another active Event" };
  if (readiness.routeCount < 1) return { valid: false, error: "An active plan must include an active SpecialEvent route" };
  if (readiness.geofenceCount < 1) return { valid: false, error: "An active plan must include an active geofence" };
  if (readiness.geofencesWithRules < readiness.geofenceCount) return { valid: false, error: "Every linked geofence must have a direction rule" };
  if (!readiness.validDates) return { valid: false, error: "An active plan must have valid operating dates" };
  return { valid: true };
}
