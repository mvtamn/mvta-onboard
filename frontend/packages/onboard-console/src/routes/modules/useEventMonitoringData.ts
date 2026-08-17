import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  type Event,
  type EventAuditEntry,
  type EventGeofence,
  type EventGeofenceCrossing,
  type EventGeofenceNotification,
  type EventLocation,
  type EventMonitoringHealth,
  type EventOperationalMessaging,
  type EventScopeException,
  type EventServicePlan,
  type EventVehicleAssignment,
  type EventVehiclePosition,
} from "@mvta/shared";
import { api } from "../../config.js";
import { eventVehiclePositionQuery } from "./eventMonitoringState.js";

const AVL_REFRESH_MS = 30_000;

export type EventMonitoringFeedName = "crossings" | "notifications" | "audit";
export type EventMonitoringFeedStatus = Record<EventMonitoringFeedName, { state: "ready" | "error"; loadedAt: Date | null } | undefined>;

export interface EventMonitoringDataOptions {
  eventId: string;
  servicePlanId: string;
  /** Any value whose identity changes on sign-in/sign-out; retriggers every load. */
  account: unknown;
  canManageAssignments: boolean;
  canManageEventMessaging: boolean;
  /** Called when an assignment approval lands in a new plan revision, so the caller can select it. */
  onAssignmentRevision?: (revisionId: string) => void;
}
export interface EventMonitoringData {
  vehicles: EventVehiclePosition[] | null;
  scopeExceptions: EventScopeException[];
  events: Event[];
  plans: EventServicePlan[];
  resourceGeofences: EventGeofence[];
  resourceLocations: EventLocation[];
  assignments: EventVehicleAssignment[];
  assignmentMessage: string | null;
  message: string | null;
  authExpired: boolean;
  lastUpdated: Date | null;
  refreshing: boolean;
  crossings: EventGeofenceCrossing[];
  notifications: EventGeofenceNotification[];
  audit: EventAuditEntry[];
  health: EventMonitoringHealth | null;
  feedStatus: EventMonitoringFeedStatus;
  actionError: string | null;
  messagingControl: EventOperationalMessaging | null;
  messagingError: string | null;
  refresh: () => Promise<void>;
  /** Clears live vehicle/scope-exception state; call when the operating context selection changes. */
  resetLiveVehicles: () => void;
  reviewNotification: (id: string, action: "acknowledge" | "send" | "dismiss") => Promise<void>;
  updateMessaging: (enabled: boolean) => Promise<void>;
  proposeAssignment: (vehicle: EventVehiclePosition | EventScopeException, targetPlan: EventServicePlan | undefined) => Promise<void>;
  reviewAssignment: (id: string, action: "approve" | "reject") => Promise<void>;
}

/**
 * Owns every Event AVL live-data load, the 30-second poll, and the four
 * operator actions (notification review, Teams messaging, scope-change
 * proposal and review). One interface for the whole live operating
 * picture — everything error-shaping and polling related lives here so a
 * caller only renders what this hook returns.
 */
