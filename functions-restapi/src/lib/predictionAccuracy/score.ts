// One service day's predictions scored against when the buses actually came
// (plans/prediction-accuracy-evaluation.md increment 2, ADR 0041).
//
// In: the capture records of the day's file and the next day's (a trip that
// runs past midnight is written to the next file), and each trip's direction.
// Out: benchmark tallies by route, direction, hour and bucket, and by route,
// stop and bucket, plus an account of every prediction that was not scored
// and why. The nightly scorer stores those; the agency and route figures are
// computed from them with benchmark(), never averaged.
//
// What counts as a prediction: every stop time a TripUpdates sample gave for
// a stop the bus had not yet reached when the feed was published. That
// includes the B lines whose time is already in the past, an ETA the bus is
// running late against, because riders were shown it. A B line for a stop the
// bus HAD reached is Avail's own record of the arrival; it is not scored, but
// it is compared with the derived actual as a check on the derivation.
//
// What is left out, and counted:
//   duplicate      the same sample captured twice (the feed had not moved on)
//   stale          from a run whose TripUpdates were older than STALE_FEED_SECONDS:
//                  a feed outage is not inaccuracy
//   no_actual      no honest arrival interval (actuals.ts says why)
//   passed         the bus had reached the stop when the sample was published
//   out_of_range   the bus arrived more than 15 minutes after sampling
//   indeterminate  the verdict differs between the two ends of the arrival interval
//
// Pure: records in, tallies out.
import { scorePrediction, emptyTallies, tally, type BenchmarkTallies, type BucketId, type PredictionVerdict } from "./benchmark";
import { actualArrival, tripTimeline, type ActualArrival, type VehicleSample } from "./actuals";
import type { CaptureRecord, StopTimeRecord } from "./captureFile";
import { agencyMinuteOfDay, agencyServiceDate } from "../missedTripTime";

/** A service day runs from 03:00 to 03:00 Central: after the last trip, before the first. */
export const SERVICE_DAY_STARTS_AT_HOUR = 3;

/** TripUpdates older than this when a run read them are a stale feed, not predictions riders were shown fresh. */
export const STALE_FEED_SECONDS = 150;

/** Avail's kept time agrees with the derived arrival when it falls within the interval, give or take this. */
export const CROSS_CHECK_TOLERANCE_SECONDS = 15;

/** The service day an instant belongs to (yyyymmdd). */
export function serviceDayOf(epochSeconds: number): string {
  return agencyServiceDate(new Date((epochSeconds - SERVICE_DAY_STARTS_AT_HOUR * 3600) * 1000)).serviceDate;
}

/** The Central hour (0-23) an instant falls in. */
export function agencyHourOf(epochSeconds: number): number {
  return Math.floor(agencyMinuteOfDay(new Date(epochSeconds * 1000)) / 60);
}

export interface Counts {
  predictions: number;
  accurate: number;
  early: number;
  late: number;
  indeterminate: number;
}

export interface RouteHourScore extends Counts {
  routeId: string;
  /** GTFS direction_id; null when the trip is not in the static feed. */
  directionId: number | null;
  /** Central hour the prediction was published. */
  hour: number;
  bucket: BucketId;
}

export interface StopScore extends Counts {
  routeId: string;
  stopId: string;
  bucket: BucketId;
}

export interface DayScore {
  serviceDate: string;
  /** Capture runs in the day, and those whose TripUpdates were stale. */
  runs: number;
  staleRuns: number;
  /** The last capture run in the day (epoch seconds): how recent the scored data is. */
  lastRunAt: number | null;
  /** Stop-time lines in the day, before anything is left out. */
  samples: number;
  duplicate: number;
  stale: number;
  passed: number;
  outOfRange: number;
  indeterminate: number;
  noActual: { noVehicle: number; unseen: number; notReached: number; gap: number };
  /** Predictions in a bucket with a verdict: the benchmark's denominator. */
  scored: number;
  /** Trip-stops given an actual arrival. */
  actuals: number;
  /** Avail's kept times for passed stops, against the derived arrivals. */
  crossCheck: { compared: number; agreed: number; medianOffsetSeconds: number | null };
  /** Everything scored, for the day's agency figure. */
  tallies: BenchmarkTallies;
  routeHours: RouteHourScore[];
  stops: StopScore[];
}

function emptyCounts(): Counts {
  return { predictions: 0, accurate: 0, early: 0, late: 0, indeterminate: 0 };
}

function addVerdict(counts: Counts, verdict: PredictionVerdict & { counted: true }): void {
  counts.predictions++;
  if (verdict.accurate) counts.accurate++;
  if (verdict.arrivedEarly) counts.early++;
  if (verdict.arrivedLate) counts.late++;
}

