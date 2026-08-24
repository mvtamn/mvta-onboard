import { useEffect, useRef, useState } from "react";
import * as atlas from "azure-maps-control";
import "azure-maps-control/dist/atlas.min.css";
import { ApiError, type EventGeofence, type EventLocation, type EventVehiclePosition } from "@mvta/shared";
import { api } from "../../config.js";
import { useTheme } from "../../theme/ThemeContext.js";
import { removeMapLayersIfPresent } from "./mapLayerCleanup.js";
import { cardinalHeading, displayOperator, escapeHtml, minutesAgo, routeVehicleLabel } from "./eventVehicleFormat.js";

const MAP_CENTER: atlas.data.Position = [-93.25, 44.83];
const MAP_ZOOM = 10;
export type MapStyle = "road" | "grayscale_light" | "night" | "satellite_road_labels";

interface EventVehicleMapProps {
  vehicles: EventVehiclePosition[];
  geofences: EventGeofence[];
  locations: EventLocation[];
  showGeofences: boolean;
  showLocations: boolean;
  mapStyle: MapStyle;
  traffic: boolean;
  selectedVehicleId?: number | null;
  onSelectVehicle?: (vehicleId: number) => void;
  onShowGeofencesChange?: (visible: boolean) => void;
  onShowLocationsChange?: (visible: boolean) => void;
  onMapStyleChange?: (style: MapStyle) => void;
  onTrafficChange?: (visible: boolean) => void;
}

// Map data-layer palette. These paint onto raster tiles rather than a console
// surface, so they stay constant across themes - but they are anchored on MVTA
// Evergreen rather than separate map greens, per DESIGN.md's Evergreen Anchor
// Rule. The legend swatches in eventMonitoring.css must match these exactly or
// the legend misreports what is on the map.
const MAP_BRAND = "#00553d";
const MAP_INACTIVE = "#888888";
const MAP_LABEL_INK = "#2c2c2a";

