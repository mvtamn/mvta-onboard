// Distances along the schedule. Two sources, one answer.
//
// stops.txt gives coordinates, so any two stops have a straight-line distance.
// stop_times.txt may carry shape_dist_traveled, the distance along the route,
// which is what a bus actually drives: on an express run the two differ by a
// factor of 1.5 (490: 14.9 miles as the crow flies, 22 along I-35W). GTFS does
// not say what unit shape_dist_traveled is in, and the MVTA feed uses feet, so
// the unit is measured against the straight-line distances on each import
// rather than assumed. When it cannot be measured the review falls back to
// straight-line and says so (DistanceCalibration.unit = "unknown").
import type { DistanceCalibration } from "./types";

export const METRES_PER_MILE = 1609.344;
const METRES_PER_FOOT = 0.3048;

/** A hop must be at least this far apart for its ratio to mean anything. */
const CALIBRATION_MIN_STRAIGHT_METRES = 500;
const CALIBRATION_MIN_SAMPLES = 20;
/**
 * Along-the-road over straight-line: 1.0 is a straight road, a winding local
 * route reaches 2. Beyond that the candidate unit is wrong, not the road.
 */
const CURVATURE_MIN = 0.95;
const CURVATURE_MAX = 2.2;

export interface LatLon {
  lat: number;
  lon: number;
}

export function haversineMetres(a: LatLon, b: LatLon): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

export interface CalibrationSample {
  /** shape_dist_traveled difference between two consecutive stops, feed units. */
  shape: number;
  /** Straight-line distance between the same two stops, metres. */
  straight: number;
}

const CANDIDATES: { unit: "metres" | "feet"; unitsPerMetre: number }[] = [
  { unit: "metres", unitsPerMetre: 1 },
  { unit: "feet", unitsPerMetre: 1 / METRES_PER_FOOT },
];

export function calibrateShapeDistance(samples: readonly CalibrationSample[]): DistanceCalibration {
  const ratios = samples
    .filter((s) => s.straight >= CALIBRATION_MIN_STRAIGHT_METRES && s.shape > 0 && Number.isFinite(s.shape))
    .map((s) => s.shape / s.straight)
    .sort((a, b) => a - b);
  if (ratios.length < CALIBRATION_MIN_SAMPLES) return { unit: "unknown", factor_to_metres: null, samples: ratios.length };
  const median = ratios[Math.floor(ratios.length / 2)];
  for (const candidate of CANDIDATES) {
    const curvature = median / candidate.unitsPerMetre;
    if (curvature >= CURVATURE_MIN && curvature <= CURVATURE_MAX) {
      return { unit: candidate.unit, factor_to_metres: 1 / candidate.unitsPerMetre, samples: ratios.length };
    }
  }
  return { unit: "unknown", factor_to_metres: null, samples: ratios.length };
}

/**
 * Metres between two consecutive stops: along the route when both carry a
 * calibrated shape distance that increases, else straight-line, else null
 * when a stop has no coordinates.
 */
export function hopMetres(
  prev: { shapeDist: number | null; position: LatLon | null },
  next: { shapeDist: number | null; position: LatLon | null },
  calibration: DistanceCalibration,
): number | null {
  if (calibration.factor_to_metres !== null && prev.shapeDist !== null && next.shapeDist !== null) {
    const delta = next.shapeDist - prev.shapeDist;
    if (delta > 0) return delta * calibration.factor_to_metres;
  }
  if (prev.position && next.position) return haversineMetres(prev.position, next.position);
  return null;
}

export function miles(metres: number): number {
  return metres / METRES_PER_MILE;
}
