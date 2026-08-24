import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { type EventGeofence, type EventGeofenceNotification, type EventLocation, type EventScopeException, type EventVehiclePosition } from "@mvta/shared";
import { useEventWorkspace } from "../../context/EventWorkspaceContext.js";
import { useAuth } from "../../auth/AuthContext.js";
import "./eventMonitoring.css";
import { activePlansMissingPublishedScope, defaultMonitoringEventId, defaultMonitoringServicePlanId, deriveEventMonitoringDataState, isEventNotificationHistoryStatus, isOpenEventNotificationStatus } from "./eventMonitoringState.js";
import { useEventMonitoringData } from "./useEventMonitoringData.js";
import { cardinalHeading, displayOperator, minutesAgo, monitoringAreaLabel, routeDisplayLabel, routeLabel, routeVehicleLabel } from "./eventVehicleFormat.js";
import { EventVehicleMap, type MapStyle } from "./EventVehicleMap.js";
import { crossingEvidenceLabel } from "./crossingEvidence.js";

const SCOPE_EXCEPTION_LABELS: Record<EventScopeException["category"], string> = {
  needs_scope_review: "Needs scope review", telemetry_incomplete: "Telemetry incomplete", stale_observation: "Stale observation", assigned_elsewhere: "Assigned elsewhere",
};
const SCOPE_EXCEPTION_DETAILS: Record<EventScopeException["category"], string> = {
  needs_scope_review: "This vehicle is on an event route but is not included in this operating period. Review it before adding it.",
  telemetry_incomplete: "Live tracking is present, but the driver, block, or run assignment needed to place it is missing. Check the source record first.",
  stale_observation: "Its most recent position is more than three minutes old.",
  assigned_elsewhere: "This bus already belongs to another active operating period.",
};

function displayProposalStatus(status: string | null | undefined): string {
  return status ? `Proposal: ${status.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase())}` : "No scope change proposed";
}

