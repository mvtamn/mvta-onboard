import { polygonContains, type Point } from "./geofence";

const MINIMUM_INTERPOLATED_MOVEMENT_METERS = 25;
const INTERSECTION_EPSILON = 1e-7;

export interface BoundaryMovementPosition {
  longitude: number;
  latitude: number;
  report_timestamp: Date | string;
}

export interface QualifiedBoundaryMovement {
  transition: "enter" | "exit";
  detection_method: "path_interpolated";
  detected_at: string;
  source_report_from_at: string;
  source_report_to_at: string;
  source_displacement_meters: number;
}

function timestamp(value: Date | string): string {
  return new Date(value).toISOString();
}

export function distanceMeters(a: Point, b: Point): number {
  const radians = Math.PI / 180;
  const latitude = (b[1] - a[1]) * radians;
  const longitude = (b[0] - a[0]) * radians;
  const sinLatitude = Math.sin(latitude / 2);
  const sinLongitude = Math.sin(longitude / 2);
  const h = sinLatitude ** 2 + Math.cos(a[1] * radians) * Math.cos(b[1] * radians) * sinLongitude ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

function cross(a: Point, b: Point): number {
  return a[0] * b[1] - a[1] * b[0];
}

function subtract(a: Point, b: Point): Point {
  return [a[0] - b[0], a[1] - b[1]];
}

function segmentIntersectionParameter(start: Point, end: Point, edgeStart: Point, edgeEnd: Point): number | null {
  const path = subtract(end, start);
  const edge = subtract(edgeEnd, edgeStart);
  const denominator = cross(path, edge);
  if (Math.abs(denominator) < INTERSECTION_EPSILON) return null;
  const offset = subtract(edgeStart, start);
  const pathT = cross(offset, edge) / denominator;
  const edgeT = cross(offset, path) / denominator;
  return pathT > INTERSECTION_EPSILON && pathT < 1 - INTERSECTION_EPSILON && edgeT >= -INTERSECTION_EPSILON && edgeT <= 1 + INTERSECTION_EPSILON ? pathT : null;
}

function pointAt(start: Point, end: Point, ratio: number): Point {
  return [start[0] + (end[0] - start[0]) * ratio, start[1] + (end[1] - start[1]) * ratio];
}

function boundaryParameters(polygonJson: string, start: Point, end: Point): number[] {
  let polygon: { type?: string; coordinates?: Point[][] };
  try { polygon = JSON.parse(polygonJson) as { type?: string; coordinates?: Point[][] }; } catch { return []; }
  if (polygon.type !== "Polygon" || !polygon.coordinates) return [];
  const values = polygon.coordinates.flatMap((ring) => ring.slice(0, -1).map((edgeStart, index) => segmentIntersectionParameter(start, end, edgeStart, ring[index + 1])).filter((value): value is number => value !== null));
  return values.sort((a, b) => a - b).filter((value, index) => index === 0 || Math.abs(value - values[index - 1]) > INTERSECTION_EPSILON);
}

export function detectQualifiedBoundaryMovements(polygonJson: string, input: { previous: BoundaryMovementPosition; current: BoundaryMovementPosition; pollIntervalSeconds: number }): QualifiedBoundaryMovement[] {
  const start: Point = [input.previous.longitude, input.previous.latitude];
  const end: Point = [input.current.longitude, input.current.latitude];
  const from = new Date(input.previous.report_timestamp);
  const to = new Date(input.current.report_timestamp);
  const displacement = distanceMeters(start, end);
  const maximumGapMilliseconds = Math.max(0, input.pollIntervalSeconds) * 2 * 1_000;
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to.getTime() <= from.getTime() || to.getTime() - from.getTime() > maximumGapMilliseconds || displacement < MINIMUM_INTERPOLATED_MOVEMENT_METERS) return [];
  const parameters = boundaryParameters(polygonJson, start, end);
  return parameters.flatMap((parameter) => {
    const before = polygonContains(polygonJson, pointAt(start, end, Math.max(0, parameter - INTERSECTION_EPSILON)));
    const after = polygonContains(polygonJson, pointAt(start, end, Math.min(1, parameter + INTERSECTION_EPSILON)));
    if (before === after) return [];
    return [{
      transition: after ? "enter" : "exit",
      detection_method: "path_interpolated" as const,
      detected_at: timestamp(input.current.report_timestamp),
      source_report_from_at: timestamp(input.previous.report_timestamp),
      source_report_to_at: timestamp(input.current.report_timestamp),
      source_displacement_meters: Math.round(displacement * 10) / 10,
    }];
  });
}
