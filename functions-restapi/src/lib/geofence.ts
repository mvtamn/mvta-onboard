export type Point = [number, number];

function pointOnSegment(point: Point, a: Point, b: Point): boolean {
  const cross = (point[1] - a[1]) * (b[0] - a[0]) - (point[0] - a[0]) * (b[1] - a[1]);
  if (Math.abs(cross) > 1e-10) return false;
  return point[0] >= Math.min(a[0], b[0]) - 1e-10 && point[0] <= Math.max(a[0], b[0]) + 1e-10
    && point[1] >= Math.min(a[1], b[1]) - 1e-10 && point[1] <= Math.max(a[1], b[1]) + 1e-10;
}

function ringContains(ring: Point[], point: Point): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j]; const b = ring[i];
    if (pointOnSegment(point, a, b)) return true;
    const hit = a[1] > point[1] !== b[1] > point[1]
      && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0];
    if (hit) inside = !inside;
  }
  return inside;
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const orientation = (p: Point, q: Point, r: Point) => Math.sign((q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]));
  const on = (p: Point, q: Point, r: Point) => q[0] >= Math.min(p[0], r[0]) && q[0] <= Math.max(p[0], r[0]) && q[1] >= Math.min(p[1], r[1]) && q[1] <= Math.max(p[1], r[1]);
  const o1 = orientation(a, b, c); const o2 = orientation(a, b, d); const o3 = orientation(c, d, a); const o4 = orientation(c, d, b);
  return (o1 !== o2 && o3 !== o4) || (o1 === 0 && on(a, c, b)) || (o2 === 0 && on(a, d, b)) || (o3 === 0 && on(c, a, d)) || (o4 === 0 && on(c, b, d));
}

function hasSelfIntersection(ring: Point[]): boolean {
  const edges = ring.slice(0, -1).map((point, index) => [point, ring[index + 1]] as const);
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    if (j === i + 1 || (i === 0 && j === edges.length - 1)) continue;
    if (segmentsIntersect(edges[i][0], edges[i][1], edges[j][0], edges[j][1])) return true;
  }
  return false;
}

export function polygonContains(polygonJson: string, point: Point): boolean {
  const geo = JSON.parse(polygonJson) as { type?: string; coordinates?: Point[][] };
  if (geo.type !== "Polygon" || !geo.coordinates?.[0]) return false;
  return ringContains(geo.coordinates[0], point)
    && !geo.coordinates.slice(1).some((hole) => ringContains(hole, point));
}

export function validatePolygon(polygonJson: string): string | null {
  let geo: { type?: string; coordinates?: Point[][] };
  try { geo = JSON.parse(polygonJson); } catch { return "polygon must be valid GeoJSON"; }
  if (geo.type !== "Polygon" || !geo.coordinates?.[0]) return "polygon must be a GeoJSON Polygon";
  for (const ring of geo.coordinates) {
    if (ring.length < 4 || ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
      return "polygon rings must be closed and contain at least four positions";
    }
    if (ring.some(([longitude, latitude]) => !Number.isFinite(longitude) || !Number.isFinite(latitude))) {
      return "polygon coordinates must be finite numbers";
    }
    if (hasSelfIntersection(ring)) return "polygon rings must not self-intersect";
  }
  return null;
}

export function headingInRange(heading: number | null, min: number, max: number): boolean {
  if (heading === null) return false;
  const h = ((heading % 360) + 360) % 360;
  return min <= max ? h >= min && h <= max : h >= min || h <= max;
}
