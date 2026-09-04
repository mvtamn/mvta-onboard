import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { DETOUR_READ_ROLES, requireRole } from "../lib/auth";
import { boundingBox, distanceToGeometry, validateDetourGeometry } from "../lib/geoNearby";

// POST /gtfs-stops/near { geometry, radius_m } - GTFS stops within radius_m
// of a drawn shape, with the routes that serve each (GtfsStopRoutes,
// migration 091). The console uses this to suggest affected stops and
// route segments for a detour drawn on the map. Suggestions only: nothing
// is written.
const MAX_RADIUS_M = 1000;
const MAX_STOPS = 200;

app.http("gtfsStopsNear", {
  route: "gtfs-stops/near", methods: ["POST"], authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, DETOUR_READ_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    let body: Record<string, unknown>;
    try { body = (await request.json()) as Record<string, unknown>; } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON" } }; }
    const parsed = validateDetourGeometry(body.geometry);
    if ("error" in parsed) return { status: 400, jsonBody: { error: parsed.error } };
    const radius = typeof body.radius_m === "number" && Number.isFinite(body.radius_m) ? Math.min(MAX_RADIUS_M, Math.max(1, body.radius_m)) : 100;
    try {
      const pool = await getPool();
      const box = boundingBox(parsed.geometry, radius);
      const stops = await pool.request()
        .input("minLon", sql.Float, box.minLon).input("maxLon", sql.Float, box.maxLon).input("minLat", sql.Float, box.minLat).input("maxLat", sql.Float, box.maxLat)
        .query<{ stop_id: string; stop_name: string; stop_lat: number; stop_lon: number }>(
          "SELECT stop_id, stop_name, stop_lat, stop_lon FROM GtfsStops WHERE stop_lat BETWEEN @minLat AND @maxLat AND stop_lon BETWEEN @minLon AND @maxLon",
        );
      const near = stops.recordset
        .map((s) => ({ ...s, distance_m: Math.round(distanceToGeometry([s.stop_lon, s.stop_lat], parsed.geometry)) }))
        .filter((s) => s.distance_m <= radius)
        .sort((a, b) => a.distance_m - b.distance_m)
        .slice(0, MAX_STOPS);
      const routesByStop = new Map<string, string[]>();
      const hasStopRoutes = (await pool.request().query<{ ready: number }>("SELECT CASE WHEN OBJECT_ID('dbo.GtfsStopRoutes', 'U') IS NULL THEN 0 ELSE 1 END AS ready")).recordset[0]?.ready === 1;
      if (hasStopRoutes && near.length > 0) {
        const req = pool.request();
        const params = near.map((s, i) => { req.input(`s${i}`, sql.NVarChar(50), s.stop_id); return `@s${i}`; });
        const links = await req.query<{ stop_id: string; route_id: string; route_short_name: string | null }>(
          `SELECT sr.stop_id, sr.route_id, r.route_short_name FROM GtfsStopRoutes sr LEFT JOIN GtfsRoutes r ON r.route_id = sr.route_id WHERE sr.stop_id IN (${params.join(",")}) ORDER BY sr.route_id`,
        );
        for (const link of links.recordset) {
          const list = routesByStop.get(link.stop_id) ?? [];
          list.push(link.route_short_name || link.route_id);
          routesByStop.set(link.stop_id, list);
        }
      }
      return { status: 200, jsonBody: { radius_m: radius, stop_routes_indexed: hasStopRoutes, stops: near.map((s) => ({ ...s, routes: routesByStop.get(s.stop_id) ?? [] })) } };
    } catch (err) { context.error("POST gtfs-stops/near failed:", err); return { status: 500, jsonBody: { error: "Internal server error" } }; }
  },
});