export function useEventMonitoringData(options: EventMonitoringDataOptions): EventMonitoringData {
  const { eventId, servicePlanId, account, canManageAssignments, canManageEventMessaging, onAssignmentRevision } = options;

  const [vehicles, setVehicles] = useState<EventVehiclePosition[] | null>(null);
  const [scopeExceptions, setScopeExceptions] = useState<EventScopeException[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [plans, setPlans] = useState<EventServicePlan[]>([]);
  const [resourceGeofences, setResourceGeofences] = useState<EventGeofence[]>([]);
  const [resourceLocations, setResourceLocations] = useState<EventLocation[]>([]);
  const [assignments, setAssignments] = useState<EventVehicleAssignment[]>([]);
  const [assignmentMessage, setAssignmentMessage] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [authExpired, setAuthExpired] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [crossings, setCrossings] = useState<EventGeofenceCrossing[]>([]);
  const [notifications, setNotifications] = useState<EventGeofenceNotification[]>([]);
  const [audit, setAudit] = useState<EventAuditEntry[]>([]);
  const [health, setHealth] = useState<EventMonitoringHealth | null>(null);
  const [feedStatus, setFeedStatus] = useState<EventMonitoringFeedStatus>({ crossings: undefined, notifications: undefined, audit: undefined });
  const [actionError, setActionError] = useState<string | null>(null);
  const [messagingControl, setMessagingControl] = useState<EventOperationalMessaging | null>(null);
  const [messagingError, setMessagingError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const query = eventVehiclePositionQuery(eventId, servicePlanId);
      const { vehicles: current, scope_exceptions: currentScopeExceptions, diagnostics } = await api.getEventVehiclePositions(query.eventId, query.servicePlanId);
      setVehicles(current);
      setScopeExceptions(currentScopeExceptions ?? []);
      setLastUpdated(new Date());
      setAuthExpired(false);
      setMessage(
        diagnostics.table_ready
          ? current.length === 0 ? "No active vehicles match the current SpecialEvent route classifications." : null
          : "Event vehicle monitoring has not been configured yet.",
      );
    } catch (error) {
      const expired = error instanceof ApiError && error.status === 401;
      setAuthExpired(expired);
      setMessage(expired
        ? "Your OnBoard session has expired. Sign in again to load live vehicle positions."
        : error instanceof ApiError ? `Could not load live vehicle positions: ${error.message}` : "Could not reach the live vehicle-position service.");
    } finally {
      setRefreshing(false);
    }
    void api.getEventMonitoringHealth(eventId || undefined, servicePlanId || undefined).then(setHealth).catch(() => setHealth(null));
  }, [eventId, servicePlanId]);

  useEffect(() => {
    void Promise.all([api.getEvents(), api.getEventServicePlans()]).then(([eventRows, planRows]) => {
      setEvents(eventRows.events);
      setPlans(planRows.plans);
    }).catch(() => { setEvents([]); setPlans([]); });
  }, [account]);

  useEffect(() => {
    void Promise.all([api.getEventGeofences(), api.getEventLocations()]).then(([geofenceRows, locationRows]) => {
      setResourceGeofences(geofenceRows.geofences);
      setResourceLocations(locationRows.locations);
    }).catch(() => { setResourceGeofences([]); setResourceLocations([]); });
  }, [account]);

  useEffect(() => {
    if (!eventId) { setAssignments([]); return; }
    if (!canManageAssignments) { setAssignments([]); return; }
    void api.getEventVehicleAssignments(eventId).then((result) => setAssignments(result.assignments)).catch(() => setAssignments([]));
  }, [account, canManageAssignments, eventId]);

  useEffect(() => {
    if (!servicePlanId) { setMessagingControl(null); setMessagingError(null); return; }
    void api.getEventOperationalMessaging(servicePlanId).then(setMessagingControl).catch((error) => setMessagingError(error instanceof ApiError ? error.message : "Could not load operational messaging controls."));
  }, [account, servicePlanId]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), AVL_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [account, refresh]);

  useEffect(() => {
    if (!eventId) { setCrossings([]); setNotifications([]); setAudit([]); return; }
    Promise.allSettled([api.getEventGeofenceCrossings(eventId, servicePlanId), api.getEventGeofenceNotifications("all", eventId, servicePlanId), api.getEventAuditStream(undefined, undefined, eventId, servicePlanId)])
      .then(([c, n, a]) => {
        const now = new Date();
        if (c.status === "fulfilled") { setCrossings(c.value.crossings); setFeedStatus((s) => ({ ...s, crossings: { state: "ready", loadedAt: now } })); }
        else setFeedStatus((s) => ({ ...s, crossings: { state: "error", loadedAt: s.crossings?.loadedAt ?? null } }));
        if (n.status === "fulfilled") { setNotifications(n.value.notifications); setFeedStatus((s) => ({ ...s, notifications: { state: "ready", loadedAt: now } })); }
        else setFeedStatus((s) => ({ ...s, notifications: { state: "error", loadedAt: s.notifications?.loadedAt ?? null } }));
        if (a.status === "fulfilled") { setAudit(a.value.entries); setFeedStatus((s) => ({ ...s, audit: { state: "ready", loadedAt: now } })); }
        else setFeedStatus((s) => ({ ...s, audit: { state: "error", loadedAt: s.audit?.loadedAt ?? null } }));
      });
  }, [account, lastUpdated, eventId, servicePlanId]);

  const resetLiveVehicles = useCallback(() => {
    setVehicles(null);
    setScopeExceptions([]);
  }, []);

  const reviewNotification = useCallback(async (id: string, action: "acknowledge" | "send" | "dismiss") => {
    setActionError(null);
    try {
      if (action === "send") await api.sendEventGeofenceNotification(id);
      else if (action === "acknowledge") await api.acknowledgeEventGeofenceNotification(id);
      else await api.dismissEventGeofenceNotification(id);
      setNotifications((rows) => action === "acknowledge" ? rows.map((row) => row.id === id ? { ...row, status: "acknowledged" as const } : row) : rows.filter((row) => row.id !== id));
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : "Notification action failed; the item was retained.");
    }
  }, []);

  const updateMessaging = useCallback(async (enabled: boolean) => {
    if (!servicePlanId || !messagingControl || !canManageEventMessaging) return;
    setMessagingError(null);
    try { setMessagingControl(await api.updateEventOperationalMessaging(servicePlanId, enabled)); }
    catch (error) { setMessagingError(error instanceof ApiError ? error.message : "Could not update operational messaging controls."); }
  }, [servicePlanId, messagingControl, canManageEventMessaging]);

  const proposeAssignment = useCallback(async (vehicle: EventVehiclePosition | EventScopeException, targetPlan: EventServicePlan | undefined) => {
    if (!eventId || !targetPlan || vehicle.route === null) { setAssignmentMessage("Select an Event with a draft, review, or active operating period before proposing an assignment."); return; }
    try {
      const assignment = await api.createEventVehicleAssignment({ event_id: eventId, service_plan_id: targetPlan.id, vehicle_id: vehicle.vehicle_id, route_id: vehicle.route, reason: "Proposed from Event AVL scope exception review" });
      setAssignments((rows) => [assignment, ...rows]);
      // A selected active plan means the proposal becomes a revision on it;
      // the draft/review fallback used otherwise is never "active".
      setAssignmentMessage(targetPlan.status === "active" ? "Assignment proposed as an active-plan revision; it is not live until the revision is approved and applied." : "Assignment proposed for the operating period.");
    } catch (error) { setAssignmentMessage(error instanceof ApiError ? error.message : "Could not propose vehicle assignment."); }
  }, [eventId]);

  const reviewAssignment = useCallback(async (id: string, action: "approve" | "reject") => {
    try {
      const result = await api.transitionEventVehicleAssignment(id, action);
      if (result.revision_id) onAssignmentRevision?.(result.revision_id);
      setAssignments((rows) => rows.map((row) => row.id === id ? { ...row, status: result.status as EventVehicleAssignment["status"], revision_id: result.revision_id ?? row.revision_id } : row));
      setAssignmentMessage(action === "approve" && result.target === "revision" ? "Assignment accepted into a new revision. Review and apply that revision before it becomes operational." : `Assignment ${action}d.`);
    } catch (error) { setAssignmentMessage(error instanceof ApiError ? error.message : "Could not update the assignment proposal."); }
  }, [onAssignmentRevision]);

  return {
    vehicles, scopeExceptions, events, plans, resourceGeofences, resourceLocations,
    assignments, assignmentMessage, message, authExpired, lastUpdated, refreshing,
    crossings, notifications, audit, health, feedStatus, actionError, messagingControl, messagingError,
    refresh, resetLiveVehicles, reviewNotification, updateMessaging, proposeAssignment, reviewAssignment,
  };
}
