import { useEffect, useRef, useState } from "react";
import type * as atlas from "azure-maps-control";
import type * as drawing from "azure-maps-drawing-tools";
import { ApiError, type NearbyGtfsStop } from "@mvta/shared";
import { api } from "../config.js";
import { useAuth } from "../auth/AuthContext.js";
import "../routes/modules/eventMonitoring.css";

// Map drawing for a Detour: a point (a closed stop), a line (a closed
// street or the detour path), or a polygon (an area). Same Azure Maps
// setup as the Event resource editor - token from the API, drawing
// toolbar - but the product is a GeoJSON geometry string handed back to
// the intake form, plus the GTFS stops near it so the reporter can pick
// affected stops and the routes serving them. Nothing here writes.
//
// azure-maps-control is loaded on demand: it touches Worker at module
// load, which jsdom lacks, and it is heavy - the detour pages should not
// pay for it until a map is actually on screen.

type MapLibs = { atlas: typeof atlas; drawing: typeof drawing };
let libsPromise: Promise<MapLibs> | null = null;
function loadMapLibs(): Promise<MapLibs> {
  libsPromise ??= Promise.all([
    import("azure-maps-control"),
    import("azure-maps-drawing-tools"),
    import("azure-maps-control/dist/atlas.min.css"),
    import("azure-maps-drawing-tools/dist/atlas-drawing.min.css"),
  ]).then(([a, d]) => ({ atlas: a, drawing: d }));
  return libsPromise;
}

const CENTER: atlas.data.Position = [-93.25, 44.83];
const DEFAULT_RADIUS_M = 100;
type Geometry = atlas.data.Geometry;

export interface DetourMapProps {
  value: string | null;
  onChange: (geometryJson: string | null) => void;
  // Called with the reporter's chosen stops/routes; the form appends them.
  onSuggest?: (picked: { stops: NearbyGtfsStop[]; routes: string[] }) => void;
  readOnly?: boolean;
  height?: number;
}

function fitTo(lib: typeof atlas, map: atlas.Map, geometry: Geometry) {
  const bbox = lib.data.BoundingBox.fromData(geometry as atlas.data.Geometry);
  map.setCamera({ bounds: bbox, padding: 60, maxZoom: 16 });
}

