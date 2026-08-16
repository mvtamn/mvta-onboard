export function isTransientNotificationFailure(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function retryDelaySeconds(attempt: number): number {
  return Math.min(24 * 60 * 60, 30 * 2 ** Math.max(0, attempt - 1));
}

export function notificationHasExpired(createdAt: Date | string, now = new Date()): boolean {
  return now.getTime() - new Date(createdAt).getTime() >= 24 * 60 * 60 * 1000;
}

export function shouldAutomaticallyDeliver(automaticTeamsEnabled: boolean, matchedRuleId: string | null | undefined): boolean {
  return automaticTeamsEnabled && Boolean(matchedRuleId);
}

export function formatEventGeofenceMessage(input: { vehicle_id: number; route_id: number | null; transition: "enter" | "exit"; geofence_name: string; destination_label: string | null; message_type?: "departing" | "passed" | "arriving_soon" | "custom"; location_name?: string | null }): string {
  const route = input.route_id === null ? " on an unknown route" : ` on Route ${input.route_id}`;
  const location = input.location_name?.trim() || input.geofence_name;
  const additionalContext = input.destination_label?.trim() ? `; ${input.destination_label.trim()}` : "";
  if (input.message_type === "departing") return `Bus ${input.vehicle_id}${route} is departing ${location}${additionalContext}.`;
  if (input.message_type === "passed") return `Bus ${input.vehicle_id}${route} has passed ${location}${additionalContext}.`;
  if (input.message_type === "arriving_soon") return `Bus ${input.vehicle_id}${route} is arriving at ${location} soon${additionalContext}.`;
  return `Bus ${input.vehicle_id}${route} ${input.transition === "enter" ? "entered" : "exited"} ${input.geofence_name}${input.destination_label ? `; ${input.destination_label}` : ""}.`;
}
