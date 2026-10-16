import type { ObservedCell, ObservedReading, ObservedTimepoint, TimepointSegmentDetail } from "@mvta/shared";

// One grid per direction (Schedule Review redesign): each row is a timepoint
// segment in running order, each column an hour, and each cell holds the
// scheduled minutes for a bus leaving the segment's first timepoint that hour
// above the share of departures from its last timepoint that left late or
// early that hour, as Avail counted them. Schedule and street in one place,
// keyed by the same hour (the server files segment minutes by departure hour
// since v1.5.334).

export const DIRECTION_LABELS: Record<string, string> = { N: "Northbound", S: "Southbound", E: "Eastbound", W: "Westbound" };

export interface ObservedMark {
  kind: "late" | "early" | "ok";
  pct: number;
  departures: number;
  /** 0 quiet, 1 noticeable (10-24%), 2 strong (25%+); early is never louder than 1. */
  level: 0 | 1 | 2;
  text: string;
}

export interface GridCell {
  hour: number;
  /** "7" or "7-9"; null when no trip runs the segment that hour. */
  scheduled: string | null;
  observed: ObservedMark | null;
  label: string;
}

export interface GridRow {
  key: string;
  /** null for the first row: departures from the direction's first timepoint. */
  segment: TimepointSegmentDetail | null;
  from: string;
  to: string | null;
  miles: number | null;
  flat: boolean;
  measured: boolean;
  readings: ObservedReading[];
  cells: GridCell[];
}

export function hourLabel(hour: number): string {
  return `${hour % 12 === 0 ? 12 : hour % 12}${hour < 12 ? "a" : "p"}`;
}

export function observedMark(cell: ObservedCell): ObservedMark {
  if (cell.late_pct === 0 && cell.early_pct === 0) return { kind: "ok", pct: 0, departures: cell.departures, level: 0, text: "ok" };
  if (cell.late_pct >= cell.early_pct) {
    const level = cell.late_pct >= 25 ? 2 : cell.late_pct >= 10 ? 1 : 0;
    return { kind: "late", pct: cell.late_pct, departures: cell.departures, level, text: `${cell.late_pct}L` };
  }
  // Early is shown in its own colour and never at the strongest weight: the
  // critique found strong-early cells louder than strong-late ones.
  return { kind: "early", pct: cell.early_pct, departures: cell.departures, level: cell.early_pct >= 10 ? 1 : 0, text: `${cell.early_pct}E` };
}

function sameDirection(avail: string | null, segment: string | null): boolean {
  if (!segment) return true;
  return (avail ?? "").trim().charAt(0).toUpperCase() === segment;
}

/** The directions the route's segments run, in first-seen order; [null] when none carries one. */
export function gridDirections(segments: readonly TimepointSegmentDetail[]): (string | null)[] {
  const seen: (string | null)[] = [];
  for (const s of segments) {
    const d = s.direction ?? null;
    if (!seen.includes(d)) seen.push(d);
  }
  const named = seen.filter((d) => d !== null);
  return named.length > 0 ? named : [null];
}

/**
 * Segments in running order: start where no other segment of this direction
 * ends, follow from-to links, then append whatever branches are left in the
 * order the review listed them.
 */
export function runningOrder(segments: readonly TimepointSegmentDetail[]): TimepointSegmentDetail[] {
  const remaining = [...segments];
  const ordered: TimepointSegmentDetail[] = [];
  const ends = new Set(segments.map((s) => s.to_stop_id));
  // Each pass moves one segment, so this ends after segments.length passes.
  while (remaining.length > 0) {
    const last = ordered[ordered.length - 1];
    const next = (last ? remaining.find((s) => s.from_stop_id === last.to_stop_id) : undefined)
      ?? remaining.find((s) => !ends.has(s.from_stop_id))
      ?? remaining[0];
    ordered.push(next);
    remaining.splice(remaining.indexOf(next), 1);
  }
  return ordered;
}

export function buildGrid(
  segments: readonly TimepointSegmentDetail[],
  direction: string | null,
  timepoints: readonly ObservedTimepoint[] | null,
  readings: readonly ObservedReading[],
): { hours: number[]; rows: GridRow[] } {
  const mine = runningOrder(segments.filter((s) => direction === null || (s.direction ?? null) === direction));
  const observedAt = (stopId: string): ObservedTimepoint[] =>
    (timepoints ?? []).filter((t) => t.stop_id === stopId && sameDirection(t.direction, direction));
  const cellsAt = (stopId: string) => {
    const byHour = new Map<number, ObservedCell>();
    for (const tp of observedAt(stopId)) {
      for (const c of tp.hours) {
        const prev = byHour.get(c.hour);
        // Two Avail rows at one stop and direction (rare): keep the busier hour.
        if (!prev || c.departures > prev.departures) byHour.set(c.hour, c);
      }
    }
    return byHour;
  };

  const hourSet = new Set<number>();
  for (const s of mine) for (const h of s.hours) hourSet.add(h.hour);
  const origin = mine[0]?.from_stop_id;
  const stops = [origin, ...mine.map((s) => s.to_stop_id)].filter((x): x is string => Boolean(x));
  for (const stop of stops) for (const h of cellsAt(stop).keys()) hourSet.add(h);
  const hours = [...hourSet].sort((a, b) => a - b);

  const cellsFor = (scheduled: Map<number, string>, observed: Map<number, ObservedCell>): GridCell[] =>
    hours.map((hour) => {
      const s = scheduled.get(hour) ?? null;
      const o = observed.get(hour);
      const mark = o ? observedMark(o) : null;
      const said = mark ? (mark.kind === "ok" ? "none late or early" : `${mark.pct}% ${mark.kind}`) + `, ${mark.departures} departures` : "not measured";
      return { hour, scheduled: s, observed: mark, label: `${hourLabel(hour)}: ${s === null ? "no trips" : `${s} min scheduled`}, ${said}` };
    });

  const rows: GridRow[] = [];
  if (mine.length > 0 && origin) {
    const o = cellsAt(origin);
    rows.push({
      key: `origin-${origin}`, segment: null, from: mine[0].from_stop_name, to: null, miles: null, flat: false,
      measured: o.size > 0, readings: [], cells: cellsFor(new Map(), o),
    });
  }
  for (const s of mine) {
    const scheduled = new Map(s.hours.map((h) => [h.hour, h.min_minutes === h.max_minutes ? String(h.min_minutes) : `${h.min_minutes}-${h.max_minutes}`]));
    const o = cellsAt(s.to_stop_id);
    rows.push({
      key: `${s.from_stop_id}-${s.to_stop_id}`,
      segment: s,
      from: s.from_stop_name,
      to: s.to_stop_name,
      miles: s.miles,
      flat: s.flat_all_day === true,
      measured: o.size > 0,
      readings: readings.filter((r) => r.from_stop_id === s.from_stop_id && r.to_stop_id === s.to_stop_id && (direction === null || r.direction === null || r.direction === direction)),
      cells: cellsFor(scheduled, o),
    });
  }
  return { hours, rows };
}
