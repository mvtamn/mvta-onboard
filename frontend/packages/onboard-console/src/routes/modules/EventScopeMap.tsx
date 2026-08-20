import { useEffect, useRef, useState } from "react";
import * as atlas from "azure-maps-control";
import "azure-maps-control/dist/atlas.min.css";
import { ApiError, type EventGeofence, type EventLocation } from "@mvta/shared";
import { api } from "../../config.js";
import { removeMapLayersIfPresent } from "./mapLayerCleanup.js";
import { resolveScopeMapClick, scopeMapFeatures } from "./eventScopeMapFeatures.js";

const MAP_CENTER: atlas.data.Position = [-93.25, 44.83];
const MAP_ZOOM = 10;

// Same palette contract as EventVehicleMap: these paint onto raster tiles
// rather than a console surface, so they stay constant across themes and are
// anchored on MVTA Evergreen per DESIGN.md's Evergreen Anchor Rule. The legend
// swatches in styles.css must match these exactly or the legend lies.
const IN_SCOPE = "#00553d";
const AVAILABLE = "#8a8a86";
const LABEL_INK = "#2c2c2a";

export interface EventScopeMapProps {
  geofences: EventGeofence[];
  locations: EventLocation[];
  linkedGeofenceIds: string[];
  linkedLocationIds: string[];
  onToggleGeofence: (geofence: EventGeofence, isLinked: boolean) => void;
  onToggleLocation: (location: EventLocation, isLinked: boolean) => void;
  disabled?: boolean;
}

/**
 * Picks an Event Plan's geographic scope by clicking the map, so a planner can
 * see whether the boundaries and points they are linking actually cover the
 * service they are running. Authoring lives in Event Administration; this
 * surface only chooses among boundaries that already exist.
 */
