import type { Detour, DetourAudienceEligibility, DetourChannelOption, DetourCommunication, DetourCommunicationEligibility, DetourContractorNotification } from "@mvta/shared";
import { dateLabel } from "./detourDates.js";

// Prefill for the Detour communications composer.
//
// The intake records which audiences and channels a Detour must reach,
// and the server derives communication_status by counting distinct
// PUBLISHED audiences against that list (detoursList.ts). The match is on
// the audience string, so the composer must offer those exact strings
// rather than free text - otherwise "needs communication" could only be
// cleared by guessing them. This module turns the requirement into a
// per-audience checklist and a starting draft built from the record.

export type AudienceProgress = "published" | "draft" | "none";

/**
 * Where one message stands: a Detour reaches an audience on each channel the
 * record requires, and the wording is rarely the same on all of them - a text
 * message says less than an email. So a message is one per audience AND
 * channel, and an audience is only told once every channel it needs has gone.
 */
export interface AudienceChannelState {
  channel: string;
  progress: AudienceProgress;
  /** The message that exists for this pair, if one does. */
  communicationId?: string;
}

export interface AudiencePlanItem {
  audience: string;
  /**
   * The audience as a whole: published only when every required channel is,
   * draft when any message exists, none when none does.
   */
  progress: AudienceProgress;
  /** One entry per required channel, in the order the record requires them. */
  perChannel: AudienceChannelState[];
  /**
   * Detour communication eligibility for this audience, as the server decided
   * it. Undefined on a server older than 1.5.249, where the console shows the
   * old behaviour rather than guessing at a rule it does not own.
   */
  eligibility?: DetourCommunicationEligibility;
  // Channels required by the record. The composer defaults to the first.
  channels: string[];
  // The configured fixed-route contractor: always by email, to the
  // configured recipients.
  contractor: boolean;
  recipients: string[];
}

// Audience matching is case- and whitespace-insensitive, like a person
// would read it; the server's DISTINCT is exact, so the composer still
// submits the required string verbatim.
function key(value: string): string {
  return value.trim().toLowerCase();
}

// required_audiences is server-computed and includes the configured
// contractor on fixed-route Detours; notification_audiences is the
// fallback for a response from before migration 089.
export function audiencePlan(
  detour: Pick<Detour, "notification_audiences" | "notification_channels" | "required_audiences" | "audience_eligibility">,
  communications: DetourCommunication[],
  contractor?: DetourContractorNotification | null,
): AudiencePlanItem[] {
  const channels = detour.notification_channels ?? [];
  const decided = new Map((detour.audience_eligibility ?? []).map((row: DetourAudienceEligibility) => [key(row.audience), row.eligibility]));
  return (detour.required_audiences ?? detour.notification_audiences ?? []).map((audience) => {
    const mine = communications.filter((c) => key(c.audience) === key(audience));
    const isContractor = Boolean(contractor?.name && key(contractor.name) === key(audience));
    const wanted = isContractor ? ["email"] : channels;
    const perChannel: AudienceChannelState[] = wanted.map((channel) => {
      const forChannel = mine.filter((c) => key(c.channel) === key(channel));
      const published = forChannel.find((c) => c.status === "published");
      const draft = forChannel[0];
      return {
        channel,
        progress: published ? "published" : draft ? "draft" : "none",
        communicationId: (published ?? draft)?.id,
      };
    });
    // Messages on a channel the record no longer requires still count as work
    // done - they are why the audience reads as started rather than untouched.
    const anyMessage = mine.length > 0;
    const progress: AudienceProgress = perChannel.length > 0 && perChannel.every((c) => c.progress === "published")
      ? "published"
      : anyMessage ? "draft" : "none";
    return {
      audience, progress, perChannel,
      eligibility: decided.get(key(audience)),
      channels: isContractor ? ["email"] : channels,
      contractor: isContractor,
      recipients: isContractor ? contractor!.recipients : [],
    };
  });
}

/**
 * What the Detour as a whole allows, for controls that are not tied to one
 * audience (the Send button on a saved draft). Drafting is refused only by a
 * closed Detour; sending is refused by the first thing to fix, and every
 * audience shares that reason apart from missing recipients.
 */
export function detourSendBlock(plan: AudiencePlanItem[]): { code: string; sentence: string } | null {
  const decided = plan.map((item) => item.eligibility).filter(Boolean) as DetourCommunicationEligibility[];
  if (decided.length === 0) return null;
  const blocking = decided.find((e) => e.refusal && e.refusal.code !== "no_recipients");
  return blocking?.refusal ?? null;
}