function displayNotificationStatus(status: string): string {
  return status.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

function vehicleAttention(vehicle: EventVehiclePosition | EventScopeException): number {
  if ("category" in vehicle) return 0;
  return vehicle.is_stale ? 1 : 2;
}

function RefreshLiveDataButton({ refreshing, onRefresh }: { refreshing: boolean; onRefresh: () => void }) {
  return <button className="evmon-refresh-button" type="button" disabled={refreshing} onClick={onRefresh} aria-label={refreshing ? "Refreshing live Event AVL data" : "Refresh live Event AVL data"}>
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6v5h-5" /><path d="M4 18v-5h5" /><path d="M18.5 9a7 7 0 0 0-12-2.5L4 9M5.5 15a7 7 0 0 0 12 2.5L20 15" /></svg>
    <span>{refreshing ? "Refreshing…" : "Refresh"}</span>
  </button>;
}

export function EventMonitoring({ fieldView = false }: { fieldView?: boolean }) {
  const { account, roles, signIn } = useAuth();
  const { selection, selectEvent, selectServicePlan, selectRevision } = useEventWorkspace();
  const { eventId: selectedEventId, servicePlanId: selectedPlanId } = selection;
  const canManageAssignments = roles.includes("OCC.Admin");
  const canManageEventMessaging = roles.includes("OCC.EventAVL") || roles.includes("OCC.Admin");
  const canManageNotificationActions = roles.some((role) => ["OCC.EventAVL", "OCC.Publisher", "OCC.Admin"].includes(role));
  const [search, setSearch] = useState("");
  const [mapStyle, setMapStyle] = useState<MapStyle>("road");
  const [traffic, setTraffic] = useState(false);
  const [showGeofences, setShowGeofences] = useState(true);
  const [showLocations, setShowLocations] = useState(true);
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);
  const [notificationDrawer, setNotificationDrawer] = useState(false);
  const [rosterSegment, setRosterSegment] = useState<"in-period" | "outside">("in-period");
  const [rosterFilter, setRosterFilter] = useState<"all" | "stale" | "exceptions">("all");
  const defaultedEventRef = useRef(false);
  const data = useEventMonitoringData({ eventId: selectedEventId, servicePlanId: selectedPlanId, account, canManageAssignments, canManageEventMessaging, onAssignmentRevision: selectRevision });
  const { vehicles, scopeExceptions, events, plans, notifications, crossings, audit, health, message, authExpired, actionError, messagingControl, messagingError, refreshing, refresh, resetLiveVehicles, reviewNotification, updateMessaging, proposeAssignment } = data;

  useEffect(() => {
    if (selectedEventId) { if (!selectedPlanId) { const id = defaultMonitoringServicePlanId(selectedEventId, plans); if (id) selectServicePlan(id); } return; }
    if (defaultedEventRef.current || events.length === 0) return;
    const id = defaultMonitoringEventId(events, plans); if (!id) return;
    defaultedEventRef.current = true; selectEvent(id);
  }, [events, plans, selectedEventId, selectedPlanId, selectEvent, selectServicePlan]);

  const selectedEvent = events.find((event) => event.id === selectedEventId);
  const selectedPlans = plans.filter((plan) => plan.event_id === selectedEventId);
  const activePlans = selectedPlans.filter((plan) => plan.status === "active");
  const selectedPlan = activePlans.find((plan) => plan.id === selectedPlanId);
  const requiresPlanSelection = Boolean(selectedEventId && activePlans.length > 1 && !selectedPlanId);
  const scopedPlans = selectedPlan ? [selectedPlan] : activePlans.length === 1 ? activePlans : [];
  const missingScope = activePlansMissingPublishedScope(scopedPlans);
  const visibleGeofences = Array.from(new Map(scopedPlans.flatMap((plan) => plan.published_scope?.geofences ?? []).map((fence) => [fence.id, fence])).values());
  const visibleLocations = Array.from(new Map(scopedPlans.flatMap((plan) => plan.published_scope?.locations ?? []).map((location) => [location.id, location])).values());
  const allVehicles = vehicles ?? [];
  const query = search.trim().toLowerCase();
  const filteredVehicles = useMemo(() => allVehicles.filter((vehicle) => (rosterFilter !== "stale" || vehicle.is_stale) && (!query || String(vehicle.vehicle_id).includes(query) || routeLabel(vehicle).toLowerCase().includes(query) || displayOperator(vehicle.operator_name).toLowerCase().includes(query))), [allVehicles, query, rosterFilter]);
  const exceptionIds = new Set(scopeExceptions.map((vehicle) => vehicle.vehicle_id));
  const roster = useMemo(() => {
    const inPeriod = filteredVehicles.filter((vehicle) => vehicle.is_in_active_scope && !exceptionIds.has(vehicle.vehicle_id));
    const outside = scopeExceptions.filter((vehicle) => !query || String(vehicle.vehicle_id).includes(query) || routeLabel(vehicle).toLowerCase().includes(query));
    return { inPeriod: inPeriod.sort((a, b) => vehicleAttention(a) - vehicleAttention(b) || a.vehicle_id - b.vehicle_id), outside: outside.sort((a, b) => vehicleAttention(a) - vehicleAttention(b) || a.vehicle_id - b.vehicle_id) };
  }, [exceptionIds, filteredVehicles, query, scopeExceptions]);
  const currentRoster = rosterFilter === "exceptions" ? roster.outside : rosterSegment === "in-period" ? roster.inPeriod : roster.outside;
  const selectedVehicle = allVehicles.find((vehicle) => vehicle.vehicle_id === selectedVehicleId) ?? scopeExceptions.find((vehicle) => vehicle.vehicle_id === selectedVehicleId);
  const eventQueue = notifications.filter((notification) => isOpenEventNotificationStatus(notification.status));
  const eventHistory = notifications.filter((notification) => isEventNotificationHistoryStatus(notification.status));
  const degraded = health?.components.filter((component) => component.status !== "healthy") ?? [];
  const actionsBlocked = degraded.some((component) => ["event_projection", "crossing_detection"].includes(component.component));
  const state = deriveEventMonitoringDataState({ authenticationExpired: authExpired, loadError: message, vehicles, hasOperatingContext: Boolean(selectedEventId), activePlanCount: activePlans.length, requiresPlanSelection, missingPublishedScopePlanNames: missingScope.map((plan) => plan.name), health, degradedComponentNames: degraded.map((component) => component.component.replaceAll("_", " ")) });
  const reportingNow = allVehicles.filter((vehicle) => !vehicle.is_stale && vehicle.report_age_seconds < 60).length;
  const feedState = health === null ? "Unavailable" : degraded.length ? "Degraded" : "Ready";

  if (fieldView && authExpired) return <div className="evmon-blocking-state evmon-blocking-state-error" role="alert"><div><strong>Live Event AVL is unavailable</strong><p>Your OnBoard session expired. Sign in again to restore this Event context.</p></div><button className="btn-primary" onClick={signIn}>Sign in again</button></div>;
  if (fieldView) return <EventAVLFieldView vehicles={allVehicles} notifications={eventQueue} selectedVehicleId={selectedVehicleId} onSelectVehicle={setSelectedVehicleId} mapGeofences={visibleGeofences} mapLocations={visibleLocations} showGeofences={showGeofences} onShowGeofencesChange={setShowGeofences} showLocations={showLocations} onShowLocationsChange={setShowLocations} mapStyle={mapStyle} onMapStyleChange={setMapStyle} traffic={traffic} onTrafficChange={setTraffic} staleCount={allVehicles.filter((vehicle) => vehicle.is_stale).length} trustState={state} actionsBlocked={actionsBlocked} canManageNotificationActions={canManageNotificationActions} onReviewNotification={reviewNotification} refreshing={refreshing} onRefresh={() => void refresh()} />;

  return <section className="evmon" aria-label="Live vehicle monitoring">
    <div className="evmon-sticky-bar">
      <div><span className="evmon-eyebrow"><span className="evmon-live-dot" /> Event AVL</span><strong>{selectedEvent?.name ?? "Select an Event"}</strong><span>{selectedPlan?.name ?? "Select an operating period"}</span></div>
      <label>Event<select value={selectedEventId} onChange={(event) => { selectEvent(event.target.value); resetLiveVehicles(); }}><option value="">Select Event</option>{events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select></label>
      <label>Operating period<select value={selectedPlanId} disabled={!selectedEventId} onChange={(event) => { selectServicePlan(event.target.value); resetLiveVehicles(); }}><option value="">Select period</option>{activePlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label>
      <button className="evmon-chip" type="button" onClick={() => setRosterFilter("all")}>Vehicles {allVehicles.length}</button><button className="evmon-chip" type="button" onClick={() => setRosterFilter("all")}>Reporting now {reportingNow}</button><button className={`evmon-chip${rosterFilter === "stale" ? " is-active" : ""}`} type="button" onClick={() => { setRosterFilter("stale"); setRosterSegment("in-period"); }}>Stale {allVehicles.filter((vehicle) => vehicle.is_stale).length}</button><button className={`evmon-chip${rosterFilter === "exceptions" ? " is-active" : ""}`} type="button" onClick={() => { setRosterFilter("exceptions"); setRosterSegment("outside"); }}>Scope exceptions {scopeExceptions.length}</button><details className={`evmon-feed-detail is-${feedState.toLowerCase()}`}><summary><i />Feed {feedState}</summary><div className="evmon-feed-popover">{health?.components.map((component) => <div key={component.component}><strong>{component.component.replaceAll("_", " ")}</strong><span>{component.status}</span><small>Updated {new Date(component.updated_at).toLocaleTimeString()}</small></div>) ?? <p>Health details are unavailable.</p>}</div></details>
      <RefreshLiveDataButton refreshing={refreshing} onRefresh={() => void refresh()} />
      <button className="evmon-notification-badge" type="button" aria-label={`${eventQueue.length} open Event notifications`} onClick={() => setNotificationDrawer(true)}>Open notifications <strong>{eventQueue.length}</strong></button>
    </div>
    {authExpired ? <div className="evmon-blocking-state evmon-blocking-state-error" role="alert"><div><strong>Live Event AVL is unavailable</strong><p>Your OnBoard session expired. Sign in again to restore this Event context.</p></div><button className="btn-primary" onClick={signIn}>Sign in again</button></div> : state.tone !== "success" && <div className={`evmon-data-state evmon-data-state-${state.tone}`} role="status"><strong>{state.title}</strong>{state.action && <span>{state.action}</span>}</div>}
    {selectedEventId && !authExpired && !requiresPlanSelection && <>
      <div className="evmon-work-surface"><div className="evmon-map-wrap"><EventVehicleMap vehicles={filteredVehicles} geofences={visibleGeofences} locations={visibleLocations} showGeofences={showGeofences} showLocations={showLocations} mapStyle={mapStyle} traffic={traffic} selectedVehicleId={selectedVehicleId} onSelectVehicle={setSelectedVehicleId} onShowGeofencesChange={setShowGeofences} onShowLocationsChange={setShowLocations} onMapStyleChange={setMapStyle} onTrafficChange={setTraffic} /></div><div className="evmon-roster-pane">
        <div className="evmon-roster-tools"><input aria-label="Find vehicle" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Vehicle, route, operator" /></div>
        <div className="evmon-segmented-tabs"><button className={rosterSegment === "in-period" ? "is-active" : ""} onClick={() => setRosterSegment("in-period")}>In this operating period ({roster.inPeriod.length})</button><button className={rosterSegment === "outside" ? "is-active" : ""} onClick={() => setRosterSegment("outside")}>Event-relevant, outside this period ({roster.outside.length})</button></div>
        {currentRoster.length === 0 ? <div className="evmon-empty">{vehicles === null ? "Loading live positions…" : "No results"}</div> : <div className="evmon-roster-scroll"><table className="data evmon-table"><thead><tr><th>Vehicle</th><th>Status</th><th>Monitoring Area</th><th>Route</th><th>Last report</th>{rosterSegment === "outside" && canManageAssignments && <th>Planning action</th>}</tr></thead><tbody>{currentRoster.map((vehicle) => <tr key={vehicle.vehicle_id} className={selectedVehicleId === vehicle.vehicle_id ? "is-selected" : ""} onClick={() => setSelectedVehicleId(vehicle.vehicle_id)}><td><strong>{vehicle.vehicle_id}</strong></td><td>{"category" in vehicle ? <><strong>{SCOPE_EXCEPTION_LABELS[vehicle.category as EventScopeException["category"]]}</strong><small className="evmon-exception-meta">{displayProposalStatus((vehicle as EventScopeException).proposal_status)}</small></> : vehicle.zone_status}</td><td>{vehicle.zone_name ?? vehicle.zone_status}</td><td>{routeLabel(vehicle)}</td><td className={vehicle.is_stale ? "evmon-stale" : undefined}>{vehicle.is_stale ? "Stale · " : ""}{minutesAgo(vehicle.report_timestamp)}</td>{rosterSegment === "outside" && canManageAssignments && <td>{"action_eligible" in vehicle && vehicle.action_eligible && vehicle.route !== null ? <button className="btn-sm" onClick={(event) => { event.stopPropagation(); void proposeAssignment(vehicle, selectedPlan); }}>Propose scope change</button> : "Inspection required"}</td>}</tr>)}</tbody></table></div>}
        {selectedVehicle && <div className="evmon-vehicle-detail" aria-label="Vehicle detail"><strong>{routeVehicleLabel(selectedVehicle)}</strong><span>{displayOperator(selectedVehicle.operator_name)}</span><span>{monitoringAreaLabel(selectedVehicle)}</span><span>Heading {cardinalHeading(selectedVehicle.heading, selectedVehicle.direction)} · Speed {selectedVehicle.speed_mph === null ? "unavailable" : `${selectedVehicle.speed_mph.toFixed(1)} mph`} · Last report {minutesAgo(selectedVehicle.report_timestamp)}</span>{"category" in selectedVehicle && <p className="evmon-attention-explanation"><strong>Why it needs attention</strong>{SCOPE_EXCEPTION_DETAILS[selectedVehicle.category as EventScopeException["category"]]}</p>}</div>}
      </div></div>
      {/* Each rail entry carries a timestamp, a label, and its detail as
          distinct elements. These were single muted paragraphs with every
          field run together by dots, which made the three histories
          unreadable at exactly the moment someone is investigating. */}
      <div className="evmon-investigative-rail">
        <details>
          <summary>Event message history <span>{eventHistory.length}</span></summary>
          <div className="evmon-rail-body">
            {eventHistory.length === 0 ? <p className="evmon-rail-empty">No messages recorded for this Event context.</p> : eventHistory.map((notification) => <div className="evmon-rail-entry" key={notification.id}>
              <span className="evmon-rail-when">{new Date(notification.created_at).toLocaleTimeString()}</span>
              <strong>{notification.status === "sent" ? "Sent to Teams" : displayNotificationStatus(notification.status)}</strong>
              <span className="evmon-rail-detail">{notification.message_body}</span>
            </div>)}
          </div>
        </details>
        <details>
          <summary>Monitoring Area crossings <span>{crossings.length}</span></summary>
          <div className="evmon-rail-body">
            {crossings.length === 0 ? <p className="evmon-rail-empty">No crossings detected yet.</p> : crossings.map((crossing) => <div className="evmon-rail-entry" key={crossing.id}>
              <span className="evmon-rail-when">Detected {new Date(crossing.crossed_at).toLocaleTimeString()}</span>
              <strong>Vehicle {crossing.vehicle_id} {crossing.transition === "enter" ? "entered" : "exited"}</strong>
              <span className="evmon-rail-detail">{crossing.geofence_name} · {crossingEvidenceLabel(crossing)}</span>
            </div>)}
          </div>
        </details>
        <details>
          <summary>Event audit history <span>{audit.length}</span></summary>
          <div className="evmon-rail-body">
            {audit.length === 0 ? <p className="evmon-rail-empty">No audit entries for this Event context.</p> : audit.map((entry, index) => <div className="evmon-rail-entry" key={`${entry.event_at}-${index}`}>
              <span className="evmon-rail-when">{new Date(entry.event_at).toLocaleTimeString()}</span>
              <strong>{entry.event_type.replaceAll("_", " ")}</strong>
              <span className="evmon-rail-detail">{entry.detail}</span>
            </div>)}
          </div>
        </details>
        <details open={Boolean(messagingError || actionsBlocked)}>
          <summary>Teams delivery <span>{messagingControl?.automatic_teams_enabled ? "On" : "Off"}</span></summary>
          <div className="evmon-rail-body">
            {messagingError ? <p className="evmon-rail-empty" role="alert">{messagingError}</p> : messagingControl && <>
              <label className="evmon-rail-toggle"><input type="checkbox" checked={messagingControl.automatic_teams_enabled} disabled={!canManageEventMessaging || !messagingControl.teams_configured || actionsBlocked} onChange={(event) => void updateMessaging(event.target.checked)} /> Automatic Teams delivery</label>
              <p className="evmon-rail-empty">{messagingControl.teams_configured ? messagingControl.teams_destination : "No Teams channel is configured."}{actionsBlocked ? " Paused while monitoring is degraded." : ""}</p>
            </>}
          </div>
        </details>
      </div>
    </>}
    {notificationDrawer && <div className="evmon-drawer-backdrop" role="presentation" onClick={() => setNotificationDrawer(false)}><aside className="evmon-drawer" role="dialog" aria-label="Open Event notifications" onClick={(event) => event.stopPropagation()}><div className="evmon-drawer-header"><strong>{eventQueue.length} open Event notifications</strong><button onClick={() => setNotificationDrawer(false)}>Close</button></div>{actionError && <p role="alert">{actionError}</p>}{eventQueue.map((notification) => <div className="panel-body" key={notification.id}><strong>{notification.status}</strong><p>{notification.message_body}</p>{actionsBlocked && <small>Actions paused while monitoring is degraded.</small>}{canManageNotificationActions && !actionsBlocked && <div><button className="btn-sm" onClick={() => void reviewNotification(notification.id, "acknowledge")}>Acknowledge</button> <button className="btn-sm" onClick={() => void reviewNotification(notification.id, "send")}>Approve and send</button> <button className="btn-sm" onClick={() => void reviewNotification(notification.id, "dismiss")}>Dismiss</button></div>}{!canManageNotificationActions && <small>Event AVL Manager or Publisher access is required for notification actions.</small>}</div>)}</aside></div>}
    <Link className="evmon-field-view-link" to="/events/avl/field">Open Event AVL field view</Link>
  </section>;
}

function EventAVLFieldView({ vehicles, notifications, selectedVehicleId, onSelectVehicle, mapGeofences, mapLocations, showGeofences, onShowGeofencesChange, showLocations, onShowLocationsChange, mapStyle, onMapStyleChange, traffic, onTrafficChange, staleCount, trustState, actionsBlocked, canManageNotificationActions, onReviewNotification, refreshing, onRefresh }: {
  vehicles: EventVehiclePosition[]; notifications: EventGeofenceNotification[]; selectedVehicleId: number | null; onSelectVehicle: (id: number) => void;
  mapGeofences: EventGeofence[]; mapLocations: EventLocation[]; showGeofences: boolean; onShowGeofencesChange: (visible: boolean) => void; showLocations: boolean; onShowLocationsChange: (visible: boolean) => void;
  mapStyle: MapStyle; onMapStyleChange: (style: MapStyle) => void; traffic: boolean; onTrafficChange: (visible: boolean) => void;
  staleCount: number; trustState: ReturnType<typeof deriveEventMonitoringDataState>; actionsBlocked: boolean; canManageNotificationActions: boolean;
  onReviewNotification: (id: string, action: "acknowledge" | "send" | "dismiss") => Promise<void>; refreshing: boolean; onRefresh: () => void;
}) {
  const groups = new Map<string, EventVehiclePosition[]>();
  const [showNotifications, setShowNotifications] = useState(false);
  for (const vehicle of vehicles) { const key = vehicle.zone_name ?? "Outside monitored zones"; groups.set(key, [...(groups.get(key) ?? []), vehicle]); }
  const selected = vehicles.find((vehicle) => vehicle.vehicle_id === selectedVehicleId);
  return <section className="evmon evmon-field" aria-label="Event AVL field view">
    <div className="evmon-field-header"><strong>Event AVL field view</strong><span>{trustState.tone === "success" ? "Feed trusted" : trustState.title} · {staleCount} stale</span><RefreshLiveDataButton refreshing={refreshing} onRefresh={onRefresh} /><button className="evmon-notification-badge" type="button" onClick={() => setShowNotifications(true)}>Open notifications <strong>{notifications.length}</strong></button></div>
    {trustState.action && trustState.tone !== "success" && <p className="evmon-data-state evmon-data-state-warning">{trustState.action}</p>}
    <div className="evmon-field-surface"><div>
      <EventVehicleMap vehicles={vehicles} geofences={mapGeofences} locations={mapLocations} showGeofences={showGeofences} showLocations={showLocations} mapStyle={mapStyle} traffic={traffic} selectedVehicleId={selectedVehicleId} onSelectVehicle={onSelectVehicle} onShowGeofencesChange={onShowGeofencesChange} onShowLocationsChange={onShowLocationsChange} onMapStyleChange={onMapStyleChange} onTrafficChange={onTrafficChange} />
      {selected && <div className="evmon-vehicle-detail"><strong>{routeVehicleLabel(selected)}</strong><span>{monitoringAreaLabel(selected)}</span><span>Last report {minutesAgo(selected.report_timestamp)}</span></div>}
    </div><div className="evmon-field-list">
      {Array.from(groups, ([zone, rows]) => <section key={zone}><h3>{zone} <span>{rows.length}</span></h3>{rows.map((vehicle) => <button className={selectedVehicleId === vehicle.vehicle_id ? "is-selected" : ""} key={vehicle.vehicle_id} onClick={() => onSelectVehicle(vehicle.vehicle_id)}><strong>{vehicle.vehicle_id}</strong><span>{routeDisplayLabel(vehicle)}</span><small>{vehicle.is_stale ? "Stale" : minutesAgo(vehicle.report_timestamp)}</small></button>)}</section>)}
    </div></div>
    {showNotifications && <div className="evmon-drawer-backdrop" role="presentation" onClick={() => setShowNotifications(false)}><aside className="evmon-drawer" role="dialog" aria-label="Open Event notifications" onClick={(event) => event.stopPropagation()}><div className="evmon-drawer-header"><strong>{notifications.length} open Event notifications</strong><button onClick={() => setShowNotifications(false)}>Close</button></div>{notifications.map((notification) => <div className="panel-body" key={notification.id}><p>{notification.message_body}</p>{actionsBlocked && <small>Actions paused while monitoring is degraded.</small>}{canManageNotificationActions && !actionsBlocked && <div><button className="btn-sm" onClick={() => void onReviewNotification(notification.id, "acknowledge")}>Acknowledge</button> <button className="btn-sm" onClick={() => void onReviewNotification(notification.id, "send")}>Approve and send</button> <button className="btn-sm" onClick={() => void onReviewNotification(notification.id, "dismiss")}>Dismiss</button></div>}</div>)}</aside></div>}
  </section>;
}