export function EventVehicleMap({ vehicles, geofences, locations, showGeofences, showLocations, mapStyle, traffic, selectedVehicleId, onSelectVehicle, onShowGeofencesChange, onShowLocationsChange, onMapStyleChange, onTrafficChange }: EventVehicleMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<atlas.Map | null>(null);
  const popupRef = useRef<atlas.Popup | null>(null);
  const resourceSourceRef = useRef<atlas.source.DataSource | null>(null);
  const resourceLayersRef = useRef<atlas.layer.Layer[]>([]);
  const fittedRef = useRef(false);
  const initialMapStyleRef = useRef(mapStyle);
  const appliedStyleRef = useRef<MapStyle | null>(null);
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const { theme } = useTheme();

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    let map: atlas.Map | null = null;
    let mapReady = false;
    let resizeFrame: number | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let listeningForWindowResize = false;
    const resizeMap = () => {
      if (cancelled || !mapReady) return;
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = undefined;
        if (!cancelled) map?.resize();
      });
    };
    api.getMapsToken().then((initial) => {
      if (cancelled || !containerRef.current) return;
      map = new atlas.Map(containerRef.current, {
        center: MAP_CENTER, zoom: MAP_ZOOM, style: initialMapStyleRef.current,
        authOptions: {
          authType: atlas.AuthenticationType.anonymous,
          clientId: initial.client_id,
          getToken: (resolve, reject) => api.getMapsToken().then((data) => resolve(data.access_token)).catch(reject),
        },
      });
      mapRef.current = map;
      map.controls.add([new atlas.control.ZoomControl(), new atlas.control.CompassControl()], { position: atlas.ControlPosition.BottomRight });
      // fillColor is applied by the theme-sync effect below, which runs once
      // `ready` flips - before any marker can open the popup.
      popupRef.current = new atlas.Popup({ pixelOffset: [0, -24], closeButton: false });
      map.events.addOnce("ready", () => {
        mapReady = true;
        appliedStyleRef.current = initialMapStyleRef.current;
        resizeMap();
        if (!cancelled) setReady(true);
      });
      map.events.addOnce("load", () => !cancelled && setLoaded(true));
      map.events.add("error", () => {
        if (!cancelled) setError("The map could not be initialised. Check that your session grants access to Azure Maps, then try again.");
      });
      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(resizeMap);
        resizeObserver.observe(containerRef.current);
      } else {
        window.addEventListener("resize", resizeMap);
        listeningForWindowResize = true;
      }
    }).catch((err) => setError(err instanceof ApiError ? `Could not load the map: ${err.message}` : "Could not reach the map service."));
    return () => {
      cancelled = true;
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      resizeObserver?.disconnect();
      if (listeningForWindowResize) window.removeEventListener("resize", resizeMap);
      popupRef.current = null;
      map?.dispose();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let source = resourceSourceRef.current;
    if (!source) {
      source = new atlas.source.DataSource("event-resources");
      map.sources.add(source);
      resourceSourceRef.current = source;
    }
    removeMapLayersIfPresent(map, resourceLayersRef.current);
    resourceLayersRef.current = [];
    source.clear();
    if (showGeofences) {
      geofences.forEach((fence) => {
        try {
          const polygon = JSON.parse(fence.polygon) as { coordinates: atlas.data.Position[][] };
          source?.add(new atlas.data.Feature(new atlas.data.Polygon(polygon.coordinates), { kind: "geofence", name: fence.name }));
        } catch { /* invalid authoring data is reported by the authoring surface */ }
      });
      const layer = new atlas.layer.PolygonLayer(source, "event-geofences", { fillColor: MAP_BRAND, fillOpacity: 0.18 });
      const outline = new atlas.layer.LineLayer(source, "event-geofence-outlines", { strokeColor: MAP_BRAND, strokeWidth: 2 });
      map.layers.add([layer, outline]);
      resourceLayersRef.current.push(layer, outline);
    }
    if (showLocations) {
      locations.forEach((location) => source?.add(new atlas.data.Feature(new atlas.data.Point([location.longitude, location.latitude]), { kind: "location", name: location.name, category: location.category, active: location.is_active })));
      const activePoints = new atlas.layer.BubbleLayer(source, "event-active-location-points", {
        color: MAP_BRAND, radius: 10, strokeColor: "#ffffff", strokeWidth: 3,
        filter: ["all", ["==", ["get", "kind"], "location"], ["==", ["get", "active"], true]],
      });
      const inactivePoints = new atlas.layer.BubbleLayer(source, "event-inactive-location-points", {
        color: MAP_INACTIVE, radius: 9, strokeColor: "#ffffff", strokeWidth: 3,
        filter: ["all", ["==", ["get", "kind"], "location"], ["==", ["get", "active"], false]],
      });
      const labels = new atlas.layer.SymbolLayer(source, "event-location-labels", {
        iconOptions: { image: "none", allowOverlap: true },
        textOptions: { textField: ["get", "name"], offset: [0, 1.5], color: MAP_LABEL_INK, haloColor: "#fff", haloWidth: 2, allowOverlap: true },
        filter: ["==", ["get", "kind"], "location"],
      });
      map.layers.add([activePoints, inactivePoints, labels]);
      resourceLayersRef.current.push(activePoints, inactivePoints, labels);
    }
    return () => {
      removeMapLayersIfPresent(map, resourceLayersRef.current);
      resourceLayersRef.current = [];
    };
  }, [geofences, locations, ready, showGeofences, showLocations]);

  // Atlas hardcodes `background:#fff` on its popup and its fillColor option
  // takes a literal rather than a CSS variable, so the console theme has to be
  // pushed in explicitly. Reading --surface-bg keeps styles.css the single
  // source of truth instead of duplicating the token value here. Guarded on
  // `ready`, which flips only after the async map load - well after
  // ThemeProvider has set data-theme on the document root.
  useEffect(() => {
    if (!ready) return;
    // ThemeProvider writes data-theme onto the document root from its own
    // effect, and React flushes child effects before parent ones - so reading
    // the token synchronously here would see the previous theme on a toggle.
    // One frame later the attribute is committed and the read is correct.
    const frame = requestAnimationFrame(() => {
      const fill = getComputedStyle(document.documentElement).getPropertyValue("--surface-bg").trim();
      popupRef.current?.setOptions({ fillColor: fill || "#fff" });
    });
    return () => cancelAnimationFrame(frame);
  }, [theme, ready]);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    if (appliedStyleRef.current === mapStyle) return;
    const map = mapRef.current;
    map.events.addOnce("load", () => setLoaded(true));
    map.setStyle({ style: mapStyle });
    appliedStyleRef.current = mapStyle;
    setLoaded(false);
  }, [mapStyle, ready]);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    mapRef.current.setTraffic({ flow: traffic ? "relative" : "none", incidents: traffic });
  }, [traffic, ready]);

  useEffect(() => {
    const map = mapRef.current;
    const popup = popupRef.current;
    if (!map || !ready) return;
    map.markers.clear();
    vehicles.forEach((vehicle) => {
      const heading = vehicle.heading ?? 0;
      const marker = new atlas.HtmlMarker({
        position: [vehicle.longitude, vehicle.latitude],
        htmlContent: `<div class="event-map-bus" style="--bus-heading:${heading}deg" role="img" aria-label="Bus ${vehicle.vehicle_id}"><span>▰</span></div>`,
      });
      map.markers.add(marker);
      const showPopup = () => {
        popup?.setOptions({
          position: [vehicle.longitude, vehicle.latitude],
          content: `<div class="event-map-popup"><strong>${escapeHtml(routeVehicleLabel(vehicle))}</strong><span>${escapeHtml(displayOperator(vehicle.operator_name))}</span><span>${cardinalHeading(vehicle.heading, vehicle.direction)} · ${vehicle.speed_mph === null ? "Speed unavailable" : `${vehicle.speed_mph.toFixed(1)} mph`}</span><span>Last report ${minutesAgo(vehicle.report_timestamp)}</span></div>`,
        });
        popup?.open(map);
      };
      map.events.add("mouseover", marker, showPopup);
      map.events.add("click", marker, () => {
        onSelectVehicle?.(vehicle.vehicle_id);
        showPopup();
      });
      map.events.add("mouseout", marker, () => popup?.close());
    });
    // Fit once when the first valid classified set arrives. Subsequent
    // 30-second refreshes update markers without overriding the operator's
    // current pan/zoom or flashing out to world view.
    if (vehicles.length > 0 && !fittedRef.current) {
      const positions = vehicles.map((vehicle) => [vehicle.longitude, vehicle.latitude] as atlas.data.Position);
      map.setCamera({ bounds: atlas.data.BoundingBox.fromPositions(positions), padding: 70, maxZoom: 14 });
      fittedRef.current = true;
    }
  }, [onSelectVehicle, vehicles, ready]);

  useEffect(() => {
    if (!ready || selectedVehicleId === null || selectedVehicleId === undefined) return;
    const vehicle = vehicles.find((row) => row.vehicle_id === selectedVehicleId);
    if (!vehicle || !mapRef.current) return;
    mapRef.current.setCamera({ center: [vehicle.longitude, vehicle.latitude], zoom: Math.max(mapRef.current.getCamera().zoom ?? 10, 13) });
  }, [selectedVehicleId, vehicles, ready]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => mapRef.current?.resize());
    if (!expanded) return () => cancelAnimationFrame(frame);
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", close);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("keydown", close); };
  }, [expanded]);

  return <div className={`evmon-real-map${expanded ? " is-expanded" : ""}`}>
    <div ref={containerRef} className="evmon-map-container" />
    <div className="evmon-map-controls" aria-label="Map layers and display">
      <select aria-label="Map style" value={mapStyle} onChange={(event) => onMapStyleChange?.(event.target.value as MapStyle)} disabled={!onMapStyleChange}><option value="road">Road</option><option value="grayscale_light">Light</option><option value="night">Night</option><option value="satellite_road_labels">Satellite</option></select>
      <label><input type="checkbox" checked={traffic} onChange={(event) => onTrafficChange?.(event.target.checked)} disabled={!onTrafficChange} /> Traffic</label>
      <label><input type="checkbox" checked={showGeofences} onChange={(event) => onShowGeofencesChange?.(event.target.checked)} disabled={!onShowGeofencesChange || geofences.length === 0} /> Monitoring Areas ({geofences.length})</label>
      <label><input type="checkbox" checked={showLocations} onChange={(event) => onShowLocationsChange?.(event.target.checked)} disabled={!onShowLocationsChange || locations.length === 0} /> Locations ({locations.length})</label>
    </div>
    <button type="button" className="evmon-open-map" aria-label={expanded ? "Close larger map" : "Open larger map"} aria-pressed={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "Close larger map ×" : "Open larger map ↗"}</button>
    {error && <div className="evmon-map-message">{error}</div>}
    {!error && !loaded && <div className="evmon-map-message">Loading live map…</div>}
  </div>;
}
