// The static schedule, parsed once into the things every check asks about:
// trips with their stop times in order, the stop pattern each trip runs, the
// hops between consecutive stops, the timepoint segments, and the blocks (one
// bus's day) with the hand-over between each pair of consecutive trips.
//
// Pure: CSV text in, model out. Distances come from distance.ts, which
// calibrates the feed's shape distances against the stop coordinates here.
import { parseCsvLine } from "../gtfsStatic";
import { calibrateShapeDistance, haversineMetres, hopMetres, type CalibrationSample, type LatLon } from "./distance";
import type { DistanceCalibration, PredictionRiskFeedInfo } from "./types";

export interface PredictionRiskFeed {
  routesCsv: string;
  tripsCsv: string;
  stopsCsv: string;
  stopTimesCsv: string;
  /** feed_info.txt is optional in GTFS. */
  feedInfoCsv: string | null;
}

export interface ModelStop {
  id: string;
  name: string;
  position: LatLon | null;
}

export interface ModelStopTime {
  sequence: number;
  /** Seconds on the GTFS clock, which runs past 24:00 for trips crossing midnight. */
  arrival: number;
  departure: number;
  stopId: string;
  /** GTFS timepoint: 1 or blank is exact, 0 is approximate (interpolated by the consumer). */
  exact: boolean;
  shapeDist: number | null;
}

export interface ModelHop {
  prev: ModelStopTime;
  next: ModelStopTime;
  /** null when a stop has no coordinates and no shape distance. */
  metres: number | null;
}

export interface ModelTrip {
  id: string;
  routeId: string;
  serviceId: string;
  blockId: string | null;
  directionId: string;
  /**
   * N, S, E or W: the cardinal word in the trip's headsign ("West to Apple
   * Valley TS"), or the one most of the route's trips in the same direction_id
   * carry when this headsign has none. Avail labels its OTP rows the same way,
   * which is how a segment is matched to the direction Avail measured.
   */
  directionLabel: string | null;
  stopTimes: ModelStopTime[];
  hops: ModelHop[];
  /** Start hour folded to 0-23 for grouping by time of day. */
  startHour: number;
  runMinutes: number;
  patternKey: string;
}

/** Trips that serve the same first stop, last stop and stop count in one direction. */
export interface ModelPattern {
  key: string;
  firstStopId: string;
  lastStopId: string;
  stopCount: number;
  directionId: string;
  trips: ModelTrip[];
}

/** Two consecutive trips on one bus (same service day, same block). */
export interface BlockLink {
  prev: ModelTrip;
  next: ModelTrip;
  /** Negative when the next trip starts before the previous one ends. */
  layoverSeconds: number;
}

export interface SegmentOccurrence {
  trip: ModelTrip;
  minutes: number;
  metres: number | null;
}

/** Consecutive timepoints on a trip, aggregated over every trip of the route. */
export interface ModelSegment {
  fromStopId: string;
  toStopId: string;
  occurrences: SegmentOccurrence[];
}

export interface RouteModel {
  id: string;
  name: string;
  /** Position in routes.txt, for a stable order. */
  order: number;
  trips: ModelTrip[];
  patterns: ModelPattern[];
  /** Hand-overs INTO this route: the next trip is this route's, whatever the previous was. */
  linksInto: BlockLink[];
  segments: ModelSegment[];
}

export interface ScheduleModel {
  feed: PredictionRiskFeedInfo;
  stops: Map<string, ModelStop>;
  routes: RouteModel[];
  distance: DistanceCalibration;
  stopName(id: string): string;
}

export const PEAK_HOURS: ReadonlySet<number> = new Set([6, 7, 8, 9, 15, 16, 17, 18]);

function table(csv: string): { header: string[]; rows: string[][] } {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { header: [], rows: [] };
  return {
    header: parseCsvLine(lines[0].replace(/^﻿/, "")).map((h) => h.trim()),
    rows: lines.slice(1).map((line) => parseCsvLine(line).map((v) => v.trim())),
  };
}

