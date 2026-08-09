export type Point = [number, number];

export function polygonContains(polygonJson: string, point: Point): boolean {
  const geo = JSON.parse(polygonJson) as { type?: string; coordinates?: Point[][] };
  const ring = geo.type === "Polygon" ? geo.coordinates?.[0] : undefined;
  if (!ring || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    const hit = yi > point[1] !== yj > point[1]
      && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

export function headingInRange(heading: number | null, min: number, max: number): boolean {
  if (heading === null) return false;
  const h = ((heading % 360) + 360) % 360;
  return min <= max ? h >= min && h <= max : h >= min || h <= max;
}