// A mailto: link carrying recipients, subject, and body, so a draft can be
// sent from the staff member's own mail client. There is no server-side
// sender; publishing records that this happened.
export function mailtoLink(recipients: string[], subject: string, body: string): string {
  return `mailto:${encodeURIComponent(recipients.join(","))}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function communicationSubject(detour: Pick<Detour, "internal_number" | "number" | "closure">): string {
  const ref = detour.internal_number || detour.number;
  return `${ref ? `[${ref}] ` : ""}Detour: ${detour.closure}`;
}

// The first required audience that has nothing published yet - what the
// composer should open on.
export function nextAudience(plan: AudiencePlanItem[]): AudiencePlanItem | null {
  return plan.find((item) => item.progress === "none") ?? plan.find((item) => item.progress === "draft") ?? null;
}

// A starting message assembled from the operational record. Staff edit
// before publishing; this exists so the draft never starts from a blank
// box when the record already says what needs saying.
export function draftCommunicationText(detour: Pick<Detour, "internal_number" | "number" | "closure" | "location" | "start_date" | "end_date" | "start_time" | "end_time" | "time_window_status" | "segments" | "action_instructions" | "riders_directed" | "affected_stops_and_stations" | "operational_impacts" | "confirmation_contact">, audience?: string): string {
  const ref = detour.internal_number || detour.number;
  const routes = detour.segments.map((s) => s.routes).filter(Boolean).join("; ");
  const when = (() => {
    const dates = detour.start_date || detour.end_date ? `${dateLabel(detour.start_date)} – ${detour.end_date ? dateLabel(detour.end_date) : "until further notice"}` : "Dates to be confirmed";
    const times = detour.start_time || detour.end_time ? ` ${detour.start_time ?? ""}${detour.end_time ? `–${detour.end_time}` : ""}`.trimEnd() : "";
    const status = detour.time_window_status === "estimated" ? " (estimated)" : detour.time_window_status === "pending" && (detour.start_date || detour.end_date) ? " (pending confirmation)" : "";
    return `${dates}${times}${status}`;
  })();
  const lines = [
    `${ref ? `${ref}: ` : ""}${detour.closure}`,
    detour.location ? `Location: ${detour.location}` : null,
    `When: ${when}`,
    routes ? `Routes: ${routes}` : null,
    detour.affected_stops_and_stations ? `Stops and stations: ${detour.affected_stops_and_stations}` : null,
    "",
    detour.action_instructions ? `Action: ${detour.action_instructions}` : null,
    detour.riders_directed ? `Riders: ${detour.riders_directed}` : null,
    detour.operational_impacts ? `Operational impacts: ${detour.operational_impacts}` : null,
    detour.segments.filter((s) => s.directions).map((s) => `${s.routes}: ${s.directions}`).join("\n") || null,
    detour.confirmation_contact ? `Questions: ${detour.confirmation_contact}` : null,
  ];
  const text = lines.filter((line): line is string => line !== null).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return audience ? `To ${audience}\n\n${text}` : text;
}

// What the buttons beside one saved draft should be.
//
// A channel OnBoard sends (email, text, Teams) offers Send, and is refused
// while the Detour blocks sending. A recorded channel - a road sign, an Avail
// message - never offers Send, and is NOT refused by a closed Detour, because
// writing down on Tuesday what went out on Monday is an accurate record rather
// than a late send (server: eligibility.ts).
export interface CommunicationAction {
  canSend: boolean;
  /** Asks for the date it went out before recording. */
  isRecorded: boolean;
  /** The label on the button that marks it done. */
  recordLabel: string;
  /** The sentence to show, or undefined when nothing blocks it. */
  blocked?: string;
}

export function communicationAction(
  communication: Pick<DetourCommunication, "channel" | "recipients" | "status" | "delivery_status">,
  option: DetourChannelOption | undefined,
  sendBlock: string | undefined,
): CommunicationAction {
  const isRecorded = option?.kind === "recorded";
  const canSend = !isRecorded && (communication.channel === "teams"
    || ((communication.channel === "email" || communication.channel === "sms") && Boolean(communication.recipients)));
  return {
    canSend,
    isRecorded,
    recordLabel: isRecorded
      ? `Record ${option?.label ?? "it"} went out`
      : canSend ? "Mark published (sent elsewhere)" : "Mark published",
    blocked: isRecorded ? undefined : sendBlock,
  };
}

/**
 * Content to start a new message from: the same audience on another channel
 * first, then the same channel to another audience.
 *
 * A text message and an email about one closure say the same thing at different
 * lengths, and retyping the second from scratch is how the two end up
 * contradicting each other. Seeding is a starting point, not a copy: whoever
 * writes it still has to edit it, which is the point of having both.
 */
export function copyFrom(
  communications: readonly DetourCommunication[],
  audience: string,
  channel: string,
): { content: string; from: string } | null {
  const sameAudience = communications.find((c) => key(c.audience) === key(audience) && key(c.channel) !== key(channel) && c.content.trim());
  if (sameAudience) return { content: sameAudience.content, from: `${sameAudience.audience} · ${sameAudience.channel}` };
  const sameChannel = communications.find((c) => key(c.channel) === key(channel) && key(c.audience) !== key(audience) && c.content.trim());
  if (sameChannel) return { content: sameChannel.content, from: `${sameChannel.audience} · ${sameChannel.channel}` };
  return null;
}

/**
 * Adding an audience the record does not name yet. It joins the Detour's own
 * list, so it is required like every other: somebody added it deliberately, and
 * a Detour is not fully communicated until they have been told.
 */
export function withAudience(existing: readonly string[], audience: string): string[] {
  const wanted = audience.trim();
  if (!wanted) return [...existing];
  if (existing.some((value) => key(value) === key(wanted))) return [...existing];
  return [...existing, wanted];
}

/** Why an audience cannot be added, or null when it can. */
export function audienceAddError(existing: readonly string[], audience: string): string | null {
  const wanted = audience.trim();
  if (!wanted) return "Name the audience to add.";
  if (wanted.length > 100) return "That name is too long for an audience.";
  if (existing.some((value) => key(value) === key(wanted))) return `${wanted} is already on this Detour.`;
  return null;
}