export function DetourMap({ value, onChange, onSuggest, readOnly = false, height = 380 }: DetourMapProps) {
  const { account } = useAuth();
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<atlas.Map | null>(null);
  const drawingRef = useRef<drawing.drawing.DrawingManager | null>(null);
  const stopsSourceRef = useRef<atlas.source.DataSource | null>(null);
  const valueRef = useRef(value);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [radius, setRadius] = useState(DEFAULT_RADIUS_M);
  const [nearby, setNearby] = useState<NearbyGtfsStop[] | null>(null);
  const [indexed, setIndexed] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const libsRef = useRef<MapLibs | null>(null);

  useEffect(() => {
    if (!account || !host.current) return;
    let cancelled = false;
    Promise.all([loadMapLibs(), api.getMapsToken()]).then(([libs, token]) => {
      if (cancelled || !host.current) return;
      libsRef.current = libs;
      const { atlas, drawing } = libs;
      const map = new atlas.Map(host.current, { center: CENTER, zoom: 11, style: "road", authOptions: { authType: atlas.AuthenticationType.anonymous, clientId: token.client_id, getToken: (resolve, reject) => api.getMapsToken().then((next) => resolve(next.access_token)).catch(reject) } });
      mapRef.current = map;
      map.events.addOnce("ready", () => {
        if (cancelled) return;
        const stops = new atlas.source.DataSource("detour-nearby-stops");
        map.sources.add(stops); stopsSourceRef.current = stops;
        map.layers.add([
          new atlas.layer.BubbleLayer(stops, "detour-nearby-stops-dots", { radius: 6, color: ["case", ["get", "picked"], "#00553D", "#ffb000"], strokeColor: "#ffffff", strokeWidth: 2 }),
          new atlas.layer.SymbolLayer(stops, "detour-nearby-stops-labels", { iconOptions: { image: "none" }, textOptions: { textField: ["get", "label"], offset: [0, 1.2], size: 11, haloColor: "#ffffff", haloWidth: 1 } }),
        ]);
        const source = new atlas.source.DataSource("detour-geometry");
        map.sources.add(source);
        if (readOnly) {
          map.layers.add([
            new atlas.layer.PolygonLayer(source, "detour-geometry-fill", { fillColor: "#c62828", fillOpacity: 0.18 }),
            new atlas.layer.LineLayer(source, "detour-geometry-line", { strokeColor: "#c62828", strokeWidth: 4 }),
            new atlas.layer.BubbleLayer(source, "detour-geometry-point", { radius: 9, color: "#c62828", strokeColor: "#ffffff", strokeWidth: 2, filter: ["==", ["geometry-type"], "Point"] }),
          ]);
          if (valueRef.current) { try { const g = JSON.parse(valueRef.current) as Geometry; source.add(new atlas.Shape(g)); fitTo(atlas, map, g); } catch { /* ignore bad stored geometry */ } }
          setReady(true);
          return;
        }
        const toolbar = new drawing.control.DrawingToolbar({ buttons: ["draw-point", "draw-line", "draw-polygon", "edit-geometry", "erase-geometry"], position: atlas.ControlPosition.TopRight });
        const manager = new drawing.drawing.DrawingManager(map, { mode: drawing.drawing.DrawingMode.idle, interactionType: drawing.drawing.DrawingInteractionType.click, toolbar });
        drawingRef.current = manager;
        if (valueRef.current) { try { const g = JSON.parse(valueRef.current) as Geometry; manager.getSource().add(new atlas.Shape(g)); fitTo(atlas, map, g); } catch { /* ignore */ } }
        const emit = () => {
          const shapes = manager.getSource().getShapes();
          // One shape per detour: the newest drawing replaces the rest.
          const latest = shapes[shapes.length - 1];
          for (const old of shapes.slice(0, -1)) manager.getSource().remove(old);
          const geometry = latest ? (latest.toJson() as atlas.data.Feature<Geometry, unknown>).geometry : null;
          const json = geometry ? JSON.stringify(geometry) : null;
          valueRef.current = json; onChange(json);
          setNearby(null); setPicked(new Set()); stopsSourceRef.current?.clear();
        };
        map.events.add("drawingcomplete", manager, () => { manager.setOptions({ mode: drawing.drawing.DrawingMode.idle }); emit(); });
        map.events.add("drawingchanged", manager, () => { /* live edits settle on drawingcomplete/erase */ });
        map.events.add("drawingerased", manager, () => emit());
        map.events.add("drawingmodechanged", manager, (mode) => { if (mode === drawing.drawing.DrawingMode.idle) emit(); });
        setReady(true);
      });
    }).catch((err) => setError(err instanceof ApiError && err.status === 401 ? "Sign in again to use the map." : err instanceof ApiError ? err.message : "Map unavailable."));
    return () => { cancelled = true; drawingRef.current?.dispose(); mapRef.current?.dispose(); drawingRef.current = null; mapRef.current = null; stopsSourceRef.current = null; };
  }, [account, readOnly]);

  // Repaint the stop markers whenever the pick set or result changes.
  useEffect(() => {
    const source = stopsSourceRef.current;
    const atlas = libsRef.current?.atlas;
    if (!source || !atlas) return;
    source.clear();
    for (const stop of nearby ?? []) {
      source.add(new atlas.data.Feature(new atlas.data.Point([stop.stop_lon, stop.stop_lat]), { picked: picked.has(stop.stop_id), label: stop.routes.length ? `${stop.stop_name} (${stop.routes.join(", ")})` : stop.stop_name }));
    }
  }, [nearby, picked]);

  async function findStops() {
    if (!valueRef.current) return;
    setSearching(true); setError(null);
    try {
      const result = await api.findStopsNear(JSON.parse(valueRef.current), radius);
      setNearby(result.stops); setIndexed(result.stop_routes_indexed); setPicked(new Set(result.stops.map((s) => s.stop_id)));
    } catch (err) { setError(err instanceof ApiError ? err.message : "Could not look up nearby stops."); }
    finally { setSearching(false); }
  }

  function togglePick(stopId: string) {
    setPicked((current) => { const next = new Set(current); if (next.has(stopId)) next.delete(stopId); else next.add(stopId); return next; });
  }

  function apply() {
    const stops = (nearby ?? []).filter((s) => picked.has(s.stop_id));
    const routes = [...new Set(stops.flatMap((s) => s.routes))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    onSuggest?.({ stops, routes });
  }

  return (
    <div>
      <div className="evmon-real-map" style={{ height, minHeight: height }}>
        <div ref={host} className="evmon-map-container" />
        {!account ? <div className="evmon-map-message">Sign in to use the map.</div> : null}
        {error ? <div className="evmon-map-message">{error}</div> : null}
        {account && !ready && !error ? <div className="evmon-map-message">Loading map…</div> : null}
      </div>
      {!readOnly ? (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span className="td-dim">{value ? "Shape drawn. " : "Use the toolbar to draw a point, line, or area; the newest shape replaces the previous one. "}</span>
            <label className="td-dim">Stops within <input type="number" min={10} max={1000} step={10} value={radius} onChange={(e) => setRadius(Math.max(10, Math.min(1000, Number(e.target.value) || DEFAULT_RADIUS_M)))} style={{ width: 70 }} /> m</label>
            <button type="button" className="btn-sm" disabled={!value || searching} onClick={() => void findStops()}>{searching ? "Searching…" : "Find nearby stops"}</button>
            {value ? <button type="button" className="btn-sm" onClick={() => { drawingRef.current?.getSource().clear(); valueRef.current = null; onChange(null); setNearby(null); setPicked(new Set()); stopsSourceRef.current?.clear(); }}>Clear shape</button> : null}
          </div>
          {nearby !== null ? (
            nearby.length === 0 ? <p className="muted">No GTFS stops within {radius} m of the shape.</p> : (
              <div className="intake-checklist">
                <strong>{nearby.length} stop{nearby.length === 1 ? "" : "s"} within {radius} m{!indexed ? " · route index not built yet (run the static GTFS sync after migration 091)" : ""}</strong>
                <ul style={{ maxHeight: 180, overflowY: "auto" }}>
                  {nearby.map((stop) => <li key={stop.stop_id}>
                    <label><input type="checkbox" checked={picked.has(stop.stop_id)} onChange={() => togglePick(stop.stop_id)} /> {stop.stop_name} <span className="td-subtle">#{stop.stop_id} · {stop.distance_m} m{stop.routes.length ? ` · routes ${stop.routes.join(", ")}` : ""}</span></label>
                  </li>)}
                </ul>
                {onSuggest ? <button type="button" className="btn-sm" disabled={picked.size === 0} onClick={apply}>Add {picked.size} selected stop{picked.size === 1 ? "" : "s"} and their routes to the intake</button> : null}
              </div>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
