type Position = [number, number];

function pointOnSegment(point: Position, start: Position, end: Position): boolean {
  const cross = (point[1] - start[1]) * (end[0] - start[0]) - (point[0] - start[0]) * (end[1] - start[1]);
  if (Math.abs(cross) > 1e-10) return false;
  return point[0] >= Math.min(start[0], end[0]) - 1e-10 && point[0] <= Math.max(start[0], end[0]) + 1e-10
    && point[1] >= Math.min(start[1], end[1]) - 1e-10 && point[1] <= Math.max(start[1], end[1]) + 1e-10;
}

function segmentsIntersect(a: Position, b: Position, c: Position, d: Position): boolean {
  const cross = (start: Position, end: Position, point: Position) => (end[0] - start[0]) * (point[1] - start[1]) - (end[1] - start[1]) * (point[0] - start[0]);
  const abC = cross(a, b, c); const abD = cross(a, b, d); const cdA = cross(c, d, a); const cdB = cross(c, d, b);
  return (abC > 0 && abD < 0 || abC < 0 && abD > 0) && (cdA > 0 && cdB < 0 || cdA < 0 && cdB > 0)
    || abC === 0 && pointOnSegment(c, a, b) || abD === 0 && pointOnSegment(d, a, b)
    || cdA === 0 && pointOnSegment(a, c, d) || cdB === 0 && pointOnSegment(b, c, d);
}

function hasSelfIntersection(ring: Position[]): boolean {
  const edges = ring.slice(0, -1).map((point, index) => [point, ring[index + 1]] as const);
  for (let first = 0; first < edges.length; first += 1) for (let second = first + 1; second < edges.length; second += 1) {
    if (second === first + 1 || (first === 0 && second === edges.length - 1)) continue;
    if (segmentsIntersect(edges[first][0], edges[first][1], edges[second][0], edges[second][1])) return true;
  }
  return false;
}

export function validateDrawnPolygon(polygonJson: string): string | null {
  let geo: { type?: unknown; coordinates?: unknown };
  try { geo = JSON.parse(polygonJson) as { type?: unknown; coordinates?: unknown }; } catch { return "polygon must be valid GeoJSON"; }
  if (geo.type !== "Polygon" || !Array.isArray(geo.coordinates) || !Array.isArray(geo.coordinates[0])) return "polygon must be a GeoJSON Polygon";
  for (const rawRing of geo.coordinates) {
    if (!Array.isArray(rawRing) || rawRing.length < 4) return "polygon rings must be closed and contain at least four positions";
    const ring = rawRing as unknown[];
    const first = ring[0] as unknown[] | undefined; const last = ring[ring.length - 1] as unknown[] | undefined;
    if (!Array.isArray(first) || !Array.isArray(last) || first[0] !== last[0] || first[1] !== last[1]) {
      return "polygon rings must be closed and contain at least four positions";
    }
    if (ring.some((point) => !Array.isArray(point) || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]))) return "polygon coordinates must be finite numbers";
    if (hasSelfIntersection(ring as Position[])) return "polygon rings must not self-intersect";
  }
  return null;
}
