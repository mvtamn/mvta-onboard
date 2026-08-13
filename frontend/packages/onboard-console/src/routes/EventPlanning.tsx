import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, type Event, type EventGeofence, type EventLocation, type EventServicePlan } from "@mvta/shared";
import { api } from "../config.js";
import { useAuth } from "../auth/AuthContext.js";
import { useEventWorkspace } from "../context/EventWorkspaceContext.js";
import { EventWorkspaceNav } from "../components/EventWorkspaceNav.js";

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

// NaN !== NaN, so comparing two unset/invalid times directly would read as
// "changed" even when both sides are simply empty - treat that case as
// unchanged instead.
function timesDiffer(localValue: string, isoValue: string | null | undefined): boolean {
  const a = localValue ? new Date(localValue).getTime() : NaN;
  const b = isoValue ? new Date(isoValue).getTime() : NaN;
  if (Number.isNaN(a) && Number.isNaN(b)) return false;
  return a !== b;
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
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [routes, setRoutes] = useState<ResourceOption[]>([]);
  const [geofences, setGeofences] = useState<EventGeofence[]>([]);
  const [locations, setLocations] = useState<ResourceOption[]>([]);
  const [routeIds, setRouteIds] = useState<string[]>([]);
  const [geofenceIds, setGeofenceIds] = useState<string[]>([]);
  const [locationIds, setLocationIds] = useState<string[]>([]);
  const [resourceFocus, setResourceFocus] = useState<ResourceKind>("routes");
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
      const [eventRows, planRows, routeRows, geofenceRows, locationRows] = await Promise.all([
        api.getEvents(), api.getEventServicePlans(), api.getRouteClassification(), api.getEventGeofences(), api.getEventLocations(),
      ]);
      setEvents(eventRows.events);
      setPlans(planRows.plans);
      setRoutes(routeRows.routes.filter((row) => row.route_category === "SpecialEvent" && row.is_active).map((row) => ({ id: String(row.route_id), label: `Route ${row.route_id}${row.route_label ? ` · ${row.route_label}` : ""}` })));
      setGeofences(geofenceRows.geofences.filter((row: EventGeofence) => row.is_active));
      setLocations(locationRows.locations.filter((row: EventLocation) => row.is_active).map((row: EventLocation) => ({ id: row.id, label: `${row.name} · ${row.category}` })));
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

  useEffect(() => { void load(); }, []);

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
    return term ? sortedEvents.filter((row) => row.name.toLowerCase().includes(term)) : sortedEvents;
  }, [sortedEvents, eventSearch]);
  const plan = plans.find((row) => row.id === selectedPlanId && (!selectedEventId || row.event_id === selectedEventId));
  const event = events.find((row) => row.id === (plan?.event_id ?? selectedEventId));
  const links = plan?.links ?? [];
  const revision = plan?.revisions?.find((row) => row.id === revisionId) ?? plan?.revisions?.find((row) => ["draft", "review", "approved"].includes(row.status));
  const counts = {
    routes: links.filter((link) => link.kind === "routes").length,
    geofences: links.filter((link) => link.kind === "geofences").length,
    locations: links.filter((link) => link.kind === "locations").length,
  };
  const linkedGeofences = geofences.filter((fence) => links.some((link) => link.kind === "geofences" && String(link.value) === fence.id));
  // Point at the specific geofence missing a rule (not just "somewhere in
  // Admin") so following the readiness item lands with it already selected,
  // instead of leaving the user to re-find it in a second dropdown.
  const geofenceMissingDirectionRule = linkedGeofences.find((fence) => (fence.rules?.length ?? 0) === 0);
  const readiness = [
    { label: "Event selected", ready: Boolean(event) },
    { label: "Operating dates are valid", ready: Boolean(startAt && endAt && new Date(startAt).getTime() < new Date(endAt).getTime()) },
    { label: "Active SpecialEvent route linked", ready: counts.routes > 0 },
    { label: "Geofence linked", ready: counts.geofences > 0 },
    {
      label: "Every linked geofence has a direction rule",
      ready: linkedGeofences.length > 0 && linkedGeofences.every((fence) => (fence.rules?.length ?? 0) > 0),
      href: geofenceMissingDirectionRule ? `/admin?geofence=${geofenceMissingDirectionRule.id}#event-configuration` : undefined,
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
  const focusResource = (kind: ResourceKind) => {
    setResourceFocus(kind);
    window.requestAnimationFrame(() => document.getElementById(`event-${kind}-select`)?.focus());
  };

  useEffect(() => {
    // Reset even when there's no plan (e.g. after switching Events) -
    // otherwise these fields keep showing the previous plan's data
    // displayed against a new, unrelated Event.
    setPlanName(plan?.name ?? "");
    setStartAt(localInput(plan?.start_at));
    setEndAt(localInput(plan?.end_at));
  }, [plan?.id]);

  async function createEvent() {
    if (!eventName.trim()) return;
    try {
      const created = await api.createEvent({ name: eventName.trim(), description: eventDescription.trim() || null, owning_team: owningTeam.trim() || null });
      setEventName(""); setEventDescription(""); setOwningTeam(""); selectEvent(created.id); setFeedbackFor("event", "Event created. Add an operating period to begin planning."); await load();
    } catch (err) { setFeedbackFor("event", err instanceof ApiError ? err.message : "Could not create Event.", "error"); }
  }

  async function createPlan() {
    if (!selectedEventId || !periodReady) return;
    try {
      const created = await api.createEventServicePlan({ name: planName.trim(), event_id: selectedEventId, start_at: toUtc(startAt), end_at: toUtc(endAt) });
      setPlanName(""); selectServicePlan(created.id); setFeedbackFor("period", "Draft operating period created."); await load();
    } catch (err) { setFeedbackFor("period", err instanceof ApiError ? err.message : "Could not create operating period.", "error"); }
  }

  async function savePlanDetails() {
    if (!plan || !periodReady) return;
    try { await api.updateEventServicePlan(plan.id, { name: planName.trim() || plan.name, start_at: toUtc(startAt), end_at: toUtc(endAt) }); setFeedbackFor("period", "Operating period saved."); await load(); }
    catch (err) { setFeedbackFor("period", err instanceof ApiError ? err.message : "Could not save operating period.", "error"); }
  }

  async function linkMany(kind: "routes" | "geofences" | "locations", values: string[], clearSelection: () => void) {
    if (!plan || values.length === 0) return;
    const singular = kind.slice(0, -1);
    const alreadyLinked = new Set(links.filter((existing) => existing.kind === kind).map((existing) => String(existing.value)));
    const toAdd = values.filter((value) => !alreadyLinked.has(value));
    const skipped = values.length - toAdd.length;
    clearSelection();
    if (toAdd.length === 0) {
      setFeedbackFor("resources", `Those ${kind} are already linked to ${plan.name}.`, "error");
      return;
    }
    const results = await Promise.allSettled(toAdd.map((value) => api.linkEventServicePlan(plan.id, kind, kind === "routes" ? Number(value) : value, revision?.id)));
    const succeeded = results.filter((result) => result.status === "fulfilled").length;
    const failed = results.length - succeeded;
    const parts = [
      succeeded > 0 ? `${succeeded} ${succeeded === 1 ? singular : kind} added` : null,
      failed > 0 ? `${failed} failed` : null,
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
    if (action === "advance" && !window.confirm(`Activate "${plan.name}" for Event AVL? This publishes the scope live to riders.`)) return;
    if (action === "suspend" && !window.confirm(`Suspend operations for "${plan.name}"? This pauses live Event AVL monitoring.`)) return;
    try { await api.transitionEventServicePlan(plan.id, action); setFeedbackFor("lifecycle", action === "advance" ? "Operating period activated." : `Operating period ${action === "submit-review" ? "submitted for review" : `${action}d`}.`); await load(); }
    catch (err) { setFeedbackFor("lifecycle", err instanceof ApiError ? err.message : "Could not update operating period.", "error"); }
  }

  async function prepareRevision() {
    if (!plan) return;
    try { const next = await api.modifyEventServicePlan(plan.id); selectRevision(next.id); setFeedbackFor("lifecycle", "Revision created; the active scope remains unchanged."); await load(); }
    catch (err) { setFeedbackFor("lifecycle", err instanceof ApiError ? err.message : "Could not create revision.", "error"); }
  }

  async function prepareRepair() {
    if (!plan) return;
    try { const repaired = await api.repairEventServicePlan(plan.id); selectServicePlan(repaired.id); setFeedbackFor("lifecycle", "Draft repair created from the approved operating period. Add or correct resources, then submit it for review."); await load(); }
    catch (err) { setFeedbackFor("lifecycle", err instanceof ApiError ? err.message : "Could not create a repair plan.", "error"); }
  }

  async function revise(action: "submit-review" | "approve" | "apply" | "reject") {
    if (!plan || !revision) return;
    if (action === "apply" && !window.confirm("Apply this revision to the active scope? This changes what's live in Event AVL immediately.")) return;
    try { await api.transitionEventServicePlanRevision(plan.id, revision.id, action); setFeedbackFor("lifecycle", `Revision ${action === "apply" ? "applied" : `${action}d`}.`); await load(); }
    catch (err) { setFeedbackFor("lifecycle", err instanceof ApiError ? err.message : "Could not update revision.", "error"); }
  }

  const nextAction = plan?.status === "draft" ? "submit-review" : plan?.status === "review" ? "approve" : plan?.status === "approved" ? "advance" : plan?.status === "active" ? "complete" : null;
  const activeStage = !selectedEventId || !plan
    ? "plan"
    : plan.status === "draft"
      ? "configure"
      : plan.status === "review" || plan.status === "approved"
        ? "activate"
        : "monitor";
  const nextPlanningAction = !selectedEventId
    ? { title: "Select an Event", detail: "Choose the Event this operating period belongs to.", target: "event-select" }
    : !plan
      ? { title: "Create an operating period", detail: "Set the dates that define when this Event service will run.", target: "operating-period-name" }
      : plan.status === "draft" && !readyToActivate
        ? { title: `Complete activation checklist${readiness.find((item) => !item.ready) ? `: ${readiness.find((item) => !item.ready)?.label}` : ""}`, detail: "Add the missing operational resource or rule before submitting this period for review.", target: "planned-operating-resources" }
        : plan.status === "draft"
          ? { title: "Submit for review", detail: "The operating scope is complete and ready for review.", target: "operating-period-lifecycle" }
          : plan.status === "review"
            ? { title: "Approve operating period", detail: "Review the completed scope, then approve it for activation.", target: "operating-period-lifecycle" }
            : plan.status === "approved"
              ? { title: "Activate for Event AVL", detail: "Publish this validated scope so Event AVL and geofence alerts can use it.", target: "operating-period-lifecycle" }
              : plan.status === "active"
                ? { title: "Monitor in Event AVL", detail: "This operating period is live and ready for vehicle monitoring.", target: "event-avl-link" }
                : { title: "Operating period completed", detail: "This period is no longer active.", target: "operating-period-lifecycle" };
  const focusNextPlanningAction = () => {
    if (nextPlanningAction.target === "event-avl-link") return;
    const target = document.getElementById(nextPlanningAction.target);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (target instanceof HTMLElement && target.matches("input, select, button")) target.focus();
  };

  return <div className="event-planning">
    <EventWorkspaceNav eventName={event?.name} planName={plan?.name} planStatus={plan?.status} activeStage={activeStage} />
    <p className="event-workspace-next" role="status">{plan?.status === "active" ? "This operating scope is active. Monitor it in Event AVL." : selectedEventId ? "Define the operating period, add its resources, then activate it for Event AVL." : "Start by choosing an Event, then define its operating period."}</p>
    <div className="event-next-action" role="status" aria-label="Next planning action">
      <div><span className="event-next-action-label">Next action</span><strong>{nextPlanningAction.title}</strong><p>{nextPlanningAction.detail}</p></div>
      {nextPlanningAction.target === "event-avl-link" ? <Link id="event-avl-link" className="btn-primary" to={`/event-monitoring?event=${encodeURIComponent(selectedEventId)}${plan ? `&plan=${encodeURIComponent(plan.id)}` : ""}`}>Open Event AVL</Link> : <button className="btn-primary" onClick={focusNextPlanningAction}>{nextPlanningAction.title}</button>}
    </div>
    {loadError && <div className="event-inline-error" role="alert">
      <span>{loadError}{sessionExpired ? " Sign in again to continue." : ""}</span>
      {sessionExpired
        ? <button className="btn-sm" onClick={signIn}>Sign in again</button>
        : <button className="btn-sm" onClick={() => void load()}>Try again</button>}
    </div>}
    {loading && <p className="muted" role="status">Loading Events, operating periods, and reusable resources…</p>}
    <div className="event-scope-builder">
    <div className="event-scope-builder-heading">
      <div><span className="event-workspace-kicker">Event workspace{event ? ` · ${event.name}` : ""}</span><h2>Operating scope builder</h2></div>
      <p>Assemble the complete service plan in one place, then move it through review and activation.</p>
    </div>
    <div className="event-scope-builder-grid">
    <section id="planned-operating-resources" className="event-scope-column">
      <h3>Plan details</h3>
      <p className="panel-desc">Choose the Event and define the time-bounded operating period that owns this service scope.</p>
      <FeedbackNote feedback={feedback.event} />
      <input type="search" className="f" value={eventSearch} onChange={(e) => setEventSearch(e.target.value)} aria-label="Search Events" placeholder="Search Events…" style={{ marginBottom: 6 }} />
      <select id="event-select" className="f" value={selectedEventId} onChange={(e) => {
        if (periodDirty && !window.confirm(`Discard unsaved changes to "${plan?.name}" and switch Events?`)) return;
        selectEvent(e.target.value);
      }} aria-label="Selected Event"><option value="">Select Event</option>{visibleEvents.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
      {event && <p className="muted"><strong>{event.name}</strong>{event.owning_team ? ` · ${event.owning_team}` : ""}{event.description ? ` · ${event.description}` : ""}</p>}
      <button className="btn-sm event-create-toggle" type="button" onClick={() => setShowCreateEvent((visible) => !visible)}>{showCreateEvent ? "Cancel new Event" : event ? "Create another Event" : "Create an Event"}</button>
      {event && !showCreateEvent && <button className="btn-sm" type="button" onClick={() => {
        setEventName(event.name);
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
      <h3>Operating period</h3>
      <p className="panel-desc">An operating period is this Event’s time-bounded Service Plan. Times use your MVTA-local browser time.</p>
      <p id="operating-period-help" className="muted">{selectedEventId ? "Name, start, and end are required. End must be later than start." : "Select an Event above before creating an operating period."}</p>
      <FeedbackNote feedback={feedback.period} />
      {selectedEventId && <>
        <div className="event-period-form">
          <select id="operating-period-select" className="f" value={selectedPlanId} onChange={(e) => {
            if (periodDirty && !window.confirm(`Discard unsaved changes to "${plan?.name}" and switch operating periods?`)) return;
            selectServicePlan(e.target.value);
          }} aria-label="Selected operating period"><option value="">Select operating period</option>{eventPlans.map((row) => <option key={row.id} value={row.id}>{row.name} · {row.status}</option>)}</select>
          <input id="operating-period-name" className="f" value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="Operating period name" aria-label="Operating period name" aria-describedby="operating-period-help" />
          <label className="f">Starts <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} aria-label="Operating period start" aria-invalid={Boolean(periodError)} aria-describedby="operating-period-help" /></label>
          <label className="f">Ends <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} aria-label="Operating period end" aria-invalid={Boolean(periodError)} aria-describedby="operating-period-help" /></label>
          <button className="btn-sm" disabled={!periodReady} onClick={() => void createPlan()}>Create new operating period</button>
        </div>
        {periodError && <p className="event-field-error" role="alert">{periodError}</p>}
      </>}
      {plan && <>
        <p className="muted">Current operating period: <strong>{plan.name}</strong> · {plan.start_at ? new Date(plan.start_at).toLocaleString() : "time not configured"} – {plan.end_at ? new Date(plan.end_at).toLocaleString() : "time not configured"}</p>
        {editable && <div className="actions event-scope-actions"><button className="btn-sm" disabled={!periodReady} onClick={() => void savePlanDetails()}>Save draft</button></div>}
      </>}
    </section>
    <section className="event-scope-column">
      <h3>Scope resources</h3>
      {!plan ? <p className="muted">Create or select an operating period to add routes, geofences, and transit locations.</p> : <>
        <p className="panel-desc">Each resource becomes a visible part of the Event AVL handoff. Select a resource type to add it to the scope.</p>
        <div className="event-resource-canvas">
          <div className="event-resource-list">
            <div className={`event-resource-card ${resourceFocus === "routes" ? "selected" : ""}`}>
              <span><strong>Routes</strong><small>{counts.routes} active route{counts.routes === 1 ? "" : "s"} linked</small></span><button className="btn-sm" onClick={() => focusResource("routes")}>Manage routes</button>
            </div>
            <div className={`event-resource-card ${resourceFocus === "geofences" ? "selected" : ""}`}>
              <span><strong>Geofences</strong><small>{counts.geofences} linked · required for alerts</small></span><button className="btn-sm" onClick={() => focusResource("geofences")}>Add geofence</button>
            </div>
            <div className={`event-resource-card ${resourceFocus === "locations" ? "selected" : ""}`}>
              <span><strong>Transit locations</strong><small>{counts.locations} reference point{counts.locations === 1 ? "" : "s"} linked</small></span><button className="btn-sm" onClick={() => focusResource("locations")}>Add location</button>
            </div>
          </div>
          <div className="next event-selected-resource">
            <strong>Selected resource</strong><span className="muted">{focusedResourceLabel}</span>
            <p className="muted">{resourceFocus === "geofences" ? "A geofence defines where crossing detection and operational alerts begin." : resourceFocus === "routes" ? "A route determines which active SpecialEvent service vehicles belong to this scope." : "A transit location provides a destination or reference point for operations."}</p>
            <select id={`event-${resourceFocus}-select`} multiple className="f" value={focusedResourceIds} onChange={(e) => setFocusedResourceIds(Array.from(e.target.selectedOptions, (option) => option.value))} aria-label={resourceFocus === "routes" ? "Event service route" : resourceFocus === "geofences" ? "Geofence" : "Transit location"}>
              {focusedResourceOptions.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}
            </select>
            <div className="actions"><button className="btn-sm" disabled={focusedResourceIds.length === 0 || (!editable && !revision)} onClick={() => void linkMany(resourceFocus, focusedResourceIds, () => setFocusedResourceIds([]))}>Add selected {resourceFocus === "routes" ? "routes" : resourceFocus === "geofences" ? "geofences" : "locations"}</button><button className="btn-sm" onClick={() => focusResource(resourceFocus)}>Open selector</button></div>
          </div>
        </div>
        <p className="muted event-resource-counts">{counts.routes} routes · {counts.geofences} geofences · {counts.locations} locations linked.</p>
        {links.length > 0 && <div className="event-linked-resource-list"><strong>Linked resources</strong>{links.map((link, index) => <div className="event-linked-resource" key={`${link.kind}-${link.value}-${index}`}><span>{link.label}</span><button className="btn-sm danger" disabled={!editable && !revision} onClick={() => void unlink(link.kind, link.value, link.label)}>Remove</button></div>)}</div>}
      </>}
    </section>
    </div>
    </div>
    {plan && <>
      <FeedbackNote feedback={feedback.resources} />
      <div className="event-activation-gate"><strong>Activation gate</strong><span>{readiness.filter((item) => item.ready).length} of {readiness.length} readiness checks complete. The plan cannot activate until all operational resources are valid.</span></div>
      <div id="operating-period-lifecycle" className="panel-header" style={{ marginTop: 24 }}>4. Review and activate operating period</div>
      <div className="panel-body">
        <p className="panel-desc">Move this operating period from draft through review and approval. Activation publishes its validated scope for Event AVL; completion ends monitoring. Changes to an active period require a reviewed revision.</p>
        <ol className="event-plan-steps" aria-label="Operating period lifecycle">
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
        {plan.status === "suspended" && <p className="warn-note">Suspended — Event AVL monitoring is paused for this operating period.</p>}
        <FeedbackNote feedback={feedback.lifecycle} />
        {nextAction === "advance" && <div className="event-readiness" role="group" aria-label="Activation readiness"><strong>{readyToActivate ? "Ready to activate" : "Activation checklist"}</strong>{readiness.map((item) => <span key={item.label} className={item.ready ? "ready" : "missing"} aria-label={`${item.ready ? "Complete" : "Missing"}: ${item.label}`}>{item.ready ? "✓" : "!"} {!item.ready && item.href ? <Link to={item.href}>{item.label}</Link> : item.label}</span>)}</div>}
        {nextAction && <button className="btn-primary" disabled={nextAction === "advance" && !readyToActivate} onClick={() => void transition(nextAction)}>{nextAction === "submit-review" ? "Submit for review" : nextAction === "approve" ? "Approve operating period" : nextAction === "advance" ? "Activate for Event AVL" : "Complete operating period"}</button>}
        {plan.status === "active" && <div className="event-lifecycle-secondary">
          <span className="event-lifecycle-secondary-label">Other actions:</span>
          <button className="btn-sm" onClick={() => void prepareRevision()}>Prepare revision</button>
          <button className="btn-sm danger" onClick={() => void transition("suspend")}>Suspend operations</button>
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
