export type SubscriberDeliveryChannel = "SMS" | "Email";

export function channelRequested(
  channels: string[] | null,
  channel: SubscriberDeliveryChannel,
): boolean {
  // Legacy messages stored null/empty to mean all available channels.
  if (!channels || channels.length === 0) return true;
  const expected = channel.toLowerCase();
  return channels.some(
    (value) => typeof value === "string" && value.trim().toLowerCase() === expected,
  );
}

export function teamsTargets(channels: string[] | null): string[] {
  if (!channels) return [];
  const prefix = "teams:";
  return channels
    .filter(
      (value) =>
        typeof value === "string" &&
        value.trim().toLowerCase().startsWith(prefix),
    )
    .map((value) => value.trim().slice(prefix.length).trim())
    .filter(Boolean);
}

/**
 * What a send attempt is logged as.
 *
 * "skipped" is not a failure: it is ACS not being configured, which the
 * sender reports without trying. Logging it as "failed" made an environment
 * with no email set up look like one where every email bounced.
 */
export function deliveryLogStatus(res: { sent: boolean; skipped?: string }): "sent" | "skipped" | "failed" {
  if (res.sent) return "sent";
  return res.skipped ? "skipped" : "failed";
}
