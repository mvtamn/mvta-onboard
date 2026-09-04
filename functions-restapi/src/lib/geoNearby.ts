// Distance from GTFS stops to a drawn GeoJSON shape, for "which stops does
// this closure touch". Pure geometry over a local equirectangular
// projection (fine at city scale; the radii here are tens to hundreds of
// metres) so it needs no spatial extension in SQL.

export type Position = [number, number]; // [lon, lat]
export type DetourGeometry =
  | { type: "Point"; coordinates: Position }
  | { type: "LineString"; coordinates: Position[] }
  | { type: "Polygon"; coordinates: Position[][] };

const EARTH_RADIUS_M = 6371008.8;

function toLocal(p: Position, originLat: number): [number, number] {
  const k = Math.cos((originLat * Math.PI) / 180);
  return [(p[0] * Math.PI / 180) * EARTH_RADIUS_M * k, (p[1] * Math.PI / 180) * EARTH_RADIUS_M];
}

function segmentDistance(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  const cx = a[0] + t * dx, cy = a[1] + t * dy;
  return Math.hypot(p[0] - cx, p[1] - cy);
}

function pointInRing(p: [number, number], ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Metres from `point` to the shape: 0 inside a polygon, else the distance
// to the nearest edge or vertex.
export function distanceToGeometry(point: Position, geometry: DetourGeometry): number {
  const originLat = point[1];
  const p = toLocal(point, originLat);
  if (geometry.type === "Point") {
    const q = toLocal(geometry.coordinates, originLat);
    return Math.hypot(p[0] - q[0], p[1] - q[1]);
  }
  const rings = geometry.type === "Polygon" ? geometry.coordinates : [geometry.coordinates];
  let best = Infinity;
  for (const ring of rings) {
    const local = ring.map((c) => toLocal(c, originLat));
    if (geometry.type === "Polygon" && pointInRing(p, local)) return 0;
    for (let i = 0; i + 1 < local.length; i++) best = Math.min(best, segmentDistance(p, local[i], local[i + 1]));
    if (local.length === 1) best = Math.min(best, Math.hypot(p[0] - local[0][0], p[1] - local[0][1]));
  }
  return best;
}

export function validateDetourGeometry(value: unknown): { geometry: DetourGeometry } | { error: string } {
  const g = value as { type?: unknown; coordinates?: unknown };
  const isPos = (c: unknown): c is Position => Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]) && Math.abs(c[0] as number) <= 180 && Math.abs(c[1] as number) <= 90;
  if (!g || typeof g !== "object") return { error: "geometry must be a GeoJSON object" };
  if (g.type === "Point") return isPos(g.coordinates) ? { geometry: { type: "Point", coordinates: [g.coordinates[0], g.coordinates[1]] } } : { error: "Point coordinates must be [lon, lat]" };
  if (g.type === "LineString") {
    if (!Array.isArray(g.coordinates) || g.coordinates.length < 2 || !g.coordinates.every(isPos)) return { error: "LineString needs at least two [lon, lat] positions" };
    return { geometry: { type: "LineString", coordinates: g.coordinates.map((c) => [c[0], c[1]] as Position) } };
  }
  if (g.type === "Polygon") {
    if (!Array.isArray(g.coordinates) || g.coordinates.length === 0 || !g.coordinates.every((r: unknown) => Array.isArray(r) && r.length >= 4 && r.every(isPos))) return { error: "Polygon rings need at least four [lon, lat] positions" };
    return { geometry: { type: "Polygon", coordinates: g.coordinates.map((r: Position[]) => r.map((c) => [c[0], c[1]] as Position)) } };
  }
  return { error: "geometry must be a GeoJSON Point, LineString, or Polygon" };
}

// Cheap bounding-box prefilter so the exact distance runs on a handful of
// stops rather than every stop in the feed.
export function boundingBox(geometry: DetourGeometry, paddingM: number): { minLon: number; maxLon: number; minLat: number; maxLat: number } {
  const coords: Position[] = geometry.type === "Point" ? [geometry.coordinates] : geometry.type === "LineString" ? geometry.coordinates : geometry.coordinates.flat();
  const lats = coords.map((c) => c[1]), lons = coords.map((c) => c[0]);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const dLat = (paddingM / EARTH_RADIUS_M) * (180 / Math.PI);
  const dLon = dLat / Math.max(0.05, Math.cos((midLat * Math.PI) / 180));
  return { minLon: Math.min(...lons) - dLon, maxLon: Math.max(...lons) + dLon, minLat: Math.min(...lats) - dLat, maxLat: Math.max(...lats) + dLat };
}

// Metres between two drawn shapes: 0 when they touch or one contains the
// other's vertex; otherwise the least vertex-to-shape distance in either
// direction. Vertex sampling is exact for points, exact for line/polygon
// pairs whose closest approach is at a vertex, and within a segment's
// length otherwise - fine for "are these the same closure" at the radii
// used here.
export function geometryDistance(a: DetourGeometry, b: DetourGeometry): number {
  const vertices = (g: DetourGeometry): Position[] => g.type === "Point" ? [g.coordinates] : g.type === "LineString" ? g.coordinates : g.coordinates.flat();
  let best = Infinity;
  for (const v of vertices(a)) best = Math.min(best, distanceToGeometry(v, b));
  for (const v of vertices(b)) best = Math.min(best, distanceToGeometry(v, a));
  return best;
}

// Stored geometry_json to a DetourGeometry, or null when absent or malformed.
export function parseGeometryJson(text: string | null | undefined): DetourGeometry | null {
  if (!text) return null;
  try { const parsed = validateDetourGeometry(JSON.parse(text)); return "geometry" in parsed ? parsed.geometry : null; }
  catch { return null; }
}
