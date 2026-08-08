import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as atlas from "azure-maps-control";
import "azure-maps-control/dist/atlas.min.css";
import { ApiError, type AvailAvlVehicle, type GtfsRouteOption } from "@mvta/shared";
import { api } from "../../config.js";
import "./eventMonitoring.css";

const AVL_REFRESH_MS = 30_000;
const MAP_CENTER: atlas.data.Position = [-93.25, 44.83];
const MAP_ZOOM = 10;

function minutesAgo(value: string | null): string {
  if (!value) return "—";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "—";
  return `${Math.max(0, Math.floor((Date.now() - time) / 60_000))} min ago`;
}

function cardinalHeading(heading: number | null, direction: string | null): string {
  if (heading !== null) {
    const normalized = ((heading % 360) + 360) % 360;
    if (normalized >= 315 || normalized < 45) return "NB";
    if (normalized < 135) return "EB";
    if (normalized < 225) return "SB";
    return "WB";
  }
  const raw = direction?.trim().toUpperCase();
  if (raw === "N" || raw === "NB") return "NB";
  if (raw === "S" || raw === "SB") return "SB";
  if (raw === "E" || raw === "EB" || raw === "O") return "EB";
  if (raw === "W" || raw === "WB" || raw === "I") return "WB";
  return "—";
}

function displayOperator(value: string | null): string {
  if (!value) return "Operator unavailable";
  const withoutId = value.replace(/\s+-\d+\s*$/, "").trim();
  const [last, first] = withoutId.split(",").map((part) => part.trim());
  return first ? `${first} ${last}` : withoutId;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[char] ?? char);
}

function routeLabel(vehicle: AvailAvlVehicle, routes: Map<string, GtfsRouteOption>): string {
  if (vehicle.route === null) return "Unassigned";
  const route = routes.get(String(vehicle.route));
  const name = route?.route_short_name || route?.route_long_name;
  return name && name !== String(vehicle.route) ? `${vehicle.route} · ${name}` : String(vehicle.route);
}

