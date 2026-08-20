import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, type Event, type EventGeofence, type EventLocation, type EventOperationalMessaging, type EventServicePlan } from "@mvta/shared";
import { api } from "../config.js";
import { useAuth } from "../auth/AuthContext.js";
import { useEventWorkspace } from "../context/EventWorkspaceContext.js";
import { EventWorkspaceNav } from "../components/EventWorkspaceNav.js";
// Lazy: azure-maps-control needs WebGL and pulls a large bundle, so it is
// fetched only when a planner actually opens the map view.
const EventScopeMap = lazy(() => import("./modules/EventScopeMap.js").then((module) => ({ default: module.EventScopeMap })));

// "suspended" is deliberately not in this list: there is no backend
// transition back from suspended to active or completed (checked against
// eventServicePlans.ts), so it isn't a forward step in the sequence - it's
// a paused exception layered on top of "active", shown as its own callout
// instead of a 6th pill that implies a path forward that doesn't exist.
const steps: EventServicePlan["status"][] = ["draft", "review", "approved", "active", "completed"];
const statusLabels: Record<EventServicePlan["status"], string> = {
  draft: "Draft",
  review: "In review",
  approved: "Approved",
  active: "Active",
  suspended: "Suspended",
  completed: "Completed",
};
function displayStatus(status: string): string {
  return status in statusLabels ? statusLabels[status as EventServicePlan["status"]] : status.replace(/^./, (character) => character.toUpperCase());
}
type ResourceOption = { id: string; label: string };
type ResourceKind = "routes" | "geofences" | "locations";
type FeedbackScope = "event" | "period" | "lifecycle" | "resources";
type Feedback = { text: string; kind: "success" | "error" };

