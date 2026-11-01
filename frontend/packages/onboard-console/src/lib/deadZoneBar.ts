// The GPS dead-zone bar on the Missed-trip Detectors page: which first stops a
// bar flags, and what moving it would change, before anything is saved.
//
// isLikelyDeadZone is the server's rule (functions-restapi
// lib/missedTripCase/deadZone.ts), repeated so a draft can be previewed
// without a round trip. The table shows each stop's whole record; a case is
// measured against the other cases at its stop, so on a case the figures read
// one lower.
import type { DeadZoneBar, FirstStopRecord, MissedTripDeadZones } from "@mvta/shared";

export function isLikelyDeadZone(cases: number, ran: number, bar: DeadZoneBar): boolean {
  return cases > 0 && cases >= bar.min_cases && (ran / cases) * 100 >= bar.ran_percent;
}

export interface DeadZoneRow {
  stop_id: string;
  name: string;
  cases: number;
  ran: number;
  /** Share run, rounded down, so 71.4% never shows as a bar it does not meet. */
  percent: number;
  /** Flagged at the draft bar. */
  flagged: boolean;
  /** How the draft differs from the saved bar for this stop. */
  change: "added" | "removed" | null;
}

export function deadZoneRows(stops: readonly FirstStopRecord[], saved: DeadZoneBar, draft: DeadZoneBar): DeadZoneRow[] {
  return stops.map((stop) => {
    const now = isLikelyDeadZone(stop.cases, stop.ran, saved);
    const then = isLikelyDeadZone(stop.cases, stop.ran, draft);
    return {
      stop_id: stop.stop_id,
      name: stop.name ?? `Stop ${stop.stop_id}`,
      cases: stop.cases,
      ran: stop.ran,
      percent: stop.cases === 0 ? 0 : Math.floor((stop.ran / stop.cases) * 100),
      flagged: then,
      change: now === then ? null : then ? "added" : "removed",
    };
  });
}

export function barSummary(rows: readonly DeadZoneRow[]): string {
  if (rows.length === 0) return "No first stop has a judged no-show yet.";
  const flagged = rows.filter((row) => row.flagged).length;
  const savedFlagged = rows.filter((row) => (row.change === null ? row.flagged : row.change === "removed")).length;
  const noun = rows.length === 1 ? "stop" : "stops";
  if (flagged === savedFlagged && rows.every((row) => row.change === null)) {
    return `${flagged} of ${rows.length} ${noun} ${flagged === 1 ? "is" : "are"} flagged.`;
  }
  const direction = flagged >= savedFlagged ? "up" : "down";
  return `${flagged} of ${rows.length} ${noun} would be flagged, ${direction} from ${savedFlagged}.`;
}

export interface BarDraft {
  ran_percent: string;
  min_cases: string;
}

export function barDraftErrors(draft: BarDraft, limits: MissedTripDeadZones["limits"]): Partial<Record<keyof BarDraft, string>> {
  const errors: Partial<Record<keyof BarDraft, string>> = {};
  const whole = (text: string, min: number, max: number) => {
    const value = Number(text);
    return text.trim() !== "" && Number.isInteger(value) && value >= min && value <= max;
  };
  if (!whole(draft.ran_percent, limits.ran_percent.min, limits.ran_percent.max)) {
    errors.ran_percent = `Enter a whole percent from ${limits.ran_percent.min} to ${limits.ran_percent.max}.`;
  }
  if (!whole(draft.min_cases, limits.min_cases.min, limits.min_cases.max)) {
    errors.min_cases = `Enter a whole number from ${limits.min_cases.min} to ${limits.min_cases.max}.`;
  }
  return errors;
}

/** The draft as a bar, or the saved bar where a field is not yet valid. */
export function draftBar(draft: BarDraft, saved: DeadZoneBar, errors: Partial<Record<keyof BarDraft, string>>): DeadZoneBar {
  return {
    ran_percent: errors.ran_percent ? saved.ran_percent : Number(draft.ran_percent),
    min_cases: errors.min_cases ? saved.min_cases : Number(draft.min_cases),
  };
}