export function EventMonitoring() {
  const [routes, setRoutes] = useState<GtfsRouteOption[]>([]);
  const [vehicles, setVehicles] = useState<AvailAvlVehicle[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const routesById = useMemo(() => new Map(routes.map((route) => [route.route_id, route])), [routes]);

  useEffect(() => {
    let alive = true;
    api.getRoutes().then((data) => alive && setRoutes(data.routes)).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const { vehicles: current, diagnostics } = await api.getAvailAvlVehicles();
      setVehicles(current);
      setLastUpdated(new Date());
      setMessage(
        diagnostics.configured
          ? current.length === 0 ? "No vehicles are actively reporting right now." : null
          : "Avail AVL Reports feed is not configured yet.",
      );
    } catch (error) {
      setMessage(error instanceof ApiError
        ? `Could not load live vehicle positions: ${error.message}`
        : "Could not reach the live vehicle-position service.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), AVL_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [load]);

  const activeVehicles = vehicles ?? [];
  const routesActive = new Set(activeVehicles.map((v) => v.route).filter((v) => v !== null)).size;
  const reportingNow = activeVehicles.filter((v) => Date.now() - new Date(v.report_timestamp).getTime() < 60_000).length;

  return (
    <section className="evmon" aria-label="Live vehicle monitoring">
      <div className="evmon-summary">
        <div>
          <span className="evmon-eyebrow"><span className="evmon-live-dot" /> Live operations</span>
          <h2>Live vehicle positions</h2>
          <p>Active vehicles are removed automatically when reports stop.</p>
        </div>
        <div className="evmon-metrics" aria-label="Live monitoring summary">
          <div><strong>{activeVehicles.length}</strong><span>Vehicles</span></div>
          <div><strong>{routesActive}</strong><span>Routes</span></div>
          <div><strong>{reportingNow}</strong><span>Reporting now</span></div>
        </div>
      </div>

      <div className={`evmon-workspace${minimized ? " is-minimized" : ""}`}>
        <div className="evmon-toolbar">
          <div>
            <strong>Live map</strong>
            <span>{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}` : "Connecting…"} · every 30 sec</span>
          </div>
          <div className="evmon-toolbar-actions">
            <button type="button" onClick={() => void load()} disabled={refreshing}>{refreshing ? "Refreshing…" : "Refresh now"}</button>
            <button type="button" onClick={() => setMinimized((value) => !value)} aria-expanded={!minimized}>
              {minimized ? "Restore map" : "Minimize map"}
            </button>
          </div>
        </div>
        {!minimized && (
          <div className="evmon-map-wrap">
            <VehicleMap vehicles={activeVehicles} routesById={routesById} />
            <div className="evmon-map-hint">Select the map to open a larger view</div>
          </div>
        )}
      </div>

      <div className="evmon-list-header">
        <div><h3>Monitored vehicles</h3><span>Only actively reporting vehicles are shown</span></div>
        <span className="evmon-count">{activeVehicles.length} active</span>
      </div>
      <div className="evmon-table-wrap">
        {message ? <div className="evmon-empty">{message}</div> : vehicles === null ? <div className="evmon-empty">Loading live positions…</div> : (
          <table className="data evmon-table">
            <thead><tr><th>Vehicle</th><th>Operator</th><th>Route</th><th>Block / Run</th><th>Heading</th><th>Speed</th><th>Last report</th></tr></thead>
            <tbody>{activeVehicles.map((vehicle) => (
              <tr key={vehicle.vehicle_id}>
                <td><span className="evmon-bus-chip">▣</span><strong>{vehicle.vehicle_id}</strong></td>
                <td>{displayOperator(vehicle.operator_name)}</td>
                <td>{routeLabel(vehicle, routesById)}</td>
                <td>{vehicle.block ?? "—"} / {vehicle.run ?? "—"}</td>
                <td><span className="evmon-heading">{cardinalHeading(vehicle.heading, vehicle.direction)}</span></td>
                <td>{vehicle.speed_mph === null ? "—" : `${vehicle.speed_mph.toFixed(1)} mph`}</td>
                <td>{minutesAgo(vehicle.report_timestamp)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function VehicleMap({ vehicles, routesById }: { vehicles: AvailAvlVehicle[]; routesById: Map<string, GtfsRouteOption> }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<atlas.Map | null>(null);
  const popupRef = useRef<atlas.Popup | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      popupRef.current = new atlas.Popup({ pixelOffset: [0, -24], closeButton: false });
      map.events.addOnce("ready", () => !cancelled && setReady(true));
      map.events.add("click", () => {
        if (!window.confirm("Open this live map in a new browser window?")) return;
        const camera = map?.getCamera();
        const center = camera?.center ?? MAP_CENTER;
        window.open(`https://www.bing.com/maps?cp=${center[1]}~${center[0]}&lvl=${Math.round(camera?.zoom ?? MAP_ZOOM)}`, "_blank", "noopener,noreferrer");
      });
    }).catch((err) => setError(err instanceof ApiError ? `Could not load the map: ${err.message}` : "Could not reach the map service."));
    return () => { cancelled = true; popupRef.current = null; map?.dispose(); mapRef.current = null; };
  }, []);

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
      map.events.add("mouseover", marker, () => {
        popup?.setOptions({
          position: [vehicle.longitude, vehicle.latitude],
          content: `<div class="event-map-popup"><strong>${escapeHtml(displayOperator(vehicle.operator_name))}</strong><span>Vehicle ${vehicle.vehicle_id} · Route ${escapeHtml(routeLabel(vehicle, routesById))}</span><span>${cardinalHeading(vehicle.heading, vehicle.direction)} · ${vehicle.speed_mph === null ? "Speed unavailable" : `${vehicle.speed_mph.toFixed(1)} mph`}</span><span>Last report ${minutesAgo(vehicle.report_timestamp)}</span></div>`,
        });
        popup?.open(map);
      });
      map.events.add("mouseout", marker, () => popup?.close());
    });
    if (vehicles.length > 0) {
      const positions = vehicles.map((vehicle) => [vehicle.longitude, vehicle.latitude] as atlas.data.Position);
      map.setCamera({ bounds: atlas.data.BoundingBox.fromPositions(positions), padding: 70, maxZoom: 14 });
    }
  }, [vehicles, routesById, ready]);

  return <div className="evmon-real-map"><div ref={containerRef} className="evmon-map-container" />{error && <div className="evmon-map-message">{error}</div>}{!error && !ready && <div className="evmon-map-message">Loading live map…</div>}</div>;
}
