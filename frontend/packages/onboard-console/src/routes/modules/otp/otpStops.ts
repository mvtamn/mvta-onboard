// A route's stops as stacked bars, worst first.
//
// The figures are the server's (lib/otpMonth's measureOtpRouteStops): each
// stop's share of the route's Official Departure OTP, by the same rule as the
// route row. This file only orders them and works out how wide each segment is.
//
// The monthly feed carries no stop sequence and no direction, and Avail's stop
// IDs have not been matched to GTFS, so stops cannot be drawn in the order a
// bus reaches them. Worst first is what a compliance reader wants anyway: the
// stops that pull the route down, at the top.
import type { OtpStopFigure, OtpStopMix } from "@mvta/shared";

/**
 * Below this many assessable departures in a month a stop's percentage moves
 * too far on a handful of trips to rank against the rest, so it sorts after
 * them and is drawn muted rather than leading the chart.
 */
export const LOW_VOLUME_DEPARTURES = 30;

export type StopBarKind = "measured" | "low_volume" | "excluded";

/** Segment widths, 0-1, on-time first so its edge reads against the target. */
export interface StopSegments {
  ontime: number;
  early: number;
  late: number;
  other: number;
}

export interface StopBar {
  key: string;
  stopId: number;
  name: string;
  kind: StopBarKind;
  /** Official Departure OTP for the stop, 0-100; null when nothing is assessable. */
  officialPct: number | null;
  /** The departures the bar is drawn from. */
  departures: number;
  segments: StopSegments;
  /** True when the early/late split is apportioned rather than counted (weather days). */
  approximate: boolean;
  belowTarget: boolean | null;
  note: string | null;
}

const EMPTY: StopSegments = { ontime: 0, early: 0, late: 0, other: 0 };

function shares(mix: OtpStopMix): StopSegments {
  if (mix.total <= 0) return EMPTY;
  return { ontime: mix.ontime / mix.total, early: mix.early / mix.total, late: mix.late / mix.total, other: mix.other / mix.total };
}

/**
 * A weather day's snapshot holds only total and on-time, so after one is
 * subtracted the stop's on-time share is exact but its early/late split is
 * not known. On-time is drawn from the official figure, so the bar and its
 * percentage agree, and what is left is apportioned in the proportions the
 * stop had before the date came out.
 */
function sharesAfterDates(stop: OtpStopFigure): StopSegments {
  const ontime = stop.assessable.pct ?? 0;
  const { early, late, other } = stop.mix;
  const notOntime = early + late + other;
  const rest = 1 - ontime;
  if (notOntime <= 0) return { ontime, early: 0, late: 0, other: rest };
  return { ontime, early: rest * early / notOntime, late: rest * late / notOntime, other: rest * other / notOntime };
}

const asPercent = (share: number | null) => share === null ? null : Math.round(share * 1000) / 10;

function excludedNote(stop: OtpStopFigure, routeMeasured: boolean): string {
  if (!routeMeasured) return "Route is outside the fixed-route standard";
  if (stop.excluded_days.length > 0) return `Excluded: ${stop.excluded_days.join(", ")}`;
  return "Every departure removed by weather days";
}

export function stopBar(stop: OtpStopFigure, target: number, routeMeasured: boolean): StopBar {
  const name = stop.stop_name ?? `Stop ${stop.stop_id}`;
  const base = { key: String(stop.stop_id), stopId: stop.stop_id, name };

  if (stop.assessable.departures <= 0) {
    return {
      ...base, kind: "excluded", officialPct: null, departures: stop.raw.departures,
      segments: shares(stop.raw_mix), approximate: false, belowTarget: null,
      note: excludedNote(stop, routeMeasured),
    };
  }

  const approximate = stop.date_excluded.departures > 0;
  const notes: string[] = [];
  if (stop.excluded_days.length > 0) notes.push(`${stop.excluded_days.join(", ")} excluded`);
  if (approximate) notes.push(`weather days removed ${stop.date_excluded.departures}`);
  const kind: StopBarKind = stop.assessable.departures < LOW_VOLUME_DEPARTURES ? "low_volume" : "measured";
  if (kind === "low_volume") notes.push("too few departures to rank");
  const note = notes.length ? notes.join(" · ") : null;

  return {
    ...base, kind,
    officialPct: asPercent(stop.assessable.pct),
    departures: stop.assessable.departures,
    segments: approximate ? sharesAfterDates(stop) : shares(stop.mix),
    approximate,
    belowTarget: stop.assessable.pct === null ? null : stop.assessable.pct < target,
    note: note ? note.charAt(0).toUpperCase() + note.slice(1) : null,
  };
}

const KIND_ORDER: Record<StopBarKind, number> = { measured: 0, low_volume: 1, excluded: 2 };

/** The on-time share a bar sorts by: official where there is one, else what it drew. */
const sortShare = (bar: StopBar) => bar.officialPct ?? bar.segments.ontime * 100;

/**
 * Every stop on the route, worst first: measured stops by official OTP, then
 * the thin ones, then the stops nothing of which counts. Ties go to the stop
 * with more departures, since it moved the route more.
 */
export function stopBars(stops: OtpStopFigure[], target: number, routeMeasured = true): StopBar[] {
  return stops
    .map((stop) => stopBar(stop, target, routeMeasured))
    .sort((a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
      || sortShare(a) - sortShare(b)
      || b.departures - a.departures
      || a.name.localeCompare(b.name));
}

/** One line a screen reader can say for a bar. */
export function stopBarLabel(bar: StopBar): string {
  const pct = (share: number) => `${Math.round(share * 100)}%`;
  const figure = bar.officialPct === null ? "not assessed" : `${bar.officialPct}% on time`;
  const split = `${pct(bar.segments.early)} early, ${pct(bar.segments.late)} late`;
  return `${bar.name}: ${figure}, ${bar.departures} departures, ${split}${bar.note ? `. ${bar.note}` : ""}`;
}
