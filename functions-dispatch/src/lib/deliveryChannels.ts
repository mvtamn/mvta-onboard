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
