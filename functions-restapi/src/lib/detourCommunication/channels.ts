// The channels a Detour communication can go out on, and which of them OnBoard
// sends.
//
// `channel` used to be any non-empty string the server accepted, and the intake
// form offered four chips plus free text - so "radio", "Radio " and "dispatch
// board" were three channels, none of them deliverable, and nothing told a
// reader which ones the app could actually send. Naming them settles that once:
// a channel either has a delivery port behind it, or it is a record that a
// person did something elsewhere.
//
// Radio is deliberately absent. No Detour has ever used it (CONTEXT: the
// channel list is what the record requires, not what exists in the world), and
// a channel nobody can send and nobody used is noise on every form.

/** Sent by OnBoard through a delivery port. */
export const SENT_CHANNELS = ["email", "sms", "teams"] as const;

/**
 * Recorded by a person: the message went out somewhere OnBoard does not reach.
 * Avail messaging happens in Avail; signage is updated by whoever updates the
 * signs. The record answers "has anyone told them?" in one place.
 */
export const RECORDED_CHANNELS = ["digital_signage", "avl_messaging"] as const;

export const DETOUR_CHANNELS = [...SENT_CHANNELS, ...RECORDED_CHANNELS] as const;

export type SentChannel = (typeof SENT_CHANNELS)[number];
export type RecordedChannel = (typeof RECORDED_CHANNELS)[number];
export type DetourChannel = (typeof DETOUR_CHANNELS)[number];

export type ChannelKind = "sent" | "recorded";

const LABELS: Record<DetourChannel, string> = {
  email: "Email",
  sms: "Text message",
  teams: "Teams",
  digital_signage: "Digital signage",
  avl_messaging: "AVL messaging",
};

// What a channel was called before this list existed. Stored rows and older
// console tabs say "Teams", "Email" or "e-mail"; nothing on dev says anything,
// since no communication has ever been created, but a name that used to be
// accepted should not become an error. Lookup ignores case, spaces, hyphens and
// underscores, so "AVL messaging", "avl-messaging" and "avl_messaging" are one
// channel rather than three.
const ALIASES: Record<string, DetourChannel> = {
  email: "email",
  sms: "sms",
  text: "sms",
  textmessage: "sms",
  teams: "teams",
  microsoftteams: "teams",
  digitalsignage: "digital_signage",
  signage: "digital_signage",
  avlmessaging: "avl_messaging",
  avl: "avl_messaging",
};

const normalize = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

/** The channel a stored or submitted string names, or null if it names none. */
export function detourChannel(value: string | null | undefined): DetourChannel | null {
  const wanted = normalize(value ?? "");
  if (!wanted) return null;
  return ALIASES[wanted] ?? DETOUR_CHANNELS.find((channel) => normalize(channel) === wanted) ?? null;
}

export function channelKind(channel: DetourChannel): ChannelKind {
  return (SENT_CHANNELS as readonly string[]).includes(channel) ? "sent" : "recorded";
}

export function isRecordedChannel(channel: DetourChannel): boolean {
  return channelKind(channel) === "recorded";
}

export function channelLabel(channel: DetourChannel): string {
  return LABELS[channel];
}

/**
 * Only a sent channel needs somewhere to send to. Publishing used to demand a
 * recipients string for every channel, which a recorded one can never have:
 * nobody types an address for a road sign.
 */
export function needsRecipients(channel: DetourChannel): boolean {
  return channel === "email" || channel === "sms";
}

/** What the console offers, in the order it offers them. */
export function channelOptions(): { channel: DetourChannel; label: string; kind: ChannelKind }[] {
  return DETOUR_CHANNELS.map((channel) => ({ channel, label: channelLabel(channel), kind: channelKind(channel) }));
}
