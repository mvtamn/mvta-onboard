import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import * as atlas from "azure-maps-control";
import "azure-maps-control/dist/atlas.min.css";
import { ApiError, type Event, type EventGeofence, type EventLocation, type EventServicePlan, type EventVehicleAssignment, type EventVehiclePosition, type EventGeofenceCrossing, type EventGeofenceNotification, type EventAuditEntry, type EventMonitoringHealth } from "@mvta/shared";
import { api } from "../../config.js";
import { useEventWorkspace } from "../../context/EventWorkspaceContext.js";
import { EventWorkspaceNav } from "../../components/EventWorkspaceNav.js";
import { useAuth } from "../../auth/AuthContext.js";
import "./eventMonitoring.css";
import { activePlansMissingPublishedScope, defaultMonitoringEventId } from "./eventMonitoringState.js";
import { removeMapLayersIfPresent } from "./mapLayerCleanup.js";

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

function healthLabel(status: string | undefined): string {
  return status ? status[0].toUpperCase() + status.slice(1) : "Unavailable";
}

export function EventMonitoring() {
  const { roles } = useAuth();
  const canManageAssignments = roles.includes("OCC.Admin");
  const [vehicles, setVehicles] = useState<EventVehiclePosition[] | null>(null);
  const [unassignedVehicles, setUnassignedVehicles] = useState<EventVehiclePosition[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [plans, setPlans] = useState<EventServicePlan[]>([]);
  const [resourceGeofences, setResourceGeofences] = useState<EventGeofence[]>([]);
  const [resourceLocations, setResourceLocations] = useState<EventLocation[]>([]);
  const { selection, selectEvent, selectServicePlan, selectRevision } = useEventWorkspace();
  const { eventId: selectedEventId, servicePlanId: selectedPlanId } = selection;
  const [showUnassigned, setShowUnassigned] = useState(true);
  const [showGeofences, setShowGeofences] = useState(true);
  const [showLocations, setShowLocations] = useState(true);
  const [showInactiveGeofences, setShowInactiveGeofences] = useState(true);
  const [showInactiveLocations, setShowInactiveLocations] = useState(true);
  const [assignments, setAssignments] = useState<EventVehicleAssignment[]>([]);
  const [assignmentMessage, setAssignmentMessage] = useState<string | null>(null);
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
  const [health, setHealth] = useState<EventMonitoringHealth | null>(null);
  const [feedStatus, setFeedStatus] = useState<Record<string, { state: "ready" | "error"; loadedAt: Date | null }>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const defaultedEventRef = useRef(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    if (!selectedEventId) {
      setVehicles([]); setUnassignedVehicles([]); setHealth(null); setLastUpdated(null); setRefreshing(false);
      return;
    }
    try {
      const { vehicles: current, unassigned_vehicles: currentUnassigned, diagnostics } = await api.getEventVehiclePositions(selectedEventId || undefined, selectedPlanId || undefined);
      setVehicles(current);
      setUnassignedVehicles(currentUnassigned ?? []);
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
    void api.getEventMonitoringHealth(selectedEventId || undefined, selectedPlanId || undefined).then(setHealth).catch(() => setHealth(null));
  }, [selectedEventId, selectedPlanId]);

  useEffect(() => {
    void Promise.all([api.getEvents(), api.getEventServicePlans()]).then(([eventRows, planRows]) => {
      setEvents(eventRows.events);
      setPlans(planRows.plans);
    }).catch(() => { setEvents([]); setPlans([]); });
  }, []);

  useEffect(() => {
    void Promise.all([api.getEventGeofences(), api.getEventLocations()]).then(([geofenceRows, locationRows]) => {
      setResourceGeofences(geofenceRows.geofences);
      setResourceLocations(locationRows.locations);
    }).catch(() => { setResourceGeofences([]); setResourceLocations([]); });
  }, []);

  useEffect(() => {
    if (defaultedEventRef.current || selectedEventId || events.length === 0) return;
    const eventId = defaultMonitoringEventId(events, plans);
    if (!eventId) return;
    defaultedEventRef.current = true;
    selectEvent(eventId);
  }, [events, plans, selectedEventId, selectEvent]);

  useEffect(() => {
    if (!selectedEventId) { setAssignments([]); return; }
    if (!canManageAssignments) { setAssignments([]); return; }
    void api.getEventVehicleAssignments(selectedEventId).then((result) => setAssignments(result.assignments)).catch(() => setAssignments([]));
  }, [canManageAssignments, selectedEventId]);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), AVL_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [load]);

  useEffect(() => {
    if (!selectedEventId) { setCrossings([]); setNotifications([]); setAudit([]); return; }
    Promise.allSettled([api.getEventGeofenceCrossings(selectedEventId, selectedPlanId), api.getEventGeofenceNotifications("pending", selectedEventId, selectedPlanId), api.getEventAuditStream(undefined, undefined, selectedEventId, selectedPlanId)])
      .then(([c, n, a]) => {
        const now = new Date();
        if (c.status === "fulfilled") { setCrossings(c.value.crossings); setFeedStatus((s) => ({ ...s, crossings: { state: "ready", loadedAt: now } })); }
        else setFeedStatus((s) => ({ ...s, crossings: { state: "error", loadedAt: s.crossings?.loadedAt ?? null } }));
        if (n.status === "fulfilled") { setNotifications(n.value.notifications); setFeedStatus((s) => ({ ...s, notifications: { state: "ready", loadedAt: now } })); }
        else setFeedStatus((s) => ({ ...s, notifications: { state: "error", loadedAt: s.notifications?.loadedAt ?? null } }));
        if (a.status === "fulfilled") { setAudit(a.value.entries); setFeedStatus((s) => ({ ...s, audit: { state: "ready", loadedAt: now } })); }
        else setFeedStatus((s) => ({ ...s, audit: { state: "error", loadedAt: s.audit?.loadedAt ?? null } }));
      });
  }, [lastUpdated, selectedEventId, selectedPlanId]);

  async function reviewNotification(id: string, action: "acknowledge" | "send" | "dismiss") {
    setActionError(null);
    try {
      if (action === "send") await api.sendEventGeofenceNotification(id);
      else if (action === "acknowledge") await api.acknowledgeEventGeofenceNotification(id);
      else await api.dismissEventGeofenceNotification(id);
      setNotifications((rows) => action === "acknowledge" ? rows.map((row) => row.id === id ? { ...row, status: "acknowledged" as const } : row) : rows.filter((row) => row.id !== id));
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : "Notification action failed; the item was retained.");
    }
  }

  async function proposeAssignment(vehicle: EventVehiclePosition) {
    const targetPlan = selectedPlan ?? selectedPlans.find((plan) => plan.status === "draft" || plan.status === "review");
    if (!selectedEventId || !targetPlan || vehicle.route === null) { setAssignmentMessage("Select an Event with a draft, review, or active operating period before proposing an assignment."); return; }
    try {
      const assignment = await api.createEventVehicleAssignment({ event_id: selectedEventId, service_plan_id: targetPlan.id, vehicle_id: vehicle.vehicle_id, route_id: vehicle.route, reason: "Proposed from Event AVL unassigned vehicle view" });
      setAssignments((rows) => [assignment, ...rows]);
      setAssignmentMessage(selectedPlan?.status === "active" ? "Assignment proposed as an active-plan revision; it is not live until the revision is approved and applied." : "Assignment proposed for the operating period.");
    } catch (error) { setAssignmentMessage(error instanceof ApiError ? error.message : "Could not propose vehicle assignment."); }
  }

  async function reviewAssignment(id: string, action: "approve" | "reject") {
    try {
      const result = await api.transitionEventVehicleAssignment(id, action);
      if (result.revision_id) selectRevision(result.revision_id);
      setAssignments((rows) => rows.map((row) => row.id === id ? { ...row, status: result.status as EventVehicleAssignment["status"], revision_id: result.revision_id ?? row.revision_id } : row));
      setAssignmentMessage(action === "approve" && result.target === "revision" ? "Assignment accepted into a new revision. Review and apply that revision before it becomes operational." : `Assignment ${action}d.`);
    } catch (error) { setAssignmentMessage(error instanceof ApiError ? error.message : "Could not update the assignment proposal."); }
  }

  const classifiedVehicles = vehicles ?? [];
  const selectedEvent = events.find((event) => event.id === selectedEventId);
  const selectedPlans = plans.filter((plan) => plan.event_id === selectedEventId);
  const activePlans = selectedPlans.filter((plan) => plan.status === "active");
  const selectedPlan = activePlans.find((plan) => plan.id === selectedPlanId);
  const scopedPlans = selectedPlan ? [selectedPlan] : activePlans;
  const plansMissingPublishedScope = activePlansMissingPublishedScope(scopedPlans);
  const publishedGeofences = scopedPlans.flatMap((plan) => plan.published_scope?.geofences ?? []);
  const publishedLocations = scopedPlans.flatMap((plan) => plan.published_scope?.locations ?? []);
  const visibleGeofences = Array.from(new Map(publishedGeofences.map((fence) => [fence.id, fence])).values());
  const visibleLocations = Array.from(new Map(publishedLocations.map((location) => [location.id, location])).values());
  const mapGeofences = resourceGeofences.filter((fence) => fence.is_active ? showGeofences : showInactiveGeofences);
  const mapLocations = resourceLocations.filter((location) => location.is_active ? showLocations : showInactiveLocations);
  const routeOptions = useMemo(() => Array.from(new Map(scopedPlans.flatMap((plan) => plan.links?.filter((link) => link.kind === "routes").map((link) => [String(link.value), link.label] as [string, string]) ?? [])).entries()), [scopedPlans]);
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
  const routesActive = new Set(scopedPlans.flatMap((plan) => plan.links?.filter((link) => link.kind === "routes").map((link) => String(link.value)) ?? [])).size;
  const routeNames = routeOptions.map(([, label]) => label);
  const routeSummary = routeNames.length > 2 ? `${routeNames.slice(0, 2).join(", ")} +${routeNames.length - 2} more` : routeNames.join(", ");
  const geofencesWithRules = visibleGeofences.filter((fence) => (fence.rules?.length ?? 0) > 0).length;
  const reportingNow = classifiedVehicles.filter((v) => Date.now() - new Date(v.report_timestamp).getTime() < 60_000).length;
  const hasFilters = routeFilter !== "all" || headingFilter !== "all" || motionFilter !== "all" || search !== "";
  const dataState = !selectedEventId
    ? { tone: "info", title: "Select an Event to begin monitoring.", action: null }
    : activePlans.length === 0
      ? { tone: "warning", title: "This Event has no active operating period.", action: "Create or activate an operating period in Event Planning." }
      : plansMissingPublishedScope.length > 0
        ? { tone: "error", title: "Published Event AVL scope is unavailable.", action: "Repair or reactivate this operating period in Event Planning before monitoring." }
      : health === null && vehicles === null
          ? { tone: "error", title: "Event AVL data is unavailable.", action: "The API health or vehicle-position feed could not be reached." }
          : vehicles === null
            ? { tone: "info", title: "Connecting to Event AVL data…", action: null }
            : { tone: "success", title: vehicles.length ? "Event AVL data is flowing." : "The feed is healthy, but no managed vehicles are reporting.", action: null };

  return (
    <section className="evmon" aria-label="Live vehicle monitoring">
      <div className="evmon-summary">
        <div>
          <span className="evmon-eyebrow"><span className="evmon-live-dot" /> Live operations</span>
          <h2>Event AVL</h2>
          <p>{selectedEvent ? `${selectedEvent.name} · ${selectedPlan?.name ?? "Select an operating period"}` : "Select an Event operating context to monitor."}</p>
        </div>
        <div className="evmon-metrics" aria-label="Live monitoring summary">
          <div><strong>{classifiedVehicles.length}</strong><span>Vehicles</span></div>
          <div><strong>{reportingNow}</strong><span>Reporting now</span></div>
        </div>
      </div>

      <EventWorkspaceNav eventName={selectedEvent?.name} planName={selectedPlan?.name} planStatus={selectedPlan?.status} activeStage="monitor" />

      <div className="evmon-context" aria-label="Event operating context">
        <label><span>Event context</span><select value={selectedEventId} onChange={(event) => { selectEvent(event.target.value); setRouteFilter("all"); setVehicles(null); }}><option value="">Select Event</option>{events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select></label>
        <label><span>Operating period</span><select value={selectedPlanId} onChange={(event) => { selectServicePlan(event.target.value); setRouteFilter("all"); setVehicles(null); }} disabled={!selectedEventId}><option value="">All active periods</option>{activePlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label>
        <span>{selectedEvent ? `${selectedPlans.length} operating period${selectedPlans.length === 1 ? "" : "s"}` : "No Event selected"}</span>
          <label><input type="checkbox" checked={showUnassigned} onChange={(event) => setShowUnassigned(event.target.checked)} /> Show unassigned vehicles</label>
      </div>

      <div className={`evmon-data-state evmon-data-state-${dataState.tone}`} role="status">
        <strong>{dataState.title}</strong>
        {dataState.action && <span>{dataState.action}</span>}
        {dataState.tone === "error" && <button className="btn-sm" onClick={() => void load()}>Try again</button>}
        {!selectedEventId && <Link to="/event-planning">Open Event Planning</Link>}
        {selectedEventId && (activePlans.length === 0 || plansMissingPublishedScope.length > 0) && <Link to={`/event-planning?event=${encodeURIComponent(selectedEventId)}${selectedPlan ? `&plan=${encodeURIComponent(selectedPlan.id)}` : ""}`}>Open Event Planning</Link>}
      </div>

      <div className="evmon-scope" aria-label="Live operating scope">
        <strong>Live operating scope</strong>
        {activePlans.length > 0 ? <>
          {plansMissingPublishedScope.length > 0
            ? <><span>Published scope unavailable for {plansMissingPublishedScope.map((plan) => plan.name).join(", ")}.</span><Link to={`/event-planning?event=${encodeURIComponent(selectedEventId)}${selectedPlan ? `&plan=${encodeURIComponent(selectedPlan.id)}` : ""}`}>Repair scope</Link></>
            : <><span><b>{routesActive}</b> routes{routeSummary ? ` · ${routeSummary}` : ""}</span><span><b>{visibleGeofences.length}</b> geofences · <b>{geofencesWithRules}</b> with rules</span><span><b>{visibleLocations.length}</b> locations</span><Link to={`/event-planning?event=${encodeURIComponent(selectedEventId)}${selectedPlan ? `&plan=${encodeURIComponent(selectedPlan.id)}` : ""}`}>Review scope</Link></>}
        </> : <span>Select an active operating period to see the managed scope.</span>}
      </div>

      <div className="evmon-health" aria-label="Event monitoring data health">
        <strong>Data health</strong>
        {(["shared_avl_ingestion", "event_projection", "crossing_detection"] as const).map((name) => {
          const component = health?.components.find((item) => item.component === name);
          return <span key={name}>{name.replaceAll("_", " ")}: <b>{healthLabel(component?.status)}</b></span>;
        })}
        <span>retention: <b>{health?.maintenance?.last_success_at ? `OK · ${minutesAgo(health.maintenance.last_success_at)}` : "Unavailable"}</b></span>
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
          <label><span>Managed service</span><select value={routeFilter} onChange={(event) => setRouteFilter(event.target.value)}><option value="all">All managed services</option>{routeOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          <label><span>Heading</span><select value={headingFilter} onChange={(event) => setHeadingFilter(event.target.value)}><option value="all">All headings</option>{["NB", "SB", "EB", "WB"].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span>Motion</span><select value={motionFilter} onChange={(event) => setMotionFilter(event.target.value)}><option value="all">Moving + stopped</option><option value="moving">Moving</option><option value="stopped">Stopped</option></select></label>
          <label><span>Map layer</span><select value={mapStyle} onChange={(event) => setMapStyle(event.target.value as MapStyle)}><option value="road">Road</option><option value="grayscale_light">Light</option><option value="night">Night</option><option value="satellite_road_labels">Satellite + labels</option></select></label>
          <label className="evmon-traffic"><input type="checkbox" checked={traffic} onChange={(event) => setTraffic(event.target.checked)} /><span>Traffic</span></label>
          <label className="evmon-traffic"><input type="checkbox" checked={showGeofences} onChange={(event) => setShowGeofences(event.target.checked)} /><span>Active geofences</span></label>
          <label className="evmon-traffic"><input type="checkbox" checked={showInactiveGeofences} onChange={(event) => setShowInactiveGeofences(event.target.checked)} /><span>Inactive geofences</span></label>
          <label className="evmon-traffic"><input type="checkbox" checked={showLocations} onChange={(event) => setShowLocations(event.target.checked)} /><span>Active locations</span></label>
          <label className="evmon-traffic"><input type="checkbox" checked={showInactiveLocations} onChange={(event) => setShowInactiveLocations(event.target.checked)} /><span>Inactive locations</span></label>
          {hasFilters && <button type="button" className="evmon-clear" onClick={() => { setSearch(""); setRouteFilter("all"); setHeadingFilter("all"); setMotionFilter("all"); }}>Clear filters</button>}
        </div>}
        {!minimized && (
          <div className="evmon-map-wrap">
            <VehicleMap vehicles={activeVehicles} geofences={mapGeofences} locations={mapLocations} showGeofences={mapGeofences.length > 0} showLocations={mapLocations.length > 0} mapStyle={mapStyle} traffic={traffic} />
            <div className="evmon-map-legend" aria-label="Map legend">
              <span><i className="evmon-legend-dot evmon-legend-dot-active" /> Active location</span>
              <span><i className="evmon-legend-dot evmon-legend-dot-inactive" /> Inactive location</span>
              <span><i className="evmon-legend-bus" /> Managed vehicle</span>
            </div>
          </div>
        )}
      </div>

      <div className="evmon-list-header">
        <div><h3>All active Event vehicles</h3><span>Fresh and recently stale SpecialEvent vehicles from shared AVL; plan membership is shown below.</span></div>
        <span className="evmon-count">{activeVehicles.length}{hasFilters ? ` of ${classifiedVehicles.length}` : ""} active</span>
      </div>
      {showUnassigned && <>
        <div className="evmon-list-header"><div><h3>Unassigned vehicles</h3><span>Active SpecialEvent vehicles not currently assigned to the selected operating plan.</span></div><span className="evmon-count">{unassignedVehicles.length}</span></div>
        <div className="evmon-table-wrap"><table className="data evmon-table"><thead><tr><th>Vehicle</th><th>Route</th><th>Heading</th><th>Last report</th>{canManageAssignments && <th>Planning action</th>}</tr></thead><tbody>{unassignedVehicles.map((vehicle) => <tr key={`unassigned-${vehicle.vehicle_id}`}><td><strong>{vehicle.vehicle_id}</strong></td><td>{routeLabel(vehicle)}</td><td><span className="evmon-heading">{cardinalHeading(vehicle.heading, vehicle.direction)}</span></td><td className={vehicle.is_stale ? "evmon-stale" : undefined}>{vehicle.is_stale ? "Stale · " : ""}{minutesAgo(vehicle.report_timestamp)}</td>{canManageAssignments && <td><button className="btn-sm" onClick={() => void proposeAssignment(vehicle)}>Propose assignment</button></td>}</tr>)}</tbody></table>{unassignedVehicles.length === 0 && <div className="evmon-empty">All active SpecialEvent vehicles are assigned to the selected context.</div>}</div>
        {assignmentMessage && <div className="evmon-empty" role="status">{assignmentMessage}</div>}
        {canManageAssignments && assignments.length > 0 && <div className="evmon-table-wrap"><table className="data evmon-table"><thead><tr><th>Assignment</th><th>Vehicle</th><th>Route</th><th>Plan</th><th>Status</th><th>Review</th></tr></thead><tbody>{assignments.map((assignment) => <tr key={assignment.id}><td>{new Date(assignment.requested_at).toLocaleString()}</td><td>{assignment.vehicle_id}</td><td>{assignment.route_id}</td><td>{assignment.service_plan_name ?? "—"}</td><td>{assignment.status}{assignment.revision_id ? ` · revision ${assignment.revision_id.slice(0, 8)}` : ""}</td><td>{assignment.status === "proposed" ? <><button className="btn-sm" onClick={() => void reviewAssignment(assignment.id, "approve")}>Approve</button> <button className="btn-sm" onClick={() => void reviewAssignment(assignment.id, "reject")}>Reject</button></> : "—"}</td></tr>)}</tbody></table></div>}
      </>}
      <div className="evmon-table-wrap">
        {message ? <div className="evmon-empty">{message}</div> : vehicles === null ? <div className="evmon-empty">Loading live positions…</div> : (
          <table className="data evmon-table">
            <thead><tr><th>Vehicle</th><th>Operator</th><th>Route</th><th>Service plan</th><th>Block / Run</th><th>Heading</th><th>Speed</th><th>Last report</th></tr></thead>
            <tbody>{activeVehicles.map((vehicle) => (
              <tr key={vehicle.vehicle_id}>
                <td><span className="evmon-bus-chip">▣</span><strong>{vehicle.vehicle_id}</strong></td>
                <td>{displayOperator(vehicle.operator_name)}</td>
                <td>{routeLabel(vehicle)}</td>
                <td>{vehicle.service_plan_names?.join(", ") || "—"}</td>
                <td>{vehicle.block ?? "—"} / {vehicle.run ?? "—"}</td>
                <td><span className="evmon-heading">{cardinalHeading(vehicle.heading, vehicle.direction)}</span></td>
                <td>{vehicle.speed_mph === null ? "—" : `${vehicle.speed_mph.toFixed(1)} mph`}</td>
                <td className={vehicle.is_stale ? "evmon-stale" : undefined}>{vehicle.is_stale ? "Stale · " : ""}{minutesAgo(vehicle.report_timestamp)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <div className="evmon-list-header"><div><h3>Geofence crossings</h3><span>Recent movement across active event boundaries · {feedStatus.crossings?.state === "error" ? "feed unavailable; showing last successful data" : feedStatus.crossings?.loadedAt ? `loaded ${feedStatus.crossings.loadedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "loading"}</span></div></div>
      <div className="evmon-table-wrap">
        {actionError && <div className="evmon-empty">{actionError}</div>}
        {notifications.map((notification) => <div key={notification.id} className="panel-body"><strong>{notification.status === "acknowledged" ? "Acknowledged notification" : "Review notification"}</strong><p>{notification.message_body}</p>{notification.status === "pending" && <button className="btn-sm" onClick={() => void reviewNotification(notification.id, "acknowledge")}>Acknowledge</button>} {notification.status === "acknowledged" && <button className="btn-sm" onClick={() => void reviewNotification(notification.id, "send")}>Approve and send</button>} {notification.status === "pending" && <button className="btn-sm" onClick={() => void reviewNotification(notification.id, "send")}>Approve and send</button>} {" "}<button className="btn-sm" onClick={() => void reviewNotification(notification.id, "dismiss")}>Dismiss</button></div>)}
        <table className="data evmon-table"><thead><tr><th>Time</th><th>Vehicle</th><th>Geofence</th><th>Transition</th><th>Destination</th></tr></thead><tbody>{crossings.map((crossing) => <tr key={crossing.id}><td>{new Date(crossing.crossed_at).toLocaleString()}</td><td>{crossing.vehicle_id}</td><td>{crossing.geofence_name}</td><td>{crossing.transition}</td><td>{crossing.destination_label ?? "—"}</td></tr>)}</tbody></table>
      </div>
      <div className="evmon-list-header"><div><h3>Event audit history</h3><span>Route changes, crossings, and notification actions · {feedStatus.audit?.state === "error" ? "feed unavailable; showing last successful data" : feedStatus.audit?.loadedAt ? `loaded ${feedStatus.audit.loadedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "loading"}</span></div></div>
      <div className="evmon-table-wrap"><table className="data evmon-table"><thead><tr><th>Time</th><th>Type</th><th>Entity</th><th>Detail</th><th>Actor</th></tr></thead><tbody>{audit.map((entry, index) => <tr key={`${entry.event_at}-${index}`}><td>{new Date(entry.event_at).toLocaleString()}</td><td>{entry.event_type}</td><td>{entry.entity_id}</td><td>{entry.detail}</td><td>{entry.actor ?? "system"}</td></tr>)}</tbody></table></div>
    </section>
  );
}

function VehicleMap({ vehicles, geofences, locations, showGeofences, showLocations, mapStyle, traffic }: { vehicles: EventVehiclePosition[]; geofences: EventGeofence[]; locations: EventLocation[]; showGeofences: boolean; showLocations: boolean; mapStyle: MapStyle; traffic: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<atlas.Map | null>(null);
  const popupRef = useRef<atlas.Popup | null>(null);
  const resourceSourceRef = useRef<atlas.source.DataSource | null>(null);
  const resourceLayersRef = useRef<atlas.layer.Layer[]>([]);
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
      const layer = new atlas.layer.PolygonLayer(source, "event-geofences", { fillColor: "#007f5f", fillOpacity: 0.18 });
      const outline = new atlas.layer.LineLayer(source, "event-geofence-outlines", { strokeColor: "#005c45", strokeWidth: 2 });
      map.layers.add([layer, outline]);
      resourceLayersRef.current.push(layer, outline);
    }
    if (showLocations) {
      locations.forEach((location) => source?.add(new atlas.data.Feature(new atlas.data.Point([location.longitude, location.latitude]), { kind: "location", name: location.name, category: location.category, active: location.is_active })));
      const activePoints = new atlas.layer.BubbleLayer(source, "event-active-location-points", {
        color: "#007f5f", radius: 10, strokeColor: "#ffffff", strokeWidth: 3,
        filter: ["all", ["==", ["get", "kind"], "location"], ["==", ["get", "active"], true]],
      });
      const inactivePoints = new atlas.layer.BubbleLayer(source, "event-inactive-location-points", {
        color: "#6b7280", radius: 9, strokeColor: "#ffffff", strokeWidth: 3,
        filter: ["all", ["==", ["get", "kind"], "location"], ["==", ["get", "active"], false]],
      });
      const labels = new atlas.layer.SymbolLayer(source, "event-location-labels", {
        iconOptions: { image: "none", allowOverlap: true },
        textOptions: { textField: ["get", "name"], offset: [0, 1.5], color: "#123", haloColor: "#fff", haloWidth: 2, allowOverlap: true },
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
