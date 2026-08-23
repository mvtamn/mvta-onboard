export function isTransientNotificationFailure(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function retryDelaySeconds(attempt: number): number {
  return Math.min(24 * 60 * 60, 30 * 2 ** Math.max(0, attempt - 1));
}

export function notificationHasExpired(createdAt: Date | string, now = new Date()): boolean {
  return now.getTime() - new Date(createdAt).getTime() >= 24 * 60 * 60 * 1000;
}

export function isWithinMovementNotificationCooldown(previousDetectedAt: Date | string | null, detectedAt: Date | string, cooldownSeconds = 60): boolean {
  if (!previousDetectedAt) return false;
  const elapsed = new Date(detectedAt).getTime() - new Date(previousDetectedAt).getTime();
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed < cooldownSeconds * 1_000;
}

export function shouldAutomaticallyDeliver(automaticTeamsEnabled: boolean, matchedRuleId: string | null | undefined): boolean {
  return automaticTeamsEnabled && Boolean(matchedRuleId);
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

export function formatEventGeofenceMessage(input: { vehicle_id: number; route_id: number | null; transition: "enter" | "exit"; geofence_name: string; geofence_purpose: string | null; destination_label: string | null; crossed_at: Date | string; message_type?: "departing" | "passed" | "arriving_soon" | "custom"; send_mode?: "manual" | "auto" | null; location_name?: string | null }): string {
  const route = input.route_id === null ? " on an unknown route" : ` on Route ${input.route_id}`;
  const location = input.location_name?.trim() || input.geofence_name;
  const additionalContext = input.destination_label?.trim() ? `; ${input.destination_label.trim()}` : "";
  const message = input.message_type === "departing" ? `Bus ${input.vehicle_id}${route} is departing ${location}${additionalContext}.`
    : input.message_type === "passed" ? `Bus ${input.vehicle_id}${route} has passed ${location}${additionalContext}.`
      : input.message_type === "arriving_soon" ? `Bus ${input.vehicle_id}${route} is arriving at ${location} soon${additionalContext}.`
        : `Bus ${input.vehicle_id}${route} ${input.transition === "enter" ? "entered" : "exited"} ${input.geofence_name}${input.destination_label ? `; ${input.destination_label}` : ""}.`;
  const crossedAt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "2-digit", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true, timeZoneName: "short" }).format(new Date(input.crossed_at));
  return `${message}\n\nGeofence: ${input.geofence_name}${input.geofence_purpose ? ` (${input.geofence_purpose})` : ""}\nConfiguration: ${input.transition} transition · ${input.message_type ?? "custom"} message · ${input.send_mode ?? "manual"} delivery\nCrossed: ${crossedAt}`;
}