function seconds(value: string | undefined): number | null {
  const match = value?.match(/^(\d{1,3}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function feedInfo(csv: string | null): PredictionRiskFeedInfo {
  const { header, rows } = table(csv ?? "");
  const first = rows[0];
  const field = (name: string) => {
    const i = header.indexOf(name);
    return first && i !== -1 && first[i] ? first[i] : null;
  };
  return { version: field("feed_version"), start_date: field("feed_start_date"), end_date: field("feed_end_date") };
}

export function buildScheduleModel(feed: PredictionRiskFeed): ScheduleModel {
  const routesTable = table(feed.routesCsv);
  const rIdx = (n: string) => routesTable.header.indexOf(n);
  const [routeIdCol, shortCol, longCol] = [rIdx("route_id"), rIdx("route_short_name"), rIdx("route_long_name")];
  const routes = new Map<string, RouteModel>();
  routesTable.rows.forEach((cols, order) => {
    const id = cols[routeIdCol];
    if (!id || routes.has(id)) return;
    routes.set(id, { id, name: cols[shortCol] || cols[longCol] || id, order, trips: [], patterns: [], linksInto: [], segments: [] });
  });
  // A route trips.txt names but routes.txt does not is still reviewed, after the known ones.
  const routeFor = (id: string): RouteModel => {
    let route = routes.get(id);
    if (!route) {
      route = { id, name: id, order: Number.MAX_SAFE_INTEGER, trips: [], patterns: [], linksInto: [], segments: [] };
      routes.set(id, route);
    }
    return route;
  };

  const stopsTable = table(feed.stopsCsv);
  const sIdx = (n: string) => stopsTable.header.indexOf(n);
  const [stopIdCol, nameCol, latCol, lonCol] = [sIdx("stop_id"), sIdx("stop_name"), sIdx("stop_lat"), sIdx("stop_lon")];
  const stops = new Map<string, ModelStop>();
  for (const cols of stopsTable.rows) {
    const id = cols[stopIdCol];
    if (!id) continue;
    const lat = parseFloat(cols[latCol]);
    const lon = parseFloat(cols[lonCol]);
    stops.set(id, { id, name: cols[nameCol] || id, position: Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null });
  }

  const tripsTable = table(feed.tripsCsv);
  const tIdx = (n: string) => tripsTable.header.indexOf(n);
  const [tripIdCol, tripRouteCol, serviceCol, blockCol, directionCol, headsignCol] =
    [tIdx("trip_id"), tIdx("route_id"), tIdx("service_id"), tIdx("block_id"), tIdx("direction_id"), tIdx("trip_headsign")];
  const tripRows = new Map<string, { routeId: string; serviceId: string; blockId: string | null; directionId: string; headsignLabel: string | null }>();
  // Votes per route and direction_id, for a headsign with no cardinal word.
  const labelVotes = new Map<string, Map<string, number>>();
  for (const cols of tripsTable.rows) {
    const tripId = cols[tripIdCol];
    const routeId = cols[tripRouteCol];
    if (!tripId || !routeId) continue;
    const directionId = cols[directionCol] ?? "";
    const headsignLabel = cardinalLabel(headsignCol === -1 ? null : cols[headsignCol]);
    tripRows.set(tripId, { routeId, serviceId: cols[serviceCol] ?? "", blockId: cols[blockCol] || null, directionId, headsignLabel });
    if (headsignLabel) {
      const key = `${routeId}\u0000${directionId}`;
      const votes = labelVotes.get(key) ?? new Map<string, number>();
      votes.set(headsignLabel, (votes.get(headsignLabel) ?? 0) + 1);
      labelVotes.set(key, votes);
    }
  }
  const fallbackLabel = (routeId: string, directionId: string): string | null => {
    const votes = labelVotes.get(`${routeId}\u0000${directionId}`);
    if (!votes) return null;
    return [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
  };

  const stTable = table(feed.stopTimesCsv);
  const cIdx = (n: string) => stTable.header.indexOf(n);
  const [stTripCol, arrCol, depCol, stStopCol, seqCol, tpCol, distCol] =
    ["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence", "timepoint", "shape_dist_traveled"].map(cIdx);
  const stopTimesByTrip = new Map<string, ModelStopTime[]>();
  for (const cols of stTable.rows) {
    const tripId = cols[stTripCol];
    const sequence = parseInt(cols[seqCol], 10);
    const arrival = seconds(cols[arrCol]) ?? seconds(cols[depCol]);
    const departure = seconds(cols[depCol]) ?? arrival;
    // A stop with no time at all is interpolated by the consumer; it has nothing to measure.
    if (!tripId || !tripRows.has(tripId) || !Number.isFinite(sequence) || arrival === null || departure === null) continue;
    const exact = tpCol === -1 || cols[tpCol] !== "0";
    const dist = distCol === -1 ? NaN : parseFloat(cols[distCol]);
    const list = stopTimesByTrip.get(tripId) ?? [];
    list.push({ sequence, arrival, departure, stopId: cols[stStopCol], exact, shapeDist: Number.isFinite(dist) ? dist : null });
    stopTimesByTrip.set(tripId, list);
  }

  // Calibrate the shape distances before building hops, so every hop reads the same way.
  const samples: CalibrationSample[] = [];
  for (const list of stopTimesByTrip.values()) {
    list.sort((a, b) => a.sequence - b.sequence);
    for (let i = 1; i < list.length; i++) {
      const a = stops.get(list[i - 1].stopId)?.position;
      const b = stops.get(list[i].stopId)?.position;
      const prevDist = list[i - 1].shapeDist;
      const nextDist = list[i].shapeDist;
      if (a && b && prevDist !== null && nextDist !== null) {
        samples.push({ shape: nextDist - prevDist, straight: haversineMetres(a, b) });
      }
    }
  }
  const distance = calibrateShapeDistance(samples);
  const positionOf = (stopId: string): LatLon | null => stops.get(stopId)?.position ?? null;

  const patterns = new Map<string, ModelPattern>();
  const blocks = new Map<string, ModelTrip[]>();
  for (const [tripId, stopTimes] of stopTimesByTrip) {
    if (stopTimes.length === 0) continue;
    const row = tripRows.get(tripId)!;
    const route = routeFor(row.routeId);
    const first = stopTimes[0];
    const last = stopTimes[stopTimes.length - 1];
    const patternKey = `${row.directionId}\u0000${first.stopId}\u0000${last.stopId}\u0000${stopTimes.length}`;
    const hops: ModelHop[] = [];
    for (let i = 1; i < stopTimes.length; i++) {
      const prev = stopTimes[i - 1];
      const next = stopTimes[i];
      hops.push({
        prev,
        next,
        metres: hopMetres(
          { shapeDist: prev.shapeDist, position: positionOf(prev.stopId) },
          { shapeDist: next.shapeDist, position: positionOf(next.stopId) },
          distance,
        ),
      });
    }
    const trip: ModelTrip = {
      id: tripId,
      routeId: row.routeId,
      serviceId: row.serviceId,
      blockId: row.blockId,
      directionId: row.directionId,
      directionLabel: row.headsignLabel ?? fallbackLabel(row.routeId, row.directionId),
      stopTimes,
      hops,
      startHour: Math.floor(first.departure / 3600) % 24,
      runMinutes: (last.arrival - first.departure) / 60,
      patternKey,
    };
    route.trips.push(trip);

    let pattern = patterns.get(`${row.routeId}\u0000${patternKey}`);
    if (!pattern) {
      pattern = { key: patternKey, firstStopId: first.stopId, lastStopId: last.stopId, stopCount: stopTimes.length, directionId: row.directionId, trips: [] };
      patterns.set(`${row.routeId}\u0000${patternKey}`, pattern);
      route.patterns.push(pattern);
    }
    pattern.trips.push(trip);

    // Timepoint segments: consecutive exact stops, with the hops between them summed for distance.
    let lastExact: { stopTime: ModelStopTime; index: number } | null = null;
    const segmentsByKey = new Map<string, ModelSegment>();
    for (const existing of route.segments) segmentsByKey.set(`${existing.fromStopId}\u0000${existing.toStopId}`, existing);
    stopTimes.forEach((stopTime, index) => {
      if (!stopTime.exact) return;
      if (lastExact) {
        const key = `${lastExact.stopTime.stopId}\u0000${stopTime.stopId}`;
        let segment = segmentsByKey.get(key);
        if (!segment) {
          segment = { fromStopId: lastExact.stopTime.stopId, toStopId: stopTime.stopId, occurrences: [] };
          segmentsByKey.set(key, segment);
          route.segments.push(segment);
        }
        let metres: number | null = 0;
        for (let i = lastExact.index; i < index; i++) {
          const hop = hops[i].metres;
          if (hop === null) { metres = null; break; }
          metres += hop;
        }
        segment.occurrences.push({ trip, minutes: (stopTime.arrival - lastExact.stopTime.departure) / 60, metres });
      }
      lastExact = { stopTime, index };
    });

    // A block is one bus's day; the same block id on another service is another day.
    if (row.blockId) {
      const key = `${row.serviceId}\u0000${row.blockId}`;
      const block = blocks.get(key) ?? [];
      block.push(trip);
      blocks.set(key, block);
    }
  }

  for (const block of blocks.values()) {
    block.sort((a, b) => a.stopTimes[0].departure - b.stopTimes[0].departure);
    for (let i = 1; i < block.length; i++) {
      const prev = block[i - 1];
      const next = block[i];
      const link: BlockLink = { prev, next, layoverSeconds: next.stopTimes[0].departure - prev.stopTimes[prev.stopTimes.length - 1].arrival };
      // A hand-over belongs to the route of the trip that inherits the lateness.
      routeFor(next.routeId).linksInto.push(link);
    }
  }

  const ordered = [...routes.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return {
    feed: feedInfo(feed.feedInfoCsv),
    stops,
    routes: ordered,
    distance,
    stopName: (id) => stops.get(id)?.name ?? id,
  };
}


/** N, S, E or W from the first cardinal word in a headsign; null when it has none. */
export function cardinalLabel(headsign: string | null | undefined): string | null {
  const match = headsign?.match(/\b(North|South|East|West)\b/i);
  return match ? match[1][0].toUpperCase() : null;
}

/** Seconds on the GTFS clock as HH:MM, folded past midnight. */
export function clock(secondsOnClock: number): string {
  const total = Math.round(secondsOnClock);
  const h = Math.floor(total / 3600) % 24;
  const m = Math.floor((total % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
