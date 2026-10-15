// Which parts of the published static schedule make arrival predictions worse,
// route by route.
//
// A prediction engine (Avail today) starts from the schedule and corrects it
// with each GPS ping. Where the schedule is wrong or silent, the correction has
// nothing good to start from, and riders see it as a countdown that jumps or a
// bus that arrives before its prediction. Swiftly's Sep 1-20, 2026 comparison
// put MVTA's current prediction accuracy between 49% (490) and 79% (470). Run
// against the feed that was live then, these checks separate the two kinds of
// route that score worst: long express runs the schedule cannot describe
// (490/480 - long gaps between timepoints, stop-free freeway miles, shared
// blocks), and local routes whose in-between stop times are placeholders.
//
// Pure: CSV text in, report out. The static sync runs it on every import and
// stores the result; nothing here reads the database.
import { parseCsvLine } from "./gtfsStatic";

export interface PredictionRiskFeed {
  routesCsv: string;
  tripsCsv: string;
  stopsCsv: string;
  stopTimesCsv: string;
  /** feed_info.txt is optional in GTFS. */
  feedInfoCsv: string | null;
}

export type PredictionRiskCheckId =
  | "placeholder_times"
  | "timepoint_gap"
  | "longest_hop"
  | "tight_turnarounds"
  | "interlined"
  | "block_overlaps"
  | "run_time_spread";

export interface PredictionRiskCheckDefinition {
  id: PredictionRiskCheckId;
  label: string;
  unit: "%" | "min" | "mi" | "trips";
  /** A value at or above this is flagged. */
  threshold: number;
  /** Why it hurts predictions, for the person reading the review. */
  why: string;
}

// Thresholds were set against the 20260909 MVTA feed so that each one flags the
// routes it should and leaves the rest alone; they are a starting point to tune
// once OnBoard measures prediction accuracy itself.
export const PREDICTION_RISK_CHECKS: readonly PredictionRiskCheckDefinition[] = [
  {
    id: "placeholder_times",
    label: "Placeholder stop times",
    unit: "%",
    threshold: 10,
    why: "Stops scheduled one second after the previous stop although they are a block or more away. The in-between times are rounded to the minute and nudged by a second to stay in order, so a prediction that leans on scheduled stop-to-stop times is thrown off.",
  },
  {
    id: "timepoint_gap",
    label: "Longest gap between timepoints",
    unit: "min",
    threshold: 30,
    why: "The longest stretch with no scheduled time the bus is held to. Over a long gap, traffic decides the arrival and the schedule says nothing about it.",
  },
  {
    id: "longest_hop",
    label: "Longest distance between stops",
    unit: "mi",
    threshold: 10,
    why: "Stop-free freeway miles. With no stop to arrive at, a late bus only shows up as late at the far end, so predictions downstream lag behind.",
  },
  {
    id: "tight_turnarounds",
    label: "Tight turnarounds",
    unit: "%",
    threshold: 40,
    why: "Trips scheduled to leave within three minutes of the previous trip on the same bus ending. Any lateness carries straight into the next trip, before it has a GPS reading of its own.",
  },
  {
    id: "interlined",
    label: "Continues from another route",
    unit: "%",
    threshold: 50,
    why: "Trips whose bus comes off a different route. Until that bus pulls in, this trip's prediction is only the schedule.",
  },
  {
    id: "block_overlaps",
    label: "Impossible blocks",
    unit: "trips",
    threshold: 1,
    why: "Trips scheduled to start before the previous trip on the same bus ends. The prediction engine has to guess which trip the bus is on.",
  },
  {
    id: "run_time_spread",
    label: "Run-time spread",
    unit: "min",
    threshold: 15,
    why: "The widest difference in scheduled running time for the same stops on the same route. The schedule itself admits the trip varies this much, which is where prediction error comes from.",
  },
];

export interface PredictionRiskCheckResult {
  id: PredictionRiskCheckId;
  /** null when the route has nothing to measure (e.g. no follow-on trips). */
  value: number | null;
  flagged: boolean;
}

export interface PredictionRiskRoute {
  route_id: string;
  route_short_name: string;
  trip_count: number;
  flag_count: number;
  checks: PredictionRiskCheckResult[];
}

export interface PredictionRiskReview {
  feed: { version: string | null; start_date: string | null; end_date: string | null };
  checks: readonly PredictionRiskCheckDefinition[];
  routes: PredictionRiskRoute[];
}

