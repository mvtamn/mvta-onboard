import { useEffect, useMemo, useRef, useState } from "react";
import * as atlas from "azure-maps-control";
import "azure-maps-control/dist/atlas.min.css";
import { ApiError, type AvailAvlVehicle, type EventVehiclePosition, type GtfsRouteOption } from "@mvta/shared";
import { api } from "../../config.js";
import "./eventMonitoring.css";

const AVL_REFRESH_MS = 60_000;
const MAP_CENTER: atlas.data.Position = [-93.25, 44.83]; // MVTA's south-metro service area + downtown Minneapolis
const MAP_ZOOM = 10;

function timeAgoLabel(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)} min ago`;
}

function routeLabel(routeId: number | null, routesById: Map<string, GtfsRouteOption>): string {
  if (routeId === null) return "Unclassified route";
  const r = routesById.get(String(routeId));
  const name = r?.route_short_name || r?.route_long_name;
  return name ? `Route ${routeId} · ${name}` : `Route ${routeId}`;
}

// Event Vehicle Monitoring — the mock event-shuttle scenario (POOL/monitored/
// swap/delay-alert workflow, ported from event_monitoring_mockup.html) is
// retired per event-module-implementation-plan.md's redrafted user story
// (Part A0): that scenario modeled a Phase 2+ alerts/publishing workflow
// (Claude delay inference, staff review-and-approve) explicitly out of
// scope for this pass. This module is now visibility/reference only - two
// real Avail AVL Reports panels: every vehicle (table), and just the
// RouteClassification-classified 'SpecialEvent' vehicles (real map, Part
// A3) - nothing here auto-publishes.
export function EventMonitoring() {
  const [routesList, setRoutesList] = useState<GtfsRouteOption[]>([]);
  useEffect(() => {
    let alive = true;
    api
      .getRoutes()
      .then((d) => alive && setRoutesList(d.routes))
      .catch(() => alive && setRoutesList([]));
    return () => {
      alive = false;
    };
  }, []);
  const routesById = useMemo(() => new Map(routesList.map((r) => [r.route_id, r])), [routesList]);

  // Live vehicle positions from Avail's own AVL Reports API - every vehicle,
  // unfiltered.
  const [availVehicles, setAvailVehicles] = useState<AvailAvlVehicle[] | null>(null);
  const [availMessage, setAvailMessage] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    function load() {
      api
        .getAvailAvlVehicles()
        .then(({ vehicles, diagnostics }) => {
          if (!alive) return;
          setAvailVehicles(vehicles);
          setAvailMessage(
            diagnostics.configured
              ? vehicles.length === 0
                ? "Feed configured but no vehicles have reported yet."
                : null
              : "Avail AVL Reports feed is not configured yet.",
          );
        })
        .catch((err) => {
          if (!alive) return;
          setAvailVehicles(null);
          setAvailMessage(
            err instanceof ApiError
              ? `Could not load live vehicle positions: ${err.message}`
              : "Could not reach the live vehicle-position service.",
          );
        });
    }
    load();
    const intervalId = window.setInterval(load, AVL_REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(intervalId);
    };
  }, []);

  // Event bus positions - the same AVL feed as above, filtered server-side
  // (availAvlPoll.ts) to routes classified SpecialEvent in
  // RouteClassification (Admin page). eventFatalMessage covers "not set up
  // yet" and fetch errors - genuinely nothing to show. An empty
  // vehicles array once the table IS ready is NOT fatal - the map still
  // renders (with zero markers), matching the plan's own framing that this
  // is the expected state before any SpecialEvent route is classified, not
  // a bug to hide behind a text message.
  const [eventVehicles, setEventVehicles] = useState<EventVehiclePosition[] | null>(null);
  const [eventFatalMessage, setEventFatalMessage] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    function load() {
      api
        .getEventVehiclePositions()
        .then(({ vehicles, diagnostics }) => {
          if (!alive) return;
          setEventVehicles(vehicles);
          setEventFatalMessage(
            !diagnostics.table_ready
              ? "Event-bus tracking has not been set up yet (migration-016 pending)."
              : null,
          );
        })
        .catch((err) => {
          if (!alive) return;
          setEventVehicles(null);
          setEventFatalMessage(
            err instanceof ApiError
              ? `Could not load event bus positions: ${err.message}`
              : "Could not reach the event-vehicle-position service.",
          );
        });
    }
    load();
    const intervalId = window.setInterval(load, AVL_REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(intervalId);
    };
  }, []);

  return (
    <div className="evmon">
      <div className="panel-header">
        <span>Live AVL vehicle positions</span>
        <span className="td-dim">Avail360 · refreshes every 60s</span>
      </div>
      <div className="panel-body" style={{ padding: 0, marginBottom: 20 }}>
        {availMessage ? (
          <p className="panel-desc" style={{ padding: "12px 16px", margin: 0 }}>{availMessage}</p>
        ) : availVehicles === null ? (
          <p className="panel-desc" style={{ padding: "12px 16px", margin: 0 }}>Loading…</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Vehicle</th>
                <th>Route</th>
                <th>Block</th>
                <th>Run</th>
                <th>Direction</th>
                <th>Heading</th>
                <th>Last report</th>
              </tr>
            </thead>
            <tbody>
              {availVehicles.map((v) => (
                <tr key={v.vehicle_id}>
                  <td className="veh-id">{v.vehicle_id}</td>
                  <td>{v.route ?? "—"}</td>
                  <td>{v.block ?? "—"}</td>
                  <td>{v.run ?? "—"}</td>
                  <td>{v.direction ?? "—"}</td>
                  <td>{v.heading !== null ? `${v.heading}°` : "—"}</td>
                  <td className="td-dim">{timeAgoLabel(v.report_timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel-header">
        <span>Event bus positions (live)</span>
        <span className="td-dim">Filtered by Route Classification · refreshes every 60s</span>
      </div>
      {eventFatalMessage ? (
        <p className="panel-desc" style={{ padding: "12px 4px" }}>{eventFatalMessage}</p>
      ) : eventVehicles === null ? (
        <p className="panel-desc" style={{ padding: "12px 4px" }}>Loading…</p>
      ) : (
        <div className="evmon-event-layout">
          <EventVehicleMap vehicles={eventVehicles} routesById={routesById} />
          <div className="panel-body" style={{ padding: 0 }}>
            {eventVehicles.length === 0 ? (
              <p className="panel-desc" style={{ padding: "12px 16px", margin: 0 }}>
                No event buses classified yet - add a SpecialEvent route in Admin &gt; Route Classification.
              </p>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>Vehicle</th>
                    <th>Route</th>
                    <th>Heading</th>
                    <th>Last report</th>
                  </tr>
                </thead>
                <tbody>
                  {eventVehicles.map((v) => (
                    <tr key={v.vehicle_id}>
                      <td className="veh-id">{v.vehicle_id}</td>
                      <td>{routeLabel(v.route, routesById)}</td>
                      <td>{v.heading !== null ? `${v.heading}°` : "—"}</td>
                      <td className="td-dim">{timeAgoLabel(v.report_timestamp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Real Azure Maps basemap (event-module-implementation-plan.md, Part A3),
// replacing the retired static Lot A/Fairgrounds schematic. Zero-standing-
// secret: authenticates via 'anonymous' mode, calling GET /maps/token for
// both the account's public clientId (needed once, synchronously, at map
// construction) and each short-lived bearer token the SDK requests
// thereafter - no Maps subscription key is ever present in this bundle.
function EventVehicleMap({
  vehicles,
  routesById,
}: {
  vehicles: EventVehiclePosition[];
  routesById: Map<string, GtfsRouteOption>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<atlas.Map | null>(null);
  const popupRef = useRef<atlas.Popup | null>(null);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    let map: atlas.Map | null = null;

    api
      .getMapsToken()
      .then((initial) => {
        if (cancelled || !containerRef.current) return;
        map = new atlas.Map(containerRef.current, {
          center: MAP_CENTER,
          zoom: MAP_ZOOM,
          style: "road",
          authOptions: {
            authType: atlas.AuthenticationType.anonymous,
            clientId: initial.client_id,
            getToken: (resolve, reject) => {
              api
                .getMapsToken()
                .then((d) => resolve(d.access_token))
                .catch(reject);
            },
          },
        });
        mapRef.current = map;
        popupRef.current = new atlas.Popup({ pixelOffset: [0, -30] });
        map.events.addOnce("ready", () => {
          if (!cancelled) setReady(true);
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setMapError(
          err instanceof ApiError
            ? `Could not load the map: ${err.message}`
            : "Could not reach the map service.",
        );
      });

    return () => {
      cancelled = true;
      popupRef.current = null;
      map?.dispose();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const popup = popupRef.current;
    if (!map || !ready) return;
    map.markers.clear();
    vehicles.forEach((v) => {
      const marker = new atlas.HtmlMarker({
        position: [v.longitude, v.latitude],
        color: "#01543d",
        htmlContent: '<div class="event-map-marker" role="img"></div>',
      });
      map.markers.add(marker);
      map.events.add("click", marker, () => {
        if (!popup) return;
        popup.setOptions({
          position: [v.longitude, v.latitude],
          content: `<div class="event-map-popup"><strong>Vehicle ${v.vehicle_id}</strong><br/>${routeLabel(v.route, routesById)}<br/>${timeAgoLabel(v.report_timestamp)}</div>`,
        });
        popup.open(map);
      });
    });
  }, [vehicles, routesById, ready]);

  return (
    <div className="map-card evmon-real-map">
      <div ref={containerRef} className="evmon-map-container" />
      {mapError ? <div className="evmon-map-overlay-message">{mapError}</div> : null}
      {!mapError && !ready ? <div className="evmon-map-overlay-message">Loading map…</div> : null}
    </div>
  );
}
