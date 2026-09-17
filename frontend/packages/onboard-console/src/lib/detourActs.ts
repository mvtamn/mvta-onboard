// What the console offers on a Detour, read from the acts the API says are
// available (the Detour workflow module decides them). The console does not
// re-derive workflow rules from lifecycle_state or fulfillment_mode.
import type { Detour, DetourOfferedAct } from "@mvta/shared";

export interface ActOffer {
  // Whether the control appears at all.
  show: boolean;
  enabled: boolean;
  // Why an offered act cannot be taken yet.
  reason: string | null;
}

// Refusals that mean "not yet" rather than "does not apply": the control is
// shown, disabled, with the reason, so the person knows what to do first.
const HELD_CODES = new Set(["conflict_unresolved", "re_review_outstanding"]);

const HIDDEN: ActOffer = { show: false, enabled: false, reason: null };

export function actOffer(d: Pick<Detour, "available_acts">, act: DetourOfferedAct): ActOffer {
  const availability = d.available_acts?.[act];
  if (!availability) return HIDDEN;
  if (availability.available) return { show: true, enabled: true, reason: null };
  return HELD_CODES.has(availability.code) ? { show: true, enabled: false, reason: availability.reason } : HIDDEN;
}

// Recording an Avail result is one control for three results. It appears when
// any result can be recorded; confirming it as entered may still be held.
export function availEntryOffer(d: Pick<Detour, "available_acts">): { show: boolean; entered: ActOffer } {
  const entered = actOffer(d, "avail_entry.entered");
  const other = [actOffer(d, "avail_entry.conflict"), actOffer(d, "avail_entry.not_entered")];
  return { show: entered.enabled || other.some((o) => o.enabled), entered };
}
