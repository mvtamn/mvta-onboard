import type { Detour, DetourCommunication, DetourContractorNotification } from "@mvta/shared";
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

export interface AudiencePlanItem {
  audience: string;
  progress: AudienceProgress;
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
export function audiencePlan(detour: Pick<Detour, "notification_audiences" | "notification_channels" | "required_audiences">, communications: DetourCommunication[], contractor?: DetourContractorNotification | null): AudiencePlanItem[] {
  const channels = detour.notification_channels ?? [];
  return (detour.required_audiences ?? detour.notification_audiences ?? []).map((audience) => {
    const mine = communications.filter((c) => key(c.audience) === key(audience));
    const progress: AudienceProgress = mine.some((c) => c.status === "published") ? "published" : mine.length > 0 ? "draft" : "none";
    const isContractor = Boolean(contractor?.name && key(contractor.name) === key(audience));
    return { audience, progress, channels: isContractor ? ["email"] : channels, contractor: isContractor, recipients: isContractor ? contractor!.recipients : [] };
  });
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