// A placeholder hop is at most this long in time and at least this far apart
// on the ground; two stop_times at the same platform are not a placeholder.
const PLACEHOLDER_MAX_SECONDS = 1;
const PLACEHOLDER_MIN_METRES = 100;
const TIGHT_TURNAROUND_SECONDS = 180;
const METRES_PER_MILE = 1609.344;

function table(csv: string): { header: string[]; rows: string[][] } {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { header: [], rows: [] };
  return {
    header: parseCsvLine(lines[0].replace(/^﻿/, "")).map((h) => h.trim()),
    rows: lines.slice(1).map((line) => parseCsvLine(line).map((v) => v.trim())),
  };
}

// GTFS clocks run past 24:00 for trips that cross midnight.
function seconds(value: string | undefined): number | null {
  const match = value?.match(/^(\d{1,3}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function metres(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

function percent(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.round((100 * part) / whole);
}

interface StopTime {
  sequence: number;
  arrival: number;
  departure: number;
  stopId: string;
  exact: boolean;
}

function feedInfo(csv: string | null): PredictionRiskReview["feed"] {
  const { header, rows } = table(csv ?? "");
  const first = rows[0];
  const field = (name: string) => {
    const i = header.indexOf(name);
    return first && i !== -1 && first[i] ? first[i] : null;
  };
  return { version: field("feed_version"), start_date: field("feed_start_date"), end_date: field("feed_end_date") };
}

export function reviewPredictionRisk(feed: PredictionRiskFeed): PredictionRiskReview {
  const routesTable = table(feed.routesCsv);
  const routeIdIdx = routesTable.header.indexOf("route_id");
  const shortIdx = routesTable.header.indexOf("route_short_name");
  const longIdx = routesTable.header.indexOf("route_long_name");
  const routeOrder = new Map<string, { order: number; name: string }>();
  routesTable.rows.forEach((cols, order) => {
    const id = cols[routeIdIdx];
    if (id) routeOrder.set(id, { order, name: cols[shortIdx] || cols[longIdx] || id });
  });

  const stopsTable = table(feed.stopsCsv);
  const stopIdIdx = stopsTable.header.indexOf("stop_id");
  const latIdx = stopsTable.header.indexOf("stop_lat");
  const lonIdx = stopsTable.header.indexOf("stop_lon");
  const stops = new Map<string, { lat: number; lon: number }>();
  for (const cols of stopsTable.rows) {
    const lat = parseFloat(cols[latIdx]);
    const lon = parseFloat(cols[lonIdx]);
    if (cols[stopIdIdx] && Number.isFinite(lat) && Number.isFinite(lon)) stops.set(cols[stopIdIdx], { lat, lon });
  }

  const tripsTable = table(feed.tripsCsv);
  const tIdx = (n: string) => tripsTable.header.indexOf(n);
  const trips = new Map<string, { routeId: string; serviceId: string; blockId: string | null }>();
  for (const cols of tripsTable.rows) {
    const tripId = cols[tIdx("trip_id")];
    const routeId = cols[tIdx("route_id")];
    if (!tripId || !routeId) continue;
    trips.set(tripId, { routeId, serviceId: cols[tIdx("service_id")] ?? "", blockId: cols[tIdx("block_id")] || null });
  }

  const stTable = table(feed.stopTimesCsv);
  const sIdx = (n: string) => stTable.header.indexOf(n);
  const [tripCol, arrCol, depCol, stopCol, seqCol, tpCol] =
    ["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence", "timepoint"].map(sIdx);
  const stopTimes = new Map<string, StopTime[]>();
  for (const cols of stTable.rows) {
    const tripId = cols[tripCol];
    const sequence = parseInt(cols[seqCol], 10);
    const arrival = seconds(cols[arrCol]) ?? seconds(cols[depCol]);
    const departure = seconds(cols[depCol]) ?? arrival;
    // A stop with no time at all is interpolated by the consumer; it has nothing to measure.
    if (!tripId || !trips.has(tripId) || !Number.isFinite(sequence) || arrival === null || departure === null) continue;
    // GTFS: timepoint 0 is approximate; 1 or blank (or no column) is exact.
    const exact = tpCol === -1 || cols[tpCol] !== "0";
    const list = stopTimes.get(tripId) ?? [];
    list.push({ sequence, arrival, departure, stopId: cols[stopCol], exact });
    stopTimes.set(tripId, list);
  }

  interface Tally {
    trips: number;
    hops: number;
    placeholderHops: number;
    timepointGap: number | null;
    longestHop: number | null;
    followOns: number;
    tight: number;
    interlined: number;
    overlaps: number;
    runTimes: Map<string, { min: number; max: number; count: number }>;
  }
  const tallies = new Map<string, Tally>();
  const tally = (routeId: string): Tally => {
    let t = tallies.get(routeId);
    if (!t) {
      t = { trips: 0, hops: 0, placeholderHops: 0, timepointGap: null, longestHop: null, followOns: 0, tight: 0, interlined: 0, overlaps: 0, runTimes: new Map() };
      tallies.set(routeId, t);
    }
    return t;
  };

  const blocks = new Map<string, { start: number; end: number; routeId: string }[]>();
  for (const [tripId, list] of stopTimes) {
    list.sort((a, b) => a.sequence - b.sequence);
    const trip = trips.get(tripId)!;
    const t = tally(trip.routeId);
    t.trips++;

    let lastExact: StopTime | null = null;
    list.forEach((stop, i) => {
      if (i > 0) {
        const prev = list[i - 1];
        t.hops++;
        const a = stops.get(prev.stopId);
        const b = stops.get(stop.stopId);
        if (a && b) {
          const distance = metres(a, b);
          if (stop.arrival - prev.departure <= PLACEHOLDER_MAX_SECONDS && distance >= PLACEHOLDER_MIN_METRES) t.placeholderHops++;
          t.longestHop = Math.max(t.longestHop ?? 0, distance / METRES_PER_MILE);
        }
      }
      if (stop.exact) {
        if (lastExact) t.timepointGap = Math.max(t.timepointGap ?? 0, (stop.arrival - lastExact.departure) / 60);
        lastExact = stop;
      }
    });

    const first = list[0];
    const last = list[list.length - 1];
    const pattern = `${first.stopId}\u0000${last.stopId}\u0000${list.length}`;
    const runTime = (last.arrival - first.departure) / 60;
    const known = t.runTimes.get(pattern);
    t.runTimes.set(pattern, known
      ? { min: Math.min(known.min, runTime), max: Math.max(known.max, runTime), count: known.count + 1 }
      : { min: runTime, max: runTime, count: 1 });

    // A block is one bus's day; the same block id on another service is another day.
    if (trip.blockId) {
      const key = `${trip.serviceId}\u0000${trip.blockId}`;
      const block = blocks.get(key) ?? [];
      block.push({ start: first.departure, end: last.arrival, routeId: trip.routeId });
      blocks.set(key, block);
    }
  }

  for (const block of blocks.values()) {
    block.sort((a, b) => a.start - b.start);
    for (let i = 1; i < block.length; i++) {
      const prev = block[i - 1];
      const next = block[i];
      // A follow-on belongs to the route of the trip that inherits the lateness.
      const t = tally(next.routeId);
      t.followOns++;
      const layover = next.start - prev.end;
      if (layover <= TIGHT_TURNAROUND_SECONDS) t.tight++;
      if (layover < 0) t.overlaps++;
      if (prev.routeId !== next.routeId) t.interlined++;
    }
  }

  const routes: PredictionRiskRoute[] = [...tallies.entries()]
    .filter(([, t]) => t.trips > 0)
    .map(([routeId, t]) => {
      const spreads = [...t.runTimes.values()].filter((p) => p.count >= 2).map((p) => p.max - p.min);
      const values: Record<PredictionRiskCheckId, number | null> = {
        placeholder_times: percent(t.placeholderHops, t.hops),
        timepoint_gap: t.timepointGap === null ? null : Math.round(t.timepointGap),
        longest_hop: t.longestHop === null ? null : Math.round(t.longestHop * 10) / 10,
        tight_turnarounds: percent(t.tight, t.followOns),
        interlined: percent(t.interlined, t.followOns),
        block_overlaps: t.followOns === 0 ? null : t.overlaps,
        run_time_spread: spreads.length === 0 ? null : Math.round(Math.max(...spreads)),
      };
      const checks = PREDICTION_RISK_CHECKS.map((def) => {
        const value = values[def.id];
        return { id: def.id, value, flagged: value !== null && value >= def.threshold };
      });
      return {
        route_id: routeId,
        route_short_name: routeOrder.get(routeId)?.name ?? routeId,
        trip_count: t.trips,
        flag_count: checks.filter((c) => c.flagged).length,
        checks,
      };
    })
    .sort((a, b) =>
      b.flag_count - a.flag_count ||
      (routeOrder.get(a.route_id)?.order ?? Infinity) - (routeOrder.get(b.route_id)?.order ?? Infinity) ||
      a.route_id.localeCompare(b.route_id));

  return { feed: feedInfo(feed.feedInfoCsv), checks: PREDICTION_RISK_CHECKS, routes };
}
