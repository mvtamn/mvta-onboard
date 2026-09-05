// Stop identity for duplicate and conflict matching. Two records that touch
// the same GTFS stop are about the same place even when their shapes are
// far apart (a long line versus a point at one end) or one has no shape at
// all. Stop ids come from two sources: stops within STOP_MATCH_M of a
// drawn shape, and "#stop_id" markers in the affected-stops text (which is
// what the map's "add selected stops" writes).
import type { ConnectionPool } from "mssql";
import { boundingBox, distanceToGeometry, type DetourGeometry } from "./geoNearby";

export const STOP_MATCH_M = 100;

export interface StopIndexEntry { stop_id: string; stop_name: string; stop_lat: number; stop_lon: number; }

export function stopIdsFromText(text: string | null | undefined): string[] {
  if (!text) return [];
  return [...new Set([...text.matchAll(/#([A-Za-z0-9_-]{1,50})/g)].map((m) => m[1]))];
}

export function stopsNearGeometry(index: StopIndexEntry[], geometry: DetourGeometry, radiusM = STOP_MATCH_M): StopIndexEntry[] {
  const box = boundingBox(geometry, radiusM);
  return index
    .filter((s) => s.stop_lat >= box.minLat && s.stop_lat <= box.maxLat && s.stop_lon >= box.minLon && s.stop_lon <= box.maxLon)
    .filter((s) => distanceToGeometry([s.stop_lon, s.stop_lat], geometry) <= radiusM);
}

export function stopIdsForRecord(index: StopIndexEntry[], geometry: DetourGeometry | null | undefined, affectedText: string | null | undefined): string[] {
  const ids = new Set(stopIdsFromText(affectedText));
  if (geometry) for (const s of stopsNearGeometry(index, geometry)) ids.add(s.stop_id);
  return [...ids];
}

// Every stop with coordinates, once per request. A few thousand rows; the
// bounding-box prefilter keeps the per-record cost small.
export async function loadStopIndex(pool: ConnectionPool): Promise<StopIndexEntry[]> {
  try {
    const result = await pool.request().query<StopIndexEntry>("SELECT stop_id, stop_name, stop_lat, stop_lon FROM GtfsStops WHERE stop_lat IS NOT NULL AND stop_lon IS NOT NULL");
    return result.recordset;
  } catch { return []; }
}

export function stopNameLookup(index: StopIndexEntry[]): (id: string) => string {
  const byId = new Map(index.map((s) => [s.stop_id, s.stop_name]));
  return (id) => byId.get(id) ?? `#${id}`;
}
