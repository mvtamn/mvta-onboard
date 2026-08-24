export function isTransientNotificationFailure(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function retryDelaySeconds(attempt: number): number {
  return Math.min(24 * 60 * 60, 30 * 2 ** Math.max(0, attempt - 1));
}

export function notificationHasExpired(createdAt: Date | string, now = new Date()): boolean {
  return now.getTime() - new Date(createdAt).getTime() >= 24 * 60 * 60 * 1000;
}

export const MOVEMENT_NOTIFICATION_COOLDOWN_SECONDS = 60;
export const MOVEMENT_NOTIFICATION_COOLDOWN_REASON = "Suppressed by the 60-second movement notification cooldown";

export function shouldAutomaticallyDeliver(
  automaticTeamsEnabled: boolean,
  matchedRuleId: string | null | undefined,
  sendMode: "manual" | "auto" | null | undefined,
): boolean {
  return automaticTeamsEnabled && Boolean(matchedRuleId) && sendMode === "auto";
}

export function formatTeamsWebhookPayload(text: string) {
  return {
    type: "message",
    attachments: [{
      contentType: "application/vnd.microsoft.card.adaptive",
      contentUrl: null,
      content: {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        type: "AdaptiveCard",
        version: "1.2",
        body: [{ type: "TextBlock", text, wrap: true }],
      },
    }],
  };
}

export function formatEventGeofenceMessage(input: { vehicle_id: number; route_id: number | null; route_label?: string | null; transition: "enter" | "exit"; geofence_name: string; geofence_purpose: string | null; destination_label: string | null; crossed_at: Date | string; message_type?: "departing" | "passed" | "arriving_soon" | "custom"; send_mode?: "manual" | "auto" | null; location_name?: string | null }): string {
  const vehicle = input.route_id === null
    ? `Route unavailable (Vehicle ${input.vehicle_id})`
    : `${input.route_label ? `${input.route_label}: ` : ""}Route ${input.route_id} (Vehicle ${input.vehicle_id})`;
  const location = input.location_name?.trim() || input.geofence_name;
  const additionalContext = input.destination_label?.trim() ? `; ${input.destination_label.trim()}` : "";
  const message = input.message_type === "departing" ? `${vehicle} is departing ${location}${additionalContext}.`
    : input.message_type === "passed" ? `${vehicle} has passed ${location}${additionalContext}.`
      : input.message_type === "arriving_soon" ? `${vehicle} is arriving at ${location} soon${additionalContext}.`
        : `${vehicle} ${input.transition === "enter" ? "entered" : "exited"} ${input.geofence_name}${input.destination_label ? `; ${input.destination_label}` : ""}.`;
  const crossedAt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "2-digit", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true, timeZoneName: "short" }).format(new Date(input.crossed_at));
  return `${message}\n\nGeofence: ${input.geofence_name}${input.geofence_purpose ? ` (${input.geofence_purpose})` : ""}\nConfiguration: ${input.transition} transition · ${input.message_type ?? "custom"} message · ${input.send_mode ?? "manual"} delivery\nCrossed: ${crossedAt}`;
}