// Renders next to whichever panel actually triggered the action, instead of
// one shared banner at the top of the page, and gives success/error
// distinct styling instead of both reading as the same muted note.
function FeedbackNote({ feedback }: { feedback: Feedback | null }) {
  if (!feedback) return null;
  return <p className={`event-feedback ${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>{feedback.text}</p>;
}

function localInput(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function toUtc(value: string): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

function localParts(value: string | null | undefined): { date: string; time: string } {
  const local = localInput(value);
  return local ? { date: local.slice(0, 10), time: local.slice(11, 16) } : { date: "", time: "" };
}

// NaN !== NaN, so comparing two unset/invalid times directly would read as
// "changed" even when both sides are simply empty - treat that case as
// unchanged instead.
function timesDiffer(localValue: string, isoValue: string | null | undefined): boolean {
  const a = localValue ? new Date(localValue).getTime() : NaN;
  const b = isoValue ? new Date(isoValue).getTime() : NaN;
  if (Number.isNaN(a) && Number.isNaN(b)) return false;
  return a !== b;
}

function EventDateTimeField({
  label,
  date,
  time,
  onDateChange,
  onTimeChange,
  invalid,
}: {
  label: string;
  date: string;
  time: string;
  onDateChange: (value: string) => void;
  onTimeChange: (value: string) => void;
  invalid: boolean;
}) {
  return <fieldset className="event-period-fieldset">
    <legend>{label}</legend>
    <label className="event-date-control"><span>Date</span><input type="date" value={date} onChange={(event) => onDateChange(event.target.value)} aria-label={`${label} date`} aria-invalid={invalid} /></label>
    <label className="event-date-control"><span>Time</span><input type="time" value={time} onChange={(event) => onTimeChange(event.target.value)} aria-label={`${label} time`} aria-invalid={invalid} /></label>
  </fieldset>;
}

export function EventPlanning() {
  const { signIn } = useAuth();
  const [events, setEvents] = useState<Event[]>([]);
  const [plans, setPlans] = useState<EventServicePlan[]>([]);
  const { selection, selectEvent, selectServicePlan, selectRevision } = useEventWorkspace();
  const { eventId: selectedEventId, servicePlanId: selectedPlanId, revisionId } = selection;
  const [eventName, setEventName] = useState("");
  const [eventDescription, setEventDescription] = useState("");
  const [owningTeam, setOwningTeam] = useState("");
  const [planName, setPlanName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [conflictOverrideReason, setConflictOverrideReason] = useState("");
  const [routes, setRoutes] = useState<ResourceOption[]>([]);
  const [geofences, setGeofences] = useState<EventGeofence[]>([]);
  const [locations, setLocations] = useState<ResourceOption[]>([]);
  // The selector needs id+label; the map needs coordinates, so the raw rows
  // are kept alongside rather than re-fetched.
  const [locationRecords, setLocationRecords] = useState<EventLocation[]>([]);
  const [operationalMessaging, setOperationalMessaging] = useState<EventOperationalMessaging | null>(null);
  const [routeIds, setRouteIds] = useState<string[]>([]);
  const [geofenceIds, setGeofenceIds] = useState<string[]>([]);
  const [locationIds, setLocationIds] = useState<string[]>([]);
  const [resourceFocus, setResourceFocus] = useState<ResourceKind>("routes");
  const [resourceSearch, setResourceSearch] = useState<Record<ResourceKind, string>>({ routes: "", geofences: "", locations: "" });
  const [resourceFocusRequest, setResourceFocusRequest] = useState(0);
  const [scopeView, setScopeView] = useState<"list" | "map">("list");
  const [feedback, setFeedback] = useState<Record<FeedbackScope, Feedback | null>>({ event: null, period: null, lifecycle: null, resources: null });
  const setFeedbackFor = (scope: FeedbackScope, text: string, kind: Feedback["kind"] = "success") =>
    setFeedback((prev) => ({ ...prev, [scope]: { text, kind } }));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // A 401 here means the session lapsed (common across OCC shift changes) -
  // "Try again" alone would just re-fire the same request and fail
  // identically, so that case gets its own message and a real sign-in
  // action instead of a dead-end retry.
  const [sessionExpired, setSessionExpired] = useState(false);
  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [eventSearch, setEventSearch] = useState("");

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    setSessionExpired(false);
    try {
      const [eventRows, planRows, routeRows, geofenceRows, locationRows, messagingRow] = await Promise.all([
        api.getEvents(), api.getEventServicePlans(), api.getRouteClassification(), api.getEventGeofences(), api.getEventLocations(), selectedPlanId ? api.getEventOperationalMessaging(selectedPlanId) : Promise.resolve(null),
      ]);
      setEvents(eventRows.events);
      setPlans(planRows.plans);
      setRoutes(routeRows.routes.filter((row) => row.route_category === "SpecialEvent" && row.is_active).map((row) => ({ id: String(row.route_id), label: `Route ${row.route_id}${row.route_label ? ` · ${row.route_label}` : ""}` })));
      setGeofences(geofenceRows.geofences.filter((row: EventGeofence) => row.is_active));
      const activeLocations = locationRows.locations.filter((row: EventLocation) => row.is_active);
      setLocations(activeLocations.map((row: EventLocation) => ({ id: row.id, label: `${row.name} · ${row.category}` })));
      setLocationRecords(activeLocations);
      setOperationalMessaging(messagingRow);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setSessionExpired(true);
        setLoadError("Your session has expired.");
      } else {
        setLoadError(err instanceof ApiError ? err.message : "Could not load Event Planning resources.");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [selectedPlanId]);

  const eventPlans = useMemo(() => selectedEventId ? plans.filter((row) => row.event_id === selectedEventId) : [], [plans, selectedEventId]);
  // An Event has no status of its own - "completed" is derived from its
  // plans: a season's worth of past Events would otherwise sit in the
  // picker at the same weight as the one still being planned.
  const isEventCompleted = (candidate: Event) => {
    const eventPlansFor = plans.filter((row) => row.event_id === candidate.id);
    return eventPlansFor.length > 0 && eventPlansFor.every((row) => row.status === "completed");
  };
  const sortedEvents = useMemo(
    () => [...events].sort((a, b) => Number(isEventCompleted(a)) - Number(isEventCompleted(b))),
    [events, plans],
  );
  const visibleEvents = useMemo(() => {
    const term = eventSearch.trim().toLowerCase();
    return term ? sortedEvents.filter((row) => [row.name, row.owning_team, row.description].filter(Boolean).some((value) => value!.toLowerCase().includes(term))) : sortedEvents;
  }, [sortedEvents, eventSearch]);
  const plan = plans.find((row) => row.id === selectedPlanId && (!selectedEventId || row.event_id === selectedEventId));
  const event = events.find((row) => row.id === (plan?.event_id ?? selectedEventId));
  const revision = plan?.revisions?.find((row) => row.id === revisionId) ?? plan?.revisions?.find((row) => ["draft", "review", "approved"].includes(row.status));
  const links = revision?.links ?? plan?.links ?? [];
  const counts = {
    routes: links.filter((link) => link.kind === "routes").length,
    geofences: links.filter((link) => link.kind === "geofences").length,
    locations: links.filter((link) => link.kind === "locations").length,
  };
  const linkedGeofences = geofences.filter((fence) => links.some((link) => link.kind === "geofences" && String(link.value) === fence.id));
  const messagingGeofences = linkedGeofences.filter((fence) => (fence.rules?.length ?? 0) > 0);
  const operationalGeofences = linkedGeofences.filter((fence) => (fence.rules?.length ?? 0) === 0);
  // Point at the specific geofence missing a rule (not just "somewhere in
  // Admin") so following the readiness item lands with it already selected,
  // instead of leaving the user to re-find it in a second dropdown.
  const geofenceMissingDirectionRule = linkedGeofences.find((fence) => (fence.rules?.length ?? 0) === 0);
  const startAt = startDate && startTime ? `${startDate}T${startTime}` : "";
  const endAt = endDate && endTime ? `${endDate}T${endTime}` : "";
  // `resource` and `focusId` let the Next action resolve a missing item to the
  // control that fixes it, instead of scrolling the page and leaving the user
  // to find it. `href` stays the escape hatch for the one item whose fix lives
  // on another route (Event Administration).
  const readiness: {
    label: string;
    ready: boolean;
    resource?: ResourceKind;
    focusId?: string;
    href?: string;
  }[] = [
    { label: "Event selected", ready: Boolean(event), focusId: "event-select" },
    { label: "Operating dates are valid", ready: Boolean(startAt && endAt && new Date(startAt).getTime() < new Date(endAt).getTime()), focusId: "event-plan-name" },
    { label: "Active SpecialEvent route linked", ready: counts.routes > 0, resource: "routes" },
    { label: "Geofence linked", ready: counts.geofences > 0, resource: "geofences" },
    { label: "Route conflicts reviewed", ready: !plan?.route_conflict || Boolean(conflictOverrideReason.trim()), focusId: "event-conflict-override" },
    {
      label: "Messaging geofence configured",
      ready: messagingGeofences.length > 0,
      href: geofenceMissingDirectionRule ? (() => {
        const query = new URLSearchParams({ geofence: geofenceMissingDirectionRule.id });
        if (selectedEventId) query.set("event", selectedEventId);
        if (selectedPlanId) query.set("plan", selectedPlanId);
        if (revisionId) query.set("revision", revisionId);
        return `/admin/events?${query}#event-configuration`;
      })() : undefined,
    },
  ];
  const readyToActivate = readiness.every((item) => item.ready);
  const editable = Boolean(plan && ["draft", "review"].includes(plan.status));
  const periodError = startAt && endAt && new Date(startAt).getTime() >= new Date(endAt).getTime()
    ? "End time must be later than the start time."
    : "";
  const periodReady = Boolean(planName.trim() && startAt && endAt && !periodError);
  // True when the visible name/date fields diverge from the currently
  // loaded plan - i.e. there are unsaved edits the [plan?.id] effect below
  // would silently overwrite if the user switched periods right now.
  const periodDirty = Boolean(plan && (
    planName.trim() !== plan.name ||
    timesDiffer(startAt, plan.start_at) ||
    timesDiffer(endAt, plan.end_at)
  ));
  const focusedResourceIds = resourceFocus === "routes" ? routeIds : resourceFocus === "geofences" ? geofenceIds : locationIds;
  const focusedResourceOptions = resourceFocus === "routes" ? routes : resourceFocus === "geofences" ? geofences.map((row) => ({ id: row.id, label: row.name })) : locations;
  const focusedResourceLabel = focusedResourceIds.length > 0
    ? focusedResourceOptions.find((row) => row.id === focusedResourceIds[0])?.label ?? "Selected resource"
    : resourceFocus === "routes" ? "Select a route" : resourceFocus === "geofences" ? "Select a geofence" : "Select a transit location";
  const setFocusedResourceIds = (values: string[]) => {
    if (resourceFocus === "routes") setRouteIds(values);
    else if (resourceFocus === "geofences") setGeofenceIds(values);
    else setLocationIds(values);
  };
  const visibleResourceOptions = focusedResourceOptions.filter((row) => row.label.toLowerCase().includes(resourceSearch[resourceFocus].trim().toLowerCase()));
  const focusResource = (kind: ResourceKind) => {
    setResourceFocus(kind);
    setResourceFocusRequest((request) => request + 1);
  };

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => document.getElementById(`event-${resourceFocus}-select`)?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [resourceFocus, resourceFocusRequest]);

  useEffect(() => {
    if (!showCreateEvent) return;
    const frame = window.requestAnimationFrame(() => document.getElementById("new-event-name")?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [showCreateEvent]);

  useEffect(() => {
    // Reset even when there's no plan (e.g. after switching Events) -
    // otherwise these fields keep showing the previous plan's data
    // displayed against a new, unrelated Event.
    setPlanName(plan?.name ?? "");
    setConflictOverrideReason("");
    const start = localParts(plan?.start_at); const end = localParts(plan?.end_at);
    setStartDate(start.date); setStartTime(start.time); setEndDate(end.date); setEndTime(end.time);
  }, [plan?.id]);

  async function createEvent() {
    if (!eventName.trim()) return;
    try {
      const created = await api.createEvent({ name: eventName.trim(), description: eventDescription.trim() || null, owning_team: owningTeam.trim() || null });
      setEventName(""); setEventDescription(""); setOwningTeam(""); selectEvent(created.id); setFeedbackFor("event", "Event created. Add an Event Plan to begin planning."); await load();
    } catch (err) { setFeedbackFor("event", err instanceof ApiError ? err.message : "Could not create Event.", "error"); }
  }

  async function createPlan() {
    if (!selectedEventId || !periodReady) return;
    try {
      const created = await api.createEventServicePlan({ name: planName.trim(), event_id: selectedEventId, start_at: toUtc(startAt), end_at: toUtc(endAt) });
      setPlanName(""); selectServicePlan(created.id); setFeedbackFor("period", "Draft Event Plan created."); await load();
    } catch (err) { setFeedbackFor("period", err instanceof ApiError ? err.message : "Could not create Event Plan.", "error"); }
  }

  // Recurring Events reuse their routes, geofences and locations almost
  // unchanged; the dates are what actually differ each time. So the copy
  // carries the scope and deliberately leaves the operating period unset -
  // which lands the new draft on "Operating dates are valid" as its first
  // outstanding readiness item, pointing straight at the thing that changed.
  async function duplicatePlanWithScope() {
    if (!plan) return;
    const sourceLinks = plan.links ?? [];
    try {
      const created = await api.createEventServicePlan({ name: `${plan.name} (copy)`, event_id: plan.event_id });
      const results = await Promise.allSettled(sourceLinks.map((link) => api.linkEventServicePlan(created.id, link.kind, link.value)));
      const failed = results.filter((result) => result.status === "rejected").length;
      selectServicePlan(created.id);
      setFeedbackFor(
        "period",
        failed > 0
          ? `Copied ${sourceLinks.length - failed} of ${sourceLinks.length} resources from ${plan.name}. Re-add the ${failed} that failed, then set the operating dates.`
          : `Copied ${sourceLinks.length} resource${sourceLinks.length === 1 ? "" : "s"} from ${plan.name}. Set the operating dates for this run.`,
        failed > 0 ? "error" : "success",
      );
      await load();
    } catch (err) {
      setFeedbackFor("period", err instanceof ApiError ? err.message : "Could not copy this Event Plan.", "error");
    }
  }

  async function savePlanDetails() {
    if (!plan || !periodReady) return;
    try { await api.updateEventServicePlan(plan.id, { name: planName.trim() || plan.name, start_at: toUtc(startAt), end_at: toUtc(endAt) }); setFeedbackFor("period", "Event Plan saved."); await load(); }
    catch (err) { setFeedbackFor("period", err instanceof ApiError ? err.message : "Could not save Event Plan.", "error"); }
  }

  async function linkMany(kind: "routes" | "geofences" | "locations", values: string[]) {
    if (!plan || values.length === 0) return;
    const singular = kind.slice(0, -1);
    const alreadyLinked = new Set(links.filter((existing) => existing.kind === kind).map((existing) => String(existing.value)));
    const toAdd = values.filter((value) => !alreadyLinked.has(value));
    const skipped = values.length - toAdd.length;
    if (toAdd.length === 0) {
      setFocusedResourceIds([]);
      setFeedbackFor("resources", `Those ${kind} are already linked to ${plan.name}.`, "error");
      return;
    }
    const results = await Promise.allSettled(toAdd.map((value) => api.linkEventServicePlan(plan.id, kind, kind === "routes" ? Number(value) : value, revision?.id)));
    const failedValues = toAdd.filter((_value, index) => results[index].status === "rejected");
    setFocusedResourceIds(failedValues);
    const failedLabels = failedValues.map((value) => focusedResourceOptions.find((option) => option.id === value)?.label ?? value);
    const succeeded = results.filter((result) => result.status === "fulfilled").length;
    const failed = results.length - succeeded;
    const parts = [
      succeeded > 0 ? `${succeeded} ${succeeded === 1 ? singular : kind} added` : null,
      failed > 0 ? `${failed} failed${failedLabels.length ? `: ${failedLabels.join(", ")}` : ""}` : null,
      skipped > 0 ? `${skipped} already linked` : null,
    ].filter(Boolean);
    setFeedbackFor("resources", `${parts.join(", ")} to ${plan.name}.`, failed > 0 ? "error" : "success");
    if (succeeded > 0) await load();
  }

  async function unlink(kind: "routes" | "geofences" | "locations", value: string | number, label: string) {
    if (!plan) return;
    const singular = kind.slice(0, -1);
    if (!window.confirm(`Remove ${singular} "${label}" from ${plan.name}?`)) return;
    try { await api.unlinkEventServicePlan(plan.id, kind, value, revision?.id); setFeedbackFor("resources", `${singular} removed from ${plan.name}.`); await load(); }
    catch (err) { setFeedbackFor("resources", err instanceof ApiError ? err.message : `Could not remove ${kind}.`, "error"); }
  }

  async function transition(action: "submit-review" | "approve" | "advance" | "complete" | "suspend") {
    if (!plan) return;
    if (action === "advance" && !window.confirm(`Activate Event Plan "${plan.name}" for internal Event AVL monitoring? This does not publish rider-facing communication.`)) return;
    if (action === "suspend" && !window.confirm(`Suspend operations for "${plan.name}"? This pauses live Event AVL monitoring.`)) return;
    if (action === "complete" && !window.confirm(`Complete Event Plan "${plan.name}"? This closes the Event Plan and removes it from active monitoring.`)) return;
    try { await api.transitionEventServicePlan(plan.id, action, conflictOverrideReason.trim() || undefined); setFeedbackFor("lifecycle", action === "advance" ? "Event Plan activated." : action === "complete" ? "Event Plan completed." : `Event Plan ${action === "submit-review" ? "submitted for review" : `${action}d`}.`); await load(); }
    catch (err) { setFeedbackFor("lifecycle", err instanceof ApiError ? err.message : "Could not update Event Plan.", "error"); }
  }

  async function prepareRevision() {
    if (!plan) return;
    try { const next = await api.modifyEventServicePlan(plan.id); selectRevision(next.id); setFeedbackFor("lifecycle", "Revision created; the active scope remains unchanged."); await load(); }
    catch (err) { setFeedbackFor("lifecycle", err instanceof ApiError ? err.message : "Could not create revision.", "error"); }
  }

  async function prepareRepair() {
    if (!plan) return;
    try { const repaired = await api.repairEventServicePlan(plan.id); selectServicePlan(repaired.id); setFeedbackFor("lifecycle", "Draft repair created from the approved Event Plan. Add or correct resources, then submit it for review."); await load(); }
    catch (err) { setFeedbackFor("lifecycle", err instanceof ApiError ? err.message : "Could not create a repair plan.", "error"); }
  }

  async function revise(action: "submit-review" | "approve" | "apply" | "reject") {
    if (!plan || !revision) return;
    if (action === "apply" && !window.confirm("Apply this revision to the active scope? This changes what's live in Event AVL immediately.")) return;
    try { await api.transitionEventServicePlanRevision(plan.id, revision.id, action); setFeedbackFor("lifecycle", `Revision ${action === "apply" ? "applied" : `${action}d`}.`); await load(); }
    catch (err) { setFeedbackFor("lifecycle", err instanceof ApiError ? err.message : "Could not update revision.", "error"); }
  }

  const activeStage = !selectedEventId || !plan
    ? "plan"
    : plan.status === "draft"
      ? "configure"
      : plan.status === "review"
        ? "review"
        : plan.status === "approved"
        ? "activate"
        : "activate";
  // The Next action used to scroll the page in every state, so its button - the
  // most prominent control here - moved the viewport instead of advancing the
  // work. Each state now carries what it actually does: `run` performs the
  // lifecycle transition outright, `reveal` selects the control that fixes a
  // missing readiness item, and `link` navigates. Nothing here is a bare
  // scroll, and the lifecycle transition is no longer duplicated further down
  // the page, so advancing an Event Plan never requires scrolling to find the
  // same button twice.
  const firstMissing = readiness.find((item) => !item.ready);
  const revealControl = (id: string) => {
    const target = document.getElementById(id);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (target instanceof HTMLElement) target.focus({ preventScroll: true });
  };
  const revealMissingItem = () => {
    if (!firstMissing) return;
    if (firstMissing.resource) { focusResource(firstMissing.resource); return; }
    if (firstMissing.focusId) revealControl(firstMissing.focusId);
  };
  type PlanningAction = {
    title: string;
    detail: string;
    label: string;
    run?: () => void;
    link?: string;
    disabled?: boolean;
  };
  const nextPlanningAction: PlanningAction = !selectedEventId
    ? { title: "Select an Event", detail: "Choose the Event this Event Plan belongs to.", label: "Select an Event", run: () => revealControl("event-select") }
    : !plan
      ? { title: "Create an Event Plan", detail: "Set the dates that define when this Event service will run.", label: "Name this Event Plan", run: () => revealControl("event-plan-name") }
      : plan.status === "draft" && !readyToActivate
        ? { title: `Complete activation checklist${firstMissing ? `: ${firstMissing.label}` : ""}`, detail: firstMissing?.href ? "This item is configured in Event Administration; your Event Plan context travels with you." : "Jump straight to the control that resolves this item.", label: firstMissing?.resource ? `Add ${firstMissing.resource}` : "Resolve this item", run: firstMissing?.href ? undefined : revealMissingItem, link: firstMissing?.href }
        : plan.status === "draft"
          ? { title: "Submit Event Plan for review", detail: "The operating scope is complete and ready for review.", label: "Submit Event Plan for review", run: () => void transition("submit-review") }
          : plan.status === "review"
            ? { title: "Approve Event Plan", detail: "Review the completed scope, then approve it for activation.", label: "Approve Event Plan", run: () => void transition("approve") }
            : plan.status === "approved"
              ? { title: "Activate Event Plan", detail: readyToActivate ? "Publishes the selected routes, geofences, rules, and locations to internal Event AVL." : `Blocked until every readiness check passes${firstMissing ? `: ${firstMissing.label}` : ""}.`, label: "Activate Event Plan", run: () => void transition("advance"), disabled: !readyToActivate }
              : plan.status === "active"
                ? { title: "Monitor in Event AVL", detail: "This Event Plan is active and ready for internal vehicle monitoring.", label: "Open Event AVL", link: `/events/avl?event=${encodeURIComponent(selectedEventId)}${plan ? `&plan=${encodeURIComponent(plan.id)}` : ""}` }
                : plan.status === "suspended"
                  ? { title: "Event Plan suspended", detail: "Event AVL monitoring is paused for this Event Plan.", label: "Complete Event Plan", run: () => void transition("complete") }
                  : { title: "Event Plan completed", detail: "This Event Plan is no longer active. Its scope and history remain available.", label: "Event Plan completed", disabled: true };

  return <div className="event-planning">
    <EventWorkspaceNav eventName={event?.name} planName={plan?.name} planStatus={plan ? displayStatus(plan.status) : undefined} activeStage={activeStage} />
    <p className="event-workspace-next" role="status">{plan?.status === "active" ? "This Event Plan is active. Monitor it in Event AVL." : selectedEventId ? "Define the Event Plan, add its resources, then activate it for Event AVL." : "Start by choosing an Event, then define its Event Plan."}</p>
    <div className="event-next-action" role="status" aria-label="Next planning action">
      <div>
        <span className="event-next-action-label">Next action</span>
        <strong>{nextPlanningAction.title}</strong>
        <p>{nextPlanningAction.detail}</p>
        {/* Activation needs a conflict reason, so the field lives in the card
            that activates - otherwise the one control standing between the
            operator and a live scope is somewhere further down the page. */}
        {plan?.status === "approved" && plan.route_conflict && <label className="event-conflict-override">Conflict override reason
          <input id="event-conflict-override" className="f" value={conflictOverrideReason} onChange={(event) => setConflictOverrideReason(event.target.value)} placeholder="Explain why this route overlap is intentional" aria-label="Conflict override reason" />
        </label>}
      </div>
      {nextPlanningAction.link
        ? <Link id="event-avl-link" className="btn-primary" to={nextPlanningAction.link}>{nextPlanningAction.label}</Link>
        : <button className="btn-primary" disabled={nextPlanningAction.disabled || !nextPlanningAction.run} onClick={nextPlanningAction.run}>{nextPlanningAction.label}</button>}
    </div>
    {loadError && <div className="event-inline-error" role="alert">
      <span>{loadError}{sessionExpired ? " Sign in again to continue." : ""}</span>
      {sessionExpired
        ? <button className="btn-sm" onClick={signIn}>Sign in again</button>
        : <button className="btn-sm" onClick={() => void load()}>Try again</button>}
    </div>}
    {loading && <p className="muted" role="status">Loading Events, Event Plans, and reusable resources…</p>}
    <div className="event-scope-builder">
    <div className="event-scope-builder-heading">
      <div><span className="event-workspace-kicker">Event workspace{event ? ` · ${event.name}` : ""}</span><h2>Event Plan builder</h2></div>
      <p>Assemble the complete operational scope in one place, then move it through review and activation.</p>
    </div>
    <div className="event-scope-builder-grid">
    <section id="planned-operating-resources" className="event-scope-column">
      <h3>Plan details</h3>
      <p className="panel-desc">Choose the Event and define the time-bounded Event Plan that owns this service scope.</p>
      <FeedbackNote feedback={feedback.event} />
      <div className="event-search-control">
        <label htmlFor="event-search">Find an Event</label>
        <div className="event-search-row"><input id="event-search" type="search" className="f" value={eventSearch} onChange={(e) => setEventSearch(e.target.value)} aria-describedby="event-search-help" placeholder="Search by Event, team, or description" />{eventSearch && <button className="btn-sm" type="button" onClick={() => setEventSearch("")}>Clear</button>}</div>
        <small id="event-search-help">Filters the Event selector below; it does not search Event Plan names.</small>
      </div>
      <select id="event-select" className="f" value={selectedEventId} onChange={(e) => {
        if (periodDirty && !window.confirm(`Discard unsaved changes to "${plan?.name}" and switch Events?`)) return;
        selectEvent(e.target.value);
      }} aria-label="Selected Event"><option value="">{eventSearch && visibleEvents.length === 0 ? "No matching Events" : "Select Event"}</option>{visibleEvents.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
      {event && <p className="muted"><strong>{event.name}</strong>{event.owning_team ? ` · ${event.owning_team}` : ""}{event.description ? ` · ${event.description}` : ""}</p>}
      {!loading && !loadError && events.length === 0 && <div className="event-empty-state" role="status">
        <div><strong>Create your first Event</strong><p>Start an Event workspace, then add its Event Plan and operational scope.</p></div>
        <button className="btn-primary" type="button" onClick={() => { setShowCreateEvent(true); window.requestAnimationFrame(() => document.getElementById("new-event-name")?.focus()); }}>Create your first Event</button>
      </div>}
      <button className="btn-sm event-create-toggle" type="button" onClick={() => setShowCreateEvent((visible) => !visible)}>{showCreateEvent ? "Cancel new Event" : event ? "Create another Event" : "Create an Event"}</button>
      {event && !showCreateEvent && <button className="btn-sm" type="button" onClick={() => {
        setEventName(`${event.name} (copy)`.slice(0, 120));
        setEventDescription(event.description ?? "");
        setOwningTeam(event.owning_team ?? "");
        setShowCreateEvent(true);
      }}>Duplicate this Event</button>}
      {showCreateEvent && <div className="event-create-form">
        <input id="new-event-name" className="f" value={eventName} maxLength={120} onChange={(e) => setEventName(e.target.value)} aria-label="New Event name" placeholder="New Event name" />
        <input className="f" value={owningTeam} maxLength={120} onChange={(e) => setOwningTeam(e.target.value)} aria-label="Owning team" placeholder="Owning team" />
        <input className="f" value={eventDescription} maxLength={500} onChange={(e) => setEventDescription(e.target.value)} aria-label="Event description" placeholder="Event description" />
        <button className="btn-sm" disabled={!eventName.trim()} onClick={() => void createEvent()}>Create Event</button>
      </div>}
      <div className="event-scope-divider" />
      <h3>Event Plan details</h3>
      <p className="panel-desc">An Event Plan is this Event’s time-bounded operational scope. Times use MVTA-local time.</p>
      <p id="event-plan-help" className="muted">{selectedEventId ? "Give the Event Plan a name, then choose its local service dates and times. The end must be later than the start." : "Select an Event above before creating an Event Plan."}</p>
      <FeedbackNote feedback={feedback.period} />
      {selectedEventId && <>
        <div className="event-period-form">
          <select id="event-plan-select" className="f" value={selectedPlanId} onChange={(e) => {
            if (periodDirty && !window.confirm(`Discard unsaved changes to "${plan?.name}" and switch Event Plans?`)) return;
            selectServicePlan(e.target.value);
          }} aria-label="Selected Event Plan"><option value="">Select Event Plan</option>{eventPlans.map((row) => <option key={row.id} value={row.id}>{row.name} · {displayStatus(row.status)}</option>)}</select>
          <input id="event-plan-name" className="f" value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="Example: State Fair · Friday evening" aria-label="Event Plan name" aria-describedby="event-plan-help" />
          <EventDateTimeField label="Starts" date={startDate} time={startTime} onDateChange={setStartDate} onTimeChange={setStartTime} invalid={Boolean(periodError)} />
          <EventDateTimeField label="Ends" date={endDate} time={endTime} onDateChange={setEndDate} onTimeChange={setEndTime} invalid={Boolean(periodError)} />
          <button className="btn-primary" disabled={!periodReady} onClick={() => void (plan ? savePlanDetails() : createPlan())}>{plan ? "Save Event Plan details" : "Create Event Plan"}</button>
        </div>
        {periodError && <p className="event-field-error" role="alert">{periodError}</p>}
      </>}
      {plan && <>
        <p className="muted">Current Event Plan: <strong>{plan.name}</strong> · {plan.start_at ? new Date(plan.start_at).toLocaleString() : "time not configured"} – {plan.end_at ? new Date(plan.end_at).toLocaleString() : "time not configured"}</p>
        <div className="actions event-scope-actions">
          {editable && <button className="btn-sm" disabled={!periodReady} onClick={() => void savePlanDetails()}>Save draft</button>}
          <button className="btn-sm" onClick={() => void duplicatePlanWithScope()}>Copy to a new Event Plan</button>
        </div>
      </>}
    </section>
    <section id="scope-resources" className="event-scope-column">
      <h3>Scope resources</h3>
      {!plan ? <p className="muted">Create or select an Event Plan to add routes, geofences, and transit locations.</p> : <>
        <p className="panel-desc">Each resource becomes a visible part of the Event AVL handoff. Select a resource type to add it to the scope.</p>
        {/* Geofences and transit locations are places, so they can be chosen
            on the map. Routes have no geometry in this system - special service
            is absent from the GTFS schedule - so the list stays the way routes
            are picked, and remains a complete alternative for everything. */}
        <div className="event-scope-view-toggle" role="group" aria-label="Scope resource view">
          <button className="btn-sm" aria-pressed={scopeView === "list"} onClick={() => setScopeView("list")}>List</button>
          <button className="btn-sm" aria-pressed={scopeView === "map"} onClick={() => setScopeView("map")}>Map</button>
        </div>
        {scopeView === "map" && <Suspense fallback={<p className="event-scope-map-state">Loading the scope map…</p>}>
          <EventScopeMap
            geofences={geofences}
            locations={locationRecords}
            linkedGeofenceIds={links.filter((link) => link.kind === "geofences").map((link) => String(link.value))}
            linkedLocationIds={links.filter((link) => link.kind === "locations").map((link) => String(link.value))}
            onToggleGeofence={(fence, isLinked) => void (isLinked ? unlink("geofences", fence.id, fence.name) : linkMany("geofences", [fence.id]))}
            onToggleLocation={(location, isLinked) => void (isLinked ? unlink("locations", location.id, location.name) : linkMany("locations", [location.id]))}
            disabled={!editable && !revision}
          />
        </Suspense>}
        <div className="event-resource-canvas">
          <div className="event-resource-list">
            <div className={`event-resource-card ${resourceFocus === "routes" ? "selected" : ""}`}>
              <span><strong>Routes</strong><small>{counts.routes} active route{counts.routes === 1 ? "" : "s"} linked</small></span><button className="btn-sm" aria-pressed={resourceFocus === "routes"} aria-controls="event-resource-selector" onClick={() => focusResource("routes")}>Manage routes</button>
            </div>
            <div className={`event-resource-card ${resourceFocus === "geofences" ? "selected" : ""}`}>
              <span><strong>Geofences</strong><small>{counts.geofences} linked · required for alerts</small></span><button className="btn-sm" aria-pressed={resourceFocus === "geofences"} aria-controls="event-resource-selector" onClick={() => focusResource("geofences")}>Add geofence</button>
            </div>
            <div className={`event-resource-card ${resourceFocus === "locations" ? "selected" : ""}`}>
              <span><strong>Transit locations</strong><small>{counts.locations} reference point{counts.locations === 1 ? "" : "s"} linked</small></span><button className="btn-sm" aria-pressed={resourceFocus === "locations"} aria-controls="event-resource-selector" onClick={() => focusResource("locations")}>Add location</button>
            </div>
          </div>
          <div id="event-resource-selector" className="next event-selected-resource" role="region" aria-live="polite" aria-label={`${resourceFocus} resource selector`}>
            <strong>Selected resource</strong><span className="muted">{focusedResourceLabel}</span>
            <p className="muted">{resourceFocus === "geofences" ? "A geofence defines where crossing detection and operational alerts begin." : resourceFocus === "routes" ? "A route determines which active SpecialEvent service vehicles belong to this scope." : "A transit location provides a destination or reference point for operations."}</p>
            <input id={`event-${resourceFocus}-select`} className="f" type="search" value={resourceSearch[resourceFocus]} onChange={(e) => setResourceSearch((current) => ({ ...current, [resourceFocus]: e.target.value }))} placeholder={`Search ${resourceFocus}`} aria-label={`Search ${resourceFocus}`} />
            <div className="event-resource-options" role="group" aria-label={`Select ${resourceFocus}`}>
              {visibleResourceOptions.length === 0 ? <p className="event-resource-empty">No matching {resourceFocus}.</p> : visibleResourceOptions.map((row) => <label className="event-resource-option" key={row.id}><input type="checkbox" checked={focusedResourceIds.includes(row.id)} onChange={(e) => setFocusedResourceIds(e.target.checked ? [...focusedResourceIds, row.id] : focusedResourceIds.filter((id) => id !== row.id))} /> <span>{row.label}</span></label>)}
            </div>
            <div className="actions"><button className="btn-sm" disabled={focusedResourceIds.length === 0 || (!editable && !revision)} onClick={() => void linkMany(resourceFocus, focusedResourceIds)}>Add selected {resourceFocus === "routes" ? "routes" : resourceFocus === "geofences" ? "geofences" : "locations"}</button><button className="btn-sm" onClick={() => focusResource(resourceFocus)}>Open selector</button></div>
          </div>
        </div>
        <p className="muted event-resource-counts">{counts.routes} routes · {counts.geofences} geofences · {counts.locations} locations linked.</p>
        {links.length > 0 && <div className="event-linked-resource-list"><strong>Linked resources</strong>{links.map((link, index) => <div className="event-linked-resource" key={`${link.kind}-${link.value}-${index}`}><span>{link.label}</span><button className="btn-sm danger" aria-label={`Remove ${link.label}`} disabled={!editable && !revision} onClick={() => void unlink(link.kind, link.value, link.label)}>Remove</button></div>)}</div>}
        {counts.geofences > 0 && <div className="subcard event-geofence-roles"><strong>Geofence roles</strong><p className="muted">Operational geofences define monitored boundaries. Messaging geofences are the linked boundaries with direction rules; their crossings create operational notifications. Both roles stay in this same Event Plan and activate together.</p><div><strong>Operational only</strong><span>{operationalGeofences.length ? operationalGeofences.map((fence) => fence.name).join(", ") : "None"}</span></div><div><strong>Messaging enabled</strong><span>{messagingGeofences.length ? messagingGeofences.map((fence) => fence.name).join(", ") : "None configured"}</span></div></div>}
      </>}
    </section>
    </div>
    </div>
    {plan && <>
      <FeedbackNote feedback={feedback.resources} />
      <div className="event-activation-gate"><strong>Activation readiness</strong><span>{readiness.filter((item) => item.ready).length} of {readiness.length} readiness checks complete. The Event Plan cannot activate until all operational resources are valid.</span></div>
      {/* Shown from draft onward, not just at `approved`. Draft is the longest
          phase and the one where items are actually outstanding - gating the
          itemized list (and its repair links) behind the activate step meant it
          only appeared once every item was already satisfied. */}
      <div className="event-readiness" role="group" aria-label="Activation readiness">
        <strong>{readyToActivate ? "Ready to activate" : "Activation checklist"}</strong>
        {readiness.map((item) => <span key={item.label} className={item.ready ? "ready" : "missing"} aria-label={`${item.ready ? "Complete" : "Missing"}: ${item.label}`}>{item.ready ? "✓" : "!"} {!item.ready && item.href ? <Link to={item.href}>{item.label}</Link> : item.label}</span>)}
      </div>
      <h2 id="event-plan-lifecycle" className="panel-header" style={{ marginTop: 24 }}>Review &amp; activate</h2>
      <div className="panel-body">
        <p className="panel-desc">Confirm the Event Plan below, then use the single next action. Activation publishes the selected routes, geofences, rules, and locations to internal Event AVL. When an active Event Plan has finished, use <strong>Complete Event Plan</strong> to close it; corrections still require a reviewed revision.</p>
        <p className="muted"><strong>Internal delivery:</strong> {operationalMessaging?.automatic_teams_enabled ? `Teams on · ${operationalMessaging.teams_destination}` : "Off · eligible notifications remain queued in Event AVL"}</p>
        <div className="subcard event-review-evidence" aria-label="Event Plan review evidence">
          <strong>Review evidence</strong>
          <dl>
            <div><dt>Event</dt><dd>{event?.name ?? "Not selected"}</dd></div>
            <div><dt>Event Plan</dt><dd>{plan.start_at ? `${new Date(plan.start_at).toLocaleString()} – ${new Date(plan.end_at ?? plan.start_at).toLocaleString()}` : "Not configured"} · MVTA-local time</dd></div>
            <div><dt>Routes</dt><dd>{links.filter((link) => link.kind === "routes").map((link) => link.label).join(", ") || "None"}</dd></div>
            <div><dt>Geofences</dt><dd>{links.filter((link) => link.kind === "geofences").map((link) => link.label).join(", ") || "None"}</dd></div>
            <div><dt>Transit locations</dt><dd>{links.filter((link) => link.kind === "locations").map((link) => link.label).join(", ") || "None"}</dd></div>
            <div><dt>Snapshot</dt><dd>{plan.published_scope ? "Published operational snapshot" : "Will publish atomically at activation"}</dd></div>
            {plan.route_conflict && <div><dt>Conflict override</dt><dd>{conflictOverrideReason.trim() || "Reason required before activation"}</dd></div>}
          </dl>
        </div>
        <ol className="event-plan-steps" aria-label="Event Plan lifecycle">
          {steps.map((step) => {
            // A suspended plan has passed through "active" (there's no
            // transition back), so it renders as the last completed step
            // here; the callout right below is what actually communicates
            // the paused state.
            const currentIndex = plan.status === "suspended" ? steps.indexOf("active") : steps.indexOf(plan.status);
            const isCurrent = plan.status !== "suspended" && step === plan.status;
            const isPast = !isCurrent && steps.indexOf(step) <= currentIndex;
            return <li key={step} className={isPast ? "is-past" : undefined} aria-current={isCurrent ? "step" : undefined} aria-label={isPast ? `Completed step: ${statusLabels[step]}` : undefined}>{statusLabels[step]}</li>;
          })}
        </ol>
        {plan.status === "suspended" && <p className="warn-note">Suspended — Event AVL monitoring is paused for this Event Plan.</p>}
        <FeedbackNote feedback={feedback.lifecycle} />
        {/* The primary transition lives in the Next action card at the top of
            the page. Repeating it here was the second of two identical buttons
            and the reason advancing a plan meant scrolling to the bottom. */}
        <p className="muted event-lifecycle-pointer">Use <strong>{nextPlanningAction.label}</strong> in the Next action panel at the top of this page to advance this Event Plan.</p>
        {/* Completion is not the "next" thing an operator does with a live
            Event Plan - monitoring is - so it sits with the other deliberate
            active-plan controls rather than in the Next action card. */}
        {plan.status === "active" && <div className="event-lifecycle-secondary">
          <span className="event-lifecycle-secondary-label">Active Event Plan controls:</span>
          <button className="btn-sm" onClick={() => void prepareRevision()}>Modify active scope</button>
          <button className="btn-sm danger" onClick={() => void transition("suspend")}>Suspend operations</button>
          <button className="btn-sm" onClick={() => void transition("complete")}>Complete Event Plan</button>
        </div>}
        {plan.status === "approved" && <div className="event-lifecycle-secondary">
          <span className="event-lifecycle-secondary-label">Need to correct the approved scope?</span>
          <button className="btn-sm" onClick={() => void prepareRepair()}>Modify plan</button>
        </div>}
        {revision && <div className="subcard event-revision-card">
          <div className="event-revision-card-header"><strong>Pending revision</strong><span className="pill-sm pill-accent">{displayStatus(revision.status)}</span></div>
          <p className="muted">The active scope remains unchanged until this revision is applied.</p>
          {revision.status === "draft" && <button className="btn-primary" onClick={() => void revise("submit-review")}>Submit revision for review</button>}
          {revision.status === "review" && <button className="btn-primary" onClick={() => void revise("approve")}>Approve revision</button>}
          {revision.status === "approved" && <button className="btn-primary" onClick={() => void revise("apply")}>Apply revision to active scope</button>}
          <button className="btn-sm" onClick={() => selectRevision("")}>Clear revision</button>
        </div>}
      </div>
    </>}
  </div>;
}
