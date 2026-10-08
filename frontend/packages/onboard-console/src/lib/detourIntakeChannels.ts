// Which channel chips the Detour Intake form shows.
//
// Intake used to carry its own list - `["email", "radio", "Teams", "dispatch
// board"]`, seeded with email and radio - plus a free-text "+ Other" box. None
// of it matched what a communication can go out on: radio was deliberately
// dropped when the channels were named (nothing sends it and no detour ever
// used it), "dispatch board" was never a channel, and a typed-in name was a
// channel of one. So an intake could require something the composer in Detours
// & Closures had no way to offer, and nobody found out until somebody went
// looking for it there.
//
// The server now sends the authoritative list with the intake rows, and this
// decides what to render from it.
import type { DetourChannelOption } from "@mvta/shared";

export interface ChannelChip {
  channel: string;
  label: string;
  /** Sent by OnBoard, or recorded by a person who sent it elsewhere. */
  kind: "sent" | "recorded" | "retired";
  selected: boolean;
  /**
   * A value this record already carries that is no longer offered. It stays
   * visible - the record said what it said - but it can only be removed.
   */
  retired: boolean;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The offered channels first, then anything this record already names that is
 * no longer offered. A retired value is never silently dropped: it is shown,
 * marked, and removable.
 */
export function channelChips(
  available: readonly DetourChannelOption[],
  selected: readonly string[],
): ChannelChip[] {
  const chips: ChannelChip[] = available.map((option) => ({
    channel: option.channel,
    label: option.label,
    kind: option.kind,
    selected: selected.some((value) => same(value, option.channel)),
    retired: false,
  }));
  for (const value of selected) {
    if (available.some((option) => same(option.channel, value))) continue;
    if (chips.some((chip) => chip.retired && same(chip.channel, value))) continue;
    chips.push({ channel: value, label: value, kind: "retired", selected: true, retired: true });
  }
  return chips;
}

/** Toggling a chip. A retired value can be removed but never added back. */
export function toggleChannel(selected: readonly string[], chip: ChannelChip): string[] {
  if (chip.selected) return selected.filter((value) => !same(value, chip.channel));
  return chip.retired ? [...selected] : [...selected, chip.channel];
}

/** What a retired chip says when somebody hovers it. */
export function retiredHint(label: string): string {
  return `${label} is no longer a channel OnBoard offers. It stays on this record; remove it to stop requiring it.`;
}

/** Whether the form can be saved: at least one channel that can still be used. */
export function hasUsableChannel(chips: readonly ChannelChip[]): boolean {
  return chips.some((chip) => chip.selected && !chip.retired);
}
