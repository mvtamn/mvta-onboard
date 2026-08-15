export function isTransientNotificationFailure(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function retryDelaySeconds(attempt: number): number {
  return Math.min(24 * 60 * 60, 30 * 2 ** Math.max(0, attempt - 1));
}

export function notificationHasExpired(createdAt: Date | string, now = new Date()): boolean {
  return now.getTime() - new Date(createdAt).getTime() >= 24 * 60 * 60 * 1000;
}

export function formatEventGeofenceMessage(input: { vehicle_id: number; route_id: number | null; transition: "enter" | "exit"; geofence_name: string; destination_label: string | null }): string {
  const route = input.route_id === null ? " on an unknown route" : ` on Route ${input.route_id}`;
  return `Bus ${input.vehicle_id}${route} ${input.transition === "enter" ? "entered" : "exited"} ${input.geofence_name}${input.destination_label ? `; ${input.destination_label}` : ""}.`;
}
