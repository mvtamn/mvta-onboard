import { useEffect, useMemo, useState } from "react";
import { ApiError, type Event, type EventGeofence, type EventLocation, type EventServicePlan } from "@mvta/shared";
import { api } from "../config.js";
import { useEventWorkspace } from "../context/EventWorkspaceContext.js";
import { EventWorkspaceNav } from "../components/EventWorkspaceNav.js";

const steps: EventServicePlan["status"][] = ["draft", "review", "approved", "active", "suspended", "completed"];
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

export function EventPlanning() {
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
  const [routeId, setRouteId] = useState("");
  const [geofenceId, setGeofenceId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreateEvent, setShowCreateEvent] = useState(false);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
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
      setLoadError(err instanceof ApiError ? err.message : "Could not load Event Planning resources.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const eventPlans = useMemo(() => selectedEventId ? plans.filter((row) => row.event_id === selectedEventId) : [], [plans, selectedEventId]);
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
  const readiness = [
    { label: "Event selected", ready: Boolean(event) },
    { label: "Operating dates are valid", ready: Boolean(startAt && endAt && new Date(startAt).getTime() < new Date(endAt).getTime()) },
    { label: "SpecialEvent route linked", ready: counts.routes > 0 },
    { label: "Geofence linked", ready: counts.geofences > 0 },
    { label: "Every linked geofence has a direction rule", ready: linkedGeofences.length > 0 && linkedGeofences.every((fence) => (fence.rules?.length ?? 0) > 0) },
  ];
  const readyToActivate = readiness.every((item) => item.ready);
  const editable = Boolean(plan && ["draft", "review"].includes(plan.status));
  const periodError = startAt && endAt && new Date(startAt).getTime() >= new Date(endAt).getTime()
    ? "End time must be later than the start time."
    : "";
  const periodReady = Boolean(planName.trim() && startAt && endAt && !periodError);

  useEffect(() => {
    if (!plan) return;
    setPlanName(plan.name);
    setStartAt(localInput(plan.start_at));
    setEndAt(localInput(plan.end_at));
  }, [plan?.id]);

  async function createEvent() {
    if (!eventName.trim()) return;
    try {
      const created = await api.createEvent({ name: eventName.trim(), description: eventDescription.trim() || null, owning_team: owningTeam.trim() || null });
      setEventName(""); setEventDescription(""); setOwningTeam(""); selectEvent(created.id); setMessage("Event created. Add an operating period to begin planning."); await load();
    } catch (err) { setMessage(err instanceof ApiError ? err.message : "Could not create Event."); }
  }

  async function createPlan() {
    if (!selectedEventId || !periodReady) return;
    try {
      const created = await api.createEventServicePlan({ name: planName.trim(), event_id: selectedEventId, start_at: toUtc(startAt), end_at: toUtc(endAt) });
      setPlanName(""); selectServicePlan(created.id); setMessage("Draft operating period created."); await load();
    } catch (err) { setMessage(err instanceof ApiError ? err.message : "Could not create operating period."); }
  }

  async function savePlanDetails() {
    if (!plan || !periodReady) return;
    try { await api.updateEventServicePlan(plan.id, { name: planName.trim() || plan.name, start_at: toUtc(startAt), end_at: toUtc(endAt) }); setMessage("Operating period saved."); await load(); }
    catch (err) { setMessage(err instanceof ApiError ? err.message : "Could not save operating period."); }
  }

  async function link(kind: "routes" | "geofences" | "locations") {
    const value = kind === "routes" ? routeId : kind === "geofences" ? geofenceId : locationId;
    if (!plan || !value) return;
    try { await api.linkEventServicePlan(plan.id, kind, kind === "routes" ? Number(value) : value, revision?.id); setMessage(`${kind.slice(0, -1)} added to ${plan.name}.`); await load(); }
    catch (err) { setMessage(err instanceof ApiError ? err.message : `Could not add ${kind}.`); }
  }

  async function transition(action: "submit-review" | "approve" | "advance" | "complete" | "suspend") {
    if (!plan) return;
    try { await api.transitionEventServicePlan(plan.id, action); setMessage(action === "advance" ? "Operating period activated." : `Operating period ${action === "submit-review" ? "submitted for review" : `${action}d`}.`); await load(); }
    catch (err) { setMessage(err instanceof ApiError ? err.message : "Could not update operating period."); }
  }

  async function prepareRevision() {
    if (!plan) return;
    try { const next = await api.modifyEventServicePlan(plan.id); selectRevision(next.id); setMessage("Revision created; the active scope remains unchanged."); await load(); }
    catch (err) { setMessage(err instanceof ApiError ? err.message : "Could not create revision."); }
  }

  async function revise(action: "submit-review" | "approve" | "apply" | "reject") {
    if (!plan || !revision) return;
    try { await api.transitionEventServicePlanRevision(plan.id, revision.id, action); setMessage(`Revision ${action === "apply" ? "applied" : `${action}d`}.`); await load(); }
    catch (err) { setMessage(err instanceof ApiError ? err.message : "Could not update revision."); }
  }

  const nextAction = plan?.status === "draft" ? "submit-review" : plan?.status === "review" ? "approve" : plan?.status === "approved" ? "advance" : plan?.status === "active" ? "complete" : null;

  return <div className="event-planning">
    <EventWorkspaceNav eventName={event?.name} planName={plan?.name} planStatus={plan?.status} activeStage={plan?.status === "approved" || plan?.status === "active" ? "activate" : "plan"} />
    <p className="event-workspace-next" role="status">{plan?.status === "active" ? "This operating scope is active. Monitor it in Event AVL." : selectedEventId ? "Define the operating period, add its resources, then activate it for Event AVL." : "Start by choosing an Event, then define its operating period."}</p>
    {loadError && <div className="event-inline-error" role="alert"><span>{loadError}</span><button className="btn-sm" onClick={() => void load()}>Try again</button></div>}
    {loading && <p className="muted" role="status">Loading Events, operating periods, and reusable resources…</p>}
    {!loading && !loadError && !selectedEventId && <div className="event-planning-start" role="status">
      <div><strong>Start by selecting an Event</strong><p>Everything else on this page belongs to the selected Event. Choose an existing Event, or create one if this is a new service operation.</p></div>
      <button className="btn-sm" onClick={() => { if (events.length > 0) document.getElementById("event-select")?.focus(); else { setShowCreateEvent(true); window.requestAnimationFrame(() => document.getElementById("new-event-name")?.focus()); } }}>{events.length > 0 ? "Select an Event" : "Create an Event"}</button>
    </div>}
    <div className="event-planning-setup">
    <div className="event-planning-setup-block">
    <div className="panel-header">1. Choose an Event</div>
    <div className="panel-body">
      <p className="panel-desc">Choose the Event you are preparing. Then select or create its time-bounded operating period. Admin maintains reusable resources; Planning assembles them into this Event’s scope.</p>
      {message && <p className="muted" role="status">{message}</p>}
      <h3>Selected Event</h3>
      <select id="event-select" className="f" value={selectedEventId} onChange={(e) => selectEvent(e.target.value)} aria-label="Selected Event"><option value="">Select Event</option>{events.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
      {event && <p className="muted"><strong>{event.name}</strong>{event.owning_team ? ` · ${event.owning_team}` : ""}{event.description ? ` · ${event.description}` : ""}</p>}
      <button className="btn-sm event-create-toggle" type="button" onClick={() => setShowCreateEvent((visible) => !visible)}>{showCreateEvent ? "Cancel new Event" : event ? "Create another Event" : "Create an Event"}</button>
      {showCreateEvent && <div className="event-create-form">
        <input id="new-event-name" className="f" value={eventName} maxLength={120} onChange={(e) => setEventName(e.target.value)} aria-label="New Event name" placeholder="New Event name" />
        <input className="f" value={owningTeam} maxLength={120} onChange={(e) => setOwningTeam(e.target.value)} aria-label="Owning team" placeholder="Owning team" />
        <input className="f" value={eventDescription} maxLength={500} onChange={(e) => setEventDescription(e.target.value)} aria-label="Event description" placeholder="Event description" />
        <button className="btn-sm" disabled={!eventName.trim()} onClick={() => void createEvent()}>Create Event</button>
      </div>}
    </div>
    </div>

    <div className="event-planning-setup-block">
    <div className="panel-header" style={{ marginTop: 24 }}>2. Define operating period</div>
    <div className="panel-body">
      <p className="panel-desc">An operating period is this Event’s time-bounded Service Plan. Choose an existing period to review it, or enter a name and dates to create another. Times use your MVTA-local browser time.</p>
      <p id="operating-period-help" className="muted">{selectedEventId ? "Name, start, and end are required. End must be later than start." : "Select an Event above before creating an operating period."}</p>
      <div className="event-period-form">
        <select id="operating-period-select" className="f" value={selectedPlanId} onChange={(e) => selectServicePlan(e.target.value)} aria-label="Selected operating period"><option value="">Select operating period</option>{eventPlans.map((row) => <option key={row.id} value={row.id}>{row.name} · {row.status}</option>)}</select>
        <input id="operating-period-name" className="f" value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="Operating period name" aria-label="Operating period name" aria-describedby="operating-period-help" />
        <label className="f">Starts <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} aria-label="Operating period start" aria-invalid={Boolean(periodError)} aria-describedby="operating-period-help" /></label>
        <label className="f">Ends <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} aria-label="Operating period end" aria-invalid={Boolean(periodError)} aria-describedby="operating-period-help" /></label>
        <button className="btn-sm" disabled={!selectedEventId || !periodReady} onClick={() => void createPlan()}>Create new operating period</button>
      </div>
      {periodError && <p className="event-field-error" role="alert">{periodError}</p>}
      {plan && <>
        <p className="muted">Current operating period: <strong>{plan.name}</strong> · {plan.start_at ? new Date(plan.start_at).toLocaleString() : "time not configured"} – {plan.end_at ? new Date(plan.end_at).toLocaleString() : "time not configured"}</p>
        {editable && <button className="btn-sm" disabled={!periodReady} onClick={() => void savePlanDetails()}>Save period details</button>}
      </>}
    </div>
    </div>

    </div>
    {selectedEventId && !plan && <div className="event-planning-empty">
      <div><h3>Choose an operating period</h3><p>{event?.name ?? "This Event"} is selected. Create a new operating period or select an existing one to continue.</p></div>
      <div className="event-planning-empty-actions"><button className="btn-sm" onClick={() => document.getElementById("operating-period-name")?.focus()}>Start operating period</button><button className="btn-sm" onClick={() => document.getElementById("operating-period-select")?.focus()}>Select existing period</button></div>
    </div>}
    {plan && <>
      <div className="panel-header" style={{ marginTop: 24 }}>Operating period lifecycle</div>
      <div className="panel-body">
        <p className="panel-desc">Move the operating period through review before activating it for Event AVL. Changes to an active period require a reviewed revision.</p>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{steps.map((step) => <span key={step} className={step === plan.status ? "btn-sm" : "muted"} style={{ padding: "6px 10px", border: "1px solid #ccd6d1", borderRadius: 6 }}>{statusLabels[step]}</span>)}</div>
        <p className="muted">Current state: <strong>{statusLabels[plan.status]}</strong></p>
        {nextAction && <button className="btn-sm" disabled={nextAction === "advance" && !readyToActivate} onClick={() => void transition(nextAction)}>{nextAction === "submit-review" ? "Submit for review" : nextAction === "approve" ? "Approve operating period" : nextAction === "advance" ? "Activate for Event AVL" : "Complete operating period"}</button>}
        {plan.status === "active" && <><button className="btn-sm" onClick={() => void prepareRevision()}>Prepare revision</button> <button className="btn-sm" onClick={() => void transition("suspend")}>Suspend operations</button></>}
        {revision && <div><p className="muted">Pending revision: <strong>{displayStatus(revision.status)}</strong> · the active scope remains unchanged until this revision is applied.</p>{revision.status === "draft" && <button className="btn-sm" onClick={() => void revise("submit-review")}>Submit revision for review</button>}{revision.status === "review" && <button className="btn-sm" onClick={() => void revise("approve")}>Approve revision</button>}{revision.status === "approved" && <button className="btn-sm" onClick={() => void revise("apply")}>Apply revision to active scope</button>}<button className="btn-sm" onClick={() => selectRevision("")}>Clear revision</button></div>}
        {nextAction === "advance" && <div className="event-readiness" aria-label="Activation readiness"><strong>{readyToActivate ? "Ready to activate" : "Activation checklist"}</strong>{readiness.map((item) => <span key={item.label} className={item.ready ? "ready" : "missing"}>{item.ready ? "✓" : "!"} {item.label}</span>)}</div>}
      </div>

      <div className="panel-header" style={{ marginTop: 24 }}>Planned operating resources</div>
      <div className="panel-body">
        <p className="panel-desc">Add the routes, geofences, and transit locations this operating period will manage. These are reusable Admin resources; edits do not change the active scope until a reviewed revision is applied.</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select className="f" value={routeId} onChange={(e) => setRouteId(e.target.value)} aria-label="Event service route"><option value="">Select event service route</option>{routes.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}</select><button className="btn-sm" disabled={!routeId || (!editable && !revision)} onClick={() => void link("routes")}>Add route to plan</button>
          <select className="f" value={geofenceId} onChange={(e) => setGeofenceId(e.target.value)} aria-label="Geofence"><option value="">Select geofence</option>{geofences.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select><button className="btn-sm" disabled={!geofenceId || (!editable && !revision)} onClick={() => void link("geofences")}>Add geofence to plan</button>
          <select className="f" value={locationId} onChange={(e) => setLocationId(e.target.value)} aria-label="Transit location"><option value="">Select transit location</option>{locations.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}</select><button className="btn-sm" disabled={!locationId || (!editable && !revision)} onClick={() => void link("locations")}>Add location to plan</button>
        </div>
        <p className="muted">{counts.routes} routes · {counts.geofences} geofences · {counts.locations} locations linked.</p>
        <table className="data"><thead><tr><th>Type</th><th>Resource</th></tr></thead><tbody>{links.length > 0 ? links.map((link, index) => <tr key={`${link.kind}-${link.value}-${index}`}><td>{link.kind.slice(0, -1)}</td><td>{link.label}</td></tr>) : <tr><td colSpan={2} className="empty-note">No resources linked yet. Add at least one route and geofence before submitting for review.</td></tr>}</tbody></table>
      </div>
    </>}
  </div>;
}