function sameVerdict(a: PredictionVerdict, b: PredictionVerdict): boolean {
  if (!a.counted || !b.counted) return a.counted === b.counted;
  return a.bucket === b.bucket && a.accurate === b.accurate && a.arrivedEarly === b.arrivedEarly && a.arrivedLate === b.arrivedLate;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function scoreServiceDay(
  serviceDate: string,
  records: Iterable<CaptureRecord>,
  directions: ReadonlyMap<string, number> = new Map(),
): DayScore {
  // Pass 1: the day's vehicle samples by trip, and its stop-time lines with
  // the run each came from.
  const samplesByTrip = new Map<string, VehicleSample[]>();
  const stopTimes: { line: StopTimeRecord; staleRun: boolean }[] = [];
  let runs = 0;
  let staleRuns = 0;
  let lastRunAt: number | null = null;
  let staleRun = false;
  for (const record of records) {
    if (record.kind === "R") {
      staleRun = record.tripUpdatesAt !== null && record.runAt - record.tripUpdatesAt > STALE_FEED_SECONDS;
      if (serviceDayOf(record.runAt) !== serviceDate) continue;
      runs++;
      if (staleRun) staleRuns++;
      if (lastRunAt === null || record.runAt > lastRunAt) lastRunAt = record.runAt;
    } else if (record.kind === "V") {
      const at = record.vehicleAt ?? record.feedAt;
      if (!record.tripId || record.stopSequence === null || serviceDayOf(at) !== serviceDate) continue;
      const list = samplesByTrip.get(record.tripId) ?? [];
      list.push({ at, stopSequence: record.stopSequence, status: record.status });
      samplesByTrip.set(record.tripId, list);
    } else if (serviceDayOf(record.sampledAt) === serviceDate) {
      stopTimes.push({ line: record, staleRun });
    }
  }
  const timelines = new Map<string, VehicleSample[]>();
  for (const [trip, samples] of samplesByTrip) timelines.set(trip, tripTimeline(samples));

  // Pass 2: each stop-time line against its trip-stop's actual.
  const day: DayScore = {
    serviceDate, runs, staleRuns, lastRunAt, samples: stopTimes.length, duplicate: 0, stale: 0, passed: 0, outOfRange: 0,
    indeterminate: 0, noActual: { noVehicle: 0, unseen: 0, notReached: 0, gap: 0 }, scored: 0, actuals: 0,
    crossCheck: { compared: 0, agreed: 0, medianOffsetSeconds: null }, tallies: emptyTallies(), routeHours: [], stops: [],
  };
  const seen = new Set<string>();
  const actualCache = new Map<string, ActualArrival>();
  const crossChecked = new Set<string>();
  const offsets: number[] = [];
  const routeHours = new Map<string, RouteHourScore>();
  const stops = new Map<string, StopScore>();

  for (const { line, staleRun: fromStaleRun } of stopTimes) {
    const tripStop = `${line.tripId}|${line.stopSequence ?? line.stopId}`;
    const sampleKey = `${line.sampledAt}|${tripStop}`;
    if (seen.has(sampleKey)) { day.duplicate++; continue; }
    seen.add(sampleKey);
    if (fromStaleRun) { day.stale++; continue; }

    const timeline = timelines.get(line.tripId);
    if (!timeline || timeline.length === 0 || line.stopSequence === null) { day.noActual.noVehicle++; continue; }
    let actual = actualCache.get(tripStop);
    if (!actual) {
      actual = actualArrival(timeline, line.stopSequence);
      actualCache.set(tripStop, actual);
      if (actual.kind === "actual") day.actuals++;
    }
    if (actual.kind !== "actual") {
      if (actual.kind === "unseen") day.noActual.unseen++;
      else if (actual.kind === "not_reached") day.noActual.notReached++;
      else day.noActual.gap++;
      continue;
    }

    if (actual.to <= line.sampledAt) {
      // Reached before the sample was published: not a prediction. A kept
      // time for it is Avail's own record of the arrival.
      day.passed++;
      if (line.kind === "B" && !crossChecked.has(tripStop)) {
        crossChecked.add(tripStop);
        day.crossCheck.compared++;
        if (line.at >= actual.from - CROSS_CHECK_TOLERANCE_SECONDS && line.at <= actual.to + CROSS_CHECK_TOLERANCE_SECONDS) day.crossCheck.agreed++;
        offsets.push(line.at - Math.round((actual.from + actual.to) / 2));
      }
      continue;
    }

    const atFrom = scorePrediction(line.sampledAt, line.at, actual.from);
    const atTo = scorePrediction(line.sampledAt, line.at, actual.to);
    if (!atFrom.counted && !atTo.counted) { day.outOfRange++; continue; }

    const middle = scorePrediction(line.sampledAt, line.at, Math.round((actual.from + actual.to) / 2));
    const bucket = (middle.counted ? middle : atTo.counted ? atTo : atFrom) as PredictionVerdict & { counted: true };
    const directionId = directions.get(line.tripId) ?? null;
    const hour = agencyHourOf(line.sampledAt);
    const hourKey = `${line.routeId}|${directionId ?? ""}|${hour}|${bucket.bucket}`;
    const stopKey = `${line.routeId}|${line.stopId}|${bucket.bucket}`;
    const routeHour = routeHours.get(hourKey) ?? { routeId: line.routeId, directionId, hour, bucket: bucket.bucket, ...emptyCounts() };
    const stop = stops.get(stopKey) ?? { routeId: line.routeId, stopId: line.stopId, bucket: bucket.bucket, ...emptyCounts() };
    routeHours.set(hourKey, routeHour);
    stops.set(stopKey, stop);

    if (!sameVerdict(atFrom, atTo)) {
      day.indeterminate++;
      routeHour.indeterminate++;
      stop.indeterminate++;
      continue;
    }
    const verdict = atTo as PredictionVerdict & { counted: true };
    day.scored++;
    tally(day.tallies, verdict);
    addVerdict(routeHour, verdict);
    addVerdict(stop, verdict);
  }

  day.crossCheck.medianOffsetSeconds = median(offsets);
  day.routeHours = [...routeHours.values()];
  day.stops = [...stops.values()];
  return day;
}
