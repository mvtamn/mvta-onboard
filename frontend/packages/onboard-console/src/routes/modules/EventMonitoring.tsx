import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as atlas from "azure-maps-control";
import "azure-maps-control/dist/atlas.min.css";
import { ApiError, type EventVehiclePosition, type EventGeofenceCrossing, type EventGeofenceNotification, type EventAuditEntry } from "@mvta/shared";
import { api } from "../../config.js";
import "./eventMonitoring.css";

const AVL_REFRESH_MS = 30_000;
const MAP_CENTER: atlas.data.Position = [-93.25, 44.83];
const MAP_ZOOM = 10;
type MapStyle = "road" | "grayscale_light" | "night" | "satellite_road_labels";

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

function routeLabel(vehicle: EventVehiclePosition): string {
  if (vehicle.route === null) return "Unassigned";
  return vehicle.route_label ? `${vehicle.route} · ${vehicle.route_label}` : String(vehicle.route);
}

export function EventMonitoring() {
  const [vehicles, setVehicles] = useState<EventVehiclePosition[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [routeFilter, setRouteFilter] = useState("all");
  const [headingFilter, setHeadingFilter] = useState("all");
  const [motionFilter, setMotionFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [mapStyle, setMapStyle] = useState<MapStyle>("road");
  const [traffic, setTraffic] = useState(false);
  const [crossings, setCrossings] = useState<EventGeofenceCrossing[]>([]);
  const [notifications, setNotifications] = useState<EventGeofenceNotification[]>([]);
  const [audit, setAudit] = useState<EventAuditEntry[]>([]);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const { vehicles: current, diagnostics } = await api.getEventVehiclePositions();
      setVehicles(current);
      setLastUpdated(new Date());
      setMessage(
        diagnostics.table_ready
          ? current.length === 0 ? "No active vehicles match the current SpecialEvent route classifications." : null
          : "Event vehicle monitoring has not been configured yet.",
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

  useEffect(() => {
    Promise.all([api.getEventGeofenceCrossings(), api.getEventGeofenceNotifications(), api.getEventAuditStream()])
      .then(([c, n, a]) => { setCrossings(c.crossings); setNotifications(n.notifications); setAudit(a.entries); })
      .catch(() => undefined);
  }, [lastUpdated]);

  async function reviewNotification(id: string, action: "send" | "dismiss") {
    if (action === "send") await api.sendEventGeofenceNotification(id);
    else await api.dismissEventGeofenceNotification(id);
    setNotifications((rows) => rows.filter((row) => row.id !== id));
  }

  const classifiedVehicles = vehicles ?? [];
  const routeOptions = useMemo(() => Array.from(new Map(classifiedVehicles
    .filter((vehicle) => vehicle.route !== null)
    .map((vehicle) => [String(vehicle.route), routeLabel(vehicle)])).entries()), [classifiedVehicles]);
  const activeVehicles = useMemo(() => classifiedVehicles.filter((vehicle) => {
    const heading = cardinalHeading(vehicle.heading, vehicle.direction);
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || String(vehicle.vehicle_id).includes(query)
      || displayOperator(vehicle.operator_name).toLowerCase().includes(query)
      || routeLabel(vehicle).toLowerCase().includes(query);
    const matchesMotion = motionFilter === "all"
      || (motionFilter === "moving"
        ? vehicle.speed_mph !== null && vehicle.speed_mph >= 1
        : vehicle.speed_mph !== null && vehicle.speed_mph < 1);
    return (routeFilter === "all" || String(vehicle.route) === routeFilter)
      && (headingFilter === "all" || heading === headingFilter)
      && matchesMotion && matchesSearch;
  }), [classifiedVehicles, headingFilter, motionFilter, routeFilter, search]);
  const routesActive = new Set(classifiedVehicles.map((v) => v.route).filter((v) => v !== null)).size;
  const reportingNow = classifiedVehicles.filter((v) => Date.now() - new Date(v.report_timestamp).getTime() < 60_000).length;
  const hasFilters = routeFilter !== "all" || headingFilter !== "all" || motionFilter !== "all" || search !== "";

  return (
    <section className="evmon" aria-label="Live vehicle monitoring">
      <div className="evmon-summary">
        <div>
          <span className="evmon-eyebrow"><span className="evmon-live-dot" /> Live operations</span>
          <h2>Live vehicle positions</h2>
        <p>Vehicles remain visible as stale briefly when reports stop.</p>
        </div>
        <div className="evmon-metrics" aria-label="Live monitoring summary">
          <div><strong>{classifiedVehicles.length}</strong><span>Vehicles</span></div>
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
        {!minimized && <div className="evmon-controls">
          <label><span>Find</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Vehicle or operator" /></label>
          <label><span>Route</span><select value={routeFilter} onChange={(event) => setRouteFilter(event.target.value)}><option value="all">All event routes</option>{routeOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          <label><span>Heading</span><select value={headingFilter} onChange={(event) => setHeadingFilter(event.target.value)}><option value="all">All headings</option>{["NB", "SB", "EB", "WB"].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span>Motion</span><select value={motionFilter} onChange={(event) => setMotionFilter(event.target.value)}><option value="all">Moving + stopped</option><option value="moving">Moving</option><option value="stopped">Stopped</option></select></label>
          <label><span>Map layer</span><select value={mapStyle} onChange={(event) => setMapStyle(event.target.value as MapStyle)}><option value="road">Road</option><option value="grayscale_light">Light</option><option value="night">Night</option><option value="satellite_road_labels">Satellite + labels</option></select></label>
          <label className="evmon-traffic"><input type="checkbox" checked={traffic} onChange={(event) => setTraffic(event.target.checked)} /><span>Traffic</span></label>
          {hasFilters && <button type="button" className="evmon-clear" onClick={() => { setSearch(""); setRouteFilter("all"); setHeadingFilter("all"); setMotionFilter("all"); }}>Clear filters</button>}
        </div>}
        {!minimized && (
          <div className="evmon-map-wrap">
            <VehicleMap vehicles={activeVehicles} mapStyle={mapStyle} traffic={traffic} />
          </div>
        )}
      </div>

      <div className="evmon-list-header">
        <div><h3>Monitored vehicles</h3><span>Fresh and recently stale classified vehicles from shared AVL</span></div>
        <span className="evmon-count">{activeVehicles.length}{hasFilters ? ` of ${classifiedVehicles.length}` : ""} active</span>
      </div>
      <div className="evmon-table-wrap">
        {message ? <div className="evmon-empty">{message}</div> : vehicles === null ? <div className="evmon-empty">Loading live positions…</div> : (
          <table className="data evmon-table">
            <thead><tr><th>Vehicle</th><th>Operator</th><th>Route</th><th>Block / Run</th><th>Heading</th><th>Speed</th><th>Last report</th></tr></thead>
            <tbody>{activeVehicles.map((vehicle) => (
              <tr key={vehicle.vehicle_id}>
                <td><span className="evmon-bus-chip">▣</span><strong>{vehicle.vehicle_id}</strong></td>
                <td>{displayOperator(vehicle.operator_name)}</td>
                <td>{routeLabel(vehicle)}</td>
                <td>{vehicle.block ?? "—"} / {vehicle.run ?? "—"}</td>
                <td><span className="evmon-heading">{cardinalHeading(vehicle.heading, vehicle.direction)}</span></td>
                <td>{vehicle.speed_mph === null ? "—" : `${vehicle.speed_mph.toFixed(1)} mph`}</td>
                <td className={vehicle.is_stale ? "evmon-stale" : undefined}>{vehicle.is_stale ? "Stale · " : ""}{minutesAgo(vehicle.report_timestamp)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <div className="evmon-list-header"><div><h3>Geofence crossings</h3><span>Recent movement across active event boundaries</span></div></div>
      <div className="evmon-table-wrap">
        {notifications.map((notification) => <div key={notification.id} className="panel-body"><strong>Review notification</strong><p>{notification.message_body}</p><button className="btn-sm" onClick={() => void reviewNotification(notification.id, "send")}>Approve and send</button>{" "}<button className="btn-sm" onClick={() => void reviewNotification(notification.id, "dismiss")}>Dismiss</button></div>)}
        <table className="data evmon-table"><thead><tr><th>Time</th><th>Vehicle</th><th>Geofence</th><th>Transition</th><th>Destination</th></tr></thead><tbody>{crossings.map((crossing) => <tr key={crossing.id}><td>{new Date(crossing.crossed_at).toLocaleString()}</td><td>{crossing.vehicle_id}</td><td>{crossing.geofence_name}</td><td>{crossing.transition}</td><td>{crossing.destination_label ?? "—"}</td></tr>)}</tbody></table>
      </div>
      <div className="evmon-list-header"><div><h3>Event audit history</h3><span>Route changes, crossings, and notification actions</span></div></div>
      <div className="evmon-table-wrap"><table className="data evmon-table"><thead><tr><th>Time</th><th>Type</th><th>Entity</th><th>Detail</th><th>Actor</th></tr></thead><tbody>{audit.map((entry, index) => <tr key={`${entry.event_at}-${index}`}><td>{new Date(entry.event_at).toLocaleString()}</td><td>{entry.event_type}</td><td>{entry.entity_id}</td><td>{entry.detail}</td><td>{entry.actor ?? "system"}</td></tr>)}</tbody></table></div>
    </section>
  );
}

function VehicleMap({ vehicles, mapStyle, traffic }: { vehicles: EventVehiclePosition[]; mapStyle: MapStyle; traffic: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<atlas.Map | null>(null);
  const popupRef = useRef<atlas.Popup | null>(null);
  const fittedRef = useRef(false);
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
    }).catch((err) => setError(err instanceof ApiError ? `Could not load the map: ${err.message}` : "Could not reach the map service."));
    return () => { cancelled = true; popupRef.current = null; map?.dispose(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    mapRef.current.setStyle({ style: mapStyle });
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
          content: `<div class="event-map-popup"><strong>${escapeHtml(displayOperator(vehicle.operator_name))}</strong><span>Vehicle ${vehicle.vehicle_id} · Route ${escapeHtml(routeLabel(vehicle))}</span><span>${cardinalHeading(vehicle.heading, vehicle.direction)} · ${vehicle.speed_mph === null ? "Speed unavailable" : `${vehicle.speed_mph.toFixed(1)} mph`}</span><span>Last report ${minutesAgo(vehicle.report_timestamp)}</span></div>`,
        });
        popup?.open(map);
      };
      map.events.add("mouseover", marker, showPopup);
      map.events.add("click", marker, () => {
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
  }, [vehicles, ready]);

  function openLargerMap() {
    const camera = mapRef.current?.getCamera();
    const center = camera?.center ?? MAP_CENTER;
    window.open(`https://www.bing.com/maps?cp=${center[1]}~${center[0]}&lvl=${Math.round(camera?.zoom ?? MAP_ZOOM)}`, "_blank", "noopener,noreferrer");
  }

  return <div className="evmon-real-map">
    <div ref={containerRef} className="evmon-map-container" />
    <button type="button" className="evmon-open-map" onClick={openLargerMap}>Open larger map ↗</button>
    {error && <div className="evmon-map-message">{error}</div>}
    {!error && !ready && <div className="evmon-map-message">Loading live map…</div>}
  </div>;
}