export function EventScopeMap({ geofences, locations, linkedGeofenceIds, linkedLocationIds, onToggleGeofence, onToggleLocation, disabled = false }: EventScopeMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<atlas.Map | null>(null);
  const sourceRef = useRef<atlas.source.DataSource | null>(null);
  const layersRef = useRef<atlas.layer.Layer[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Click handlers close over the current links, and Azure Maps holds the
  // handler it was given at layer-creation time. Routing through a ref keeps
  // a click acting on the latest scope instead of the scope as it stood when
  // the layer was built.
  const handlersRef = useRef({ geofences, locations, linkedGeofenceIds, linkedLocationIds, onToggleGeofence, onToggleLocation, disabled });
  handlersRef.current = { geofences, locations, linkedGeofenceIds, linkedLocationIds, onToggleGeofence, onToggleLocation, disabled };

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    let map: atlas.Map | null = null;
    api.getMapsToken().then((initial) => {
      if (cancelled || !containerRef.current) return;
      map = new atlas.Map(containerRef.current, {
        center: MAP_CENTER, zoom: MAP_ZOOM, style: "road",
        authOptions: {
          authType: atlas.AuthenticationType.anonymous,
          clientId: initial.client_id,
          getToken: (resolve, reject) => api.getMapsToken().then((data) => resolve(data.access_token)).catch(reject),
        },
      });
      mapRef.current = map;
      map.events.addOnce("ready", () => !cancelled && setReady(true));
      // Fetching the token can succeed while the map itself still fails to
      // authenticate or initialise. Without this the panel sat on "Loading the
      // scope map..." indefinitely, which reads as a hang rather than a
      // failure - confirmed against a running console.
      map.events.add("error", () => {
        if (!cancelled) setError("The map could not be initialised. Check that your session grants access to Azure Maps, then try again.");
      });
    }).catch((err) => setError(err instanceof ApiError ? `Could not load the map: ${err.message}` : "Could not reach the map service."));
    return () => { cancelled = true; map?.dispose(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let source = sourceRef.current;
    if (!source) {
      source = new atlas.source.DataSource("event-scope");
      map.sources.add(source);
      sourceRef.current = source;
    }
    removeMapLayersIfPresent(map, layersRef.current);
    layersRef.current = [];
    source.clear();

    const features = scopeMapFeatures(geofences, locations, linkedGeofenceIds, linkedLocationIds);
    const linkedOf = new Map(features.map((feature) => [`${feature.kind}:${feature.id}`, feature.linked]));
    geofences.forEach((fence) => {
      try {
        const polygon = JSON.parse(fence.polygon) as { coordinates: atlas.data.Position[][] };
        source?.add(new atlas.data.Feature(new atlas.data.Polygon(polygon.coordinates), {
          kind: "geofence", id: fence.id, name: fence.name, linked: linkedOf.get(`geofence:${fence.id}`) ?? false,
        }));
      } catch { /* invalid authoring geometry is surfaced by the authoring surface */ }
    });
    locations.forEach((location) => source?.add(new atlas.data.Feature(new atlas.data.Point([location.longitude, location.latitude]), {
      kind: "location", id: location.id, name: location.name, linked: linkedOf.get(`location:${location.id}`) ?? false,
    })));

    const inScopeFill = new atlas.layer.PolygonLayer(source, "event-scope-linked-fill", {
      fillColor: IN_SCOPE, fillOpacity: 0.22,
      filter: ["all", ["==", ["get", "kind"], "geofence"], ["==", ["get", "linked"], true]],
    });
    const inScopeLine = new atlas.layer.LineLayer(source, "event-scope-linked-line", {
      strokeColor: IN_SCOPE, strokeWidth: 3,
      filter: ["all", ["==", ["get", "kind"], "geofence"], ["==", ["get", "linked"], true]],
    });
    // Available boundaries stay visible but recede: a dashed hairline reads as
    // "you could add this" without competing with what is already in scope.
    const availableFill = new atlas.layer.PolygonLayer(source, "event-scope-available-fill", {
      fillColor: AVAILABLE, fillOpacity: 0.06,
      filter: ["all", ["==", ["get", "kind"], "geofence"], ["==", ["get", "linked"], false]],
    });
    const availableLine = new atlas.layer.LineLayer(source, "event-scope-available-line", {
      strokeColor: AVAILABLE, strokeWidth: 1.5, strokeDashArray: [3, 3],
      filter: ["all", ["==", ["get", "kind"], "geofence"], ["==", ["get", "linked"], false]],
    });
    const linkedPointLayer = new atlas.layer.BubbleLayer(source, "event-scope-linked-points", {
      color: IN_SCOPE, radius: 10, strokeColor: "#ffffff", strokeWidth: 3,
      filter: ["all", ["==", ["get", "kind"], "location"], ["==", ["get", "linked"], true]],
    });
    const availablePointLayer = new atlas.layer.BubbleLayer(source, "event-scope-available-points", {
      color: AVAILABLE, radius: 7, strokeColor: "#ffffff", strokeWidth: 2,
      filter: ["all", ["==", ["get", "kind"], "location"], ["==", ["get", "linked"], false]],
    });
    const labels = new atlas.layer.SymbolLayer(source, "event-scope-labels", {
      iconOptions: { image: "none", allowOverlap: true },
      textOptions: { textField: ["get", "name"], offset: [0, 1.4], color: LABEL_INK, haloColor: "#fff", haloWidth: 2, allowOverlap: true },
    });
    const all = [availableFill, availableLine, inScopeFill, inScopeLine, availablePointLayer, linkedPointLayer, labels];
    map.layers.add(all);
    layersRef.current = all;

    const onClick = (event: atlas.MapMouseEvent) => {
      const feature = event.shapes?.[0];
      if (!feature) return;
      const properties = ("getProperties" in feature ? feature.getProperties() : (feature as { properties?: Record<string, unknown> }).properties) as
        { kind?: string; id?: string; linked?: boolean } | undefined;
      const current = handlersRef.current;
      const resolved = resolveScopeMapClick(properties, current.geofences, current.locations, current.disabled);
      if (resolved.action === "ignore") return;
      const isLinked = resolved.action === "unlink";
      if (resolved.kind === "geofences") {
        const fence = current.geofences.find((row) => row.id === resolved.id);
        if (fence) current.onToggleGeofence(fence, isLinked);
        return;
      }
      const location = current.locations.find((row) => row.id === resolved.id);
      if (location) current.onToggleLocation(location, isLinked);
    };
    map.events.add("click", inScopeFill, onClick);
    map.events.add("click", availableFill, onClick);
    map.events.add("click", linkedPointLayer, onClick);
    map.events.add("click", availablePointLayer, onClick);
  }, [geofences, locations, linkedGeofenceIds, linkedLocationIds, ready]);

  return <div className="event-scope-map">
    <div className="event-scope-map-canvas" ref={containerRef} role="application" aria-label="Event Plan scope map" />
    {!ready && !error && <p className="event-scope-map-state">Loading the scope map…</p>}
    {error && <p className="event-scope-map-state" role="alert">{error}</p>}
    <p className="event-scope-map-legend">
      <span><i className="event-scope-swatch is-linked" /> In this Event Plan</span>
      <span><i className="event-scope-swatch is-available" /> Available to add</span>
      <span className="muted">{disabled ? "This Event Plan is read-only at its current status." : "Select a boundary or point on the map to add or remove it."}</span>
    </p>
  </div>;
}
