import { useEffect, useMemo, useState } from "react";
import { ApiError, type Event, type EventGeofence, type EventLocation, type EventServicePlan } from "@mvta/shared";
import { api } from "../config.js";
import { useEventWorkspace } from "../context/EventWorkspaceContext.js";
import { EventWorkspaceNav } from "../components/EventWorkspaceNav.js";

const steps: EventServicePlan["status"][] = ["draft", "review", "approved", "active", "suspended", "completed"];
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

  const load = async () => {
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
      setMessage(err instanceof ApiError ? err.message : "Could not load Event Planning resources.");
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
    if (!selectedEventId || !planName.trim() || !startAt || !endAt) return;
    try {
      const created = await api.createEventServicePlan({ name: planName.trim(), event_id: selectedEventId, start_at: toUtc(startAt), end_at: toUtc(endAt) });
      setPlanName(""); selectServicePlan(created.id); setMessage("Draft operating period created."); await load();
    } catch (err) { setMessage(err instanceof ApiError ? err.message : "Could not create operating period."); }
  }

  async function savePlanDetails() {
    if (!plan || !startAt || !endAt) return;
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

  return <>
    <EventWorkspaceNav eventName={event?.name} planName={plan?.name} planStatus={plan?.status} />
    <div className="panel-header">Event Planning</div>
    <div className="panel-body">
      <p className="panel-desc">Create an Event, define its operating period, assemble the complete operating scope, and activate it for Event AVL. Admin maintains reusable map resources; Planning selects them.</p>
      {message && <p className="muted" role="status">{message}</p>}
      <h3>Event identity</h3>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <select className="f" value={selectedEventId} onChange={(e) => selectEvent(e.target.value)}><option value="">Select Event</option>{events.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
        <input className="f" value={eventName} onChange={(e) => setEventName(e.target.value)} placeholder="New Event name" />
        <input className="f" value={owningTeam} onChange={(e) => setOwningTeam(e.target.value)} placeholder="Owning team" />
        <input className="f" value={eventDescription} onChange={(e) => setEventDescription(e.target.value)} placeholder="Event description" />
        <button className="btn-sm" disabled={!eventName.trim()} onClick={() => void createEvent()}>Create Event</button>
      </div>
      {event && <p className="muted"><strong>{event.name}</strong>{event.owning_team ? ` · ${event.owning_team}` : ""}{event.description ? ` · ${event.description}` : ""}</p>}
    </div>

    <div className="panel-header" style={{ marginTop: 24 }}>Event operating periods</div>
    <div className="panel-body">
      <p className="panel-desc">An operating period is the timestamped Service Plan that controls one Event scope. Overnight periods are supported using MVTA-local browser time.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <select className="f" value={selectedPlanId} onChange={(e) => selectServicePlan(e.target.value)}><option value="">Select operating period</option>{eventPlans.map((row) => <option key={row.id} value={row.id}>{row.name} · {row.status}</option>)}</select>
        <input className="f" value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="Operating period name" />
        <label className="f">Starts <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} /></label>
        <label className="f">Ends <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} /></label>
        <button className="btn-sm" disabled={!selectedEventId || !planName.trim() || !startAt || !endAt} onClick={() => void createPlan()}>Create operating period</button>
      </div>
      {plan && <>
        <p className="muted">Current operating period: <strong>{plan.name}</strong> · {plan.start_at ? new Date(plan.start_at).toLocaleString() : "time not configured"} – {plan.end_at ? new Date(plan.end_at).toLocaleString() : "time not configured"}</p>
        {editable && <button className="btn-sm" onClick={() => void savePlanDetails()}>Save period details</button>}
      </>}
    </div>

    {plan && <>
      <div className="panel-header" style={{ marginTop: 24 }}>Operating period lifecycle</div>
      <div className="panel-body">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{steps.map((step) => <span key={step} className={step === plan.status ? "btn-sm" : "muted"} style={{ padding: "6px 10px", border: "1px solid #ccd6d1", borderRadius: 6 }}>{step}</span>)}</div>
        <p className="muted">Current state: <strong>{plan.status}</strong></p>
        {nextAction && <button className="btn-sm" disabled={nextAction === "advance" && !readyToActivate} onClick={() => void transition(nextAction)}>{nextAction === "submit-review" ? "Submit for review" : nextAction === "approve" ? "Approve operating period" : nextAction === "advance" ? "Activate operating period" : "Complete operating period"}</button>}
        {plan.status === "active" && <><button className="btn-sm" onClick={() => void prepareRevision()}>Prepare revision</button> <button className="btn-sm" onClick={() => void transition("suspend")}>Suspend operations</button></>}
        {revision && <div><p className="muted">Revision: <strong>{revision.status}</strong> · active scope remains unchanged until applied.</p>{revision.status === "draft" && <button className="btn-sm" onClick={() => void revise("submit-review")}>Submit revision</button>}{revision.status === "review" && <button className="btn-sm" onClick={() => void revise("approve")}>Approve revision</button>}{revision.status === "approved" && <button className="btn-sm" onClick={() => void revise("apply")}>Apply revision</button>}<button className="btn-sm" onClick={() => selectRevision("")}>Clear revision</button></div>}
        {nextAction === "advance" && <div className="event-readiness" aria-label="Activation readiness"><strong>{readyToActivate ? "Ready to activate" : "Activation checklist"}</strong>{readiness.map((item) => <span key={item.label} className={item.ready ? "ready" : "missing"}>{item.ready ? "✓" : "!"} {item.label}</span>)}</div>}
      </div>

      <div className="panel-header" style={{ marginTop: 24 }}>Planned operating resources</div>
      <div className="panel-body">
        <p className="panel-desc">Link multiple routes, geofences, and transit locations. Resource edits in Admin do not change this active scope until a reviewed revision is applied.</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select className="f" value={routeId} onChange={(e) => setRouteId(e.target.value)}><option value="">Select SpecialEvent route</option>{routes.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}</select><button className="btn-sm" disabled={!routeId || (!editable && !revision)} onClick={() => void link("routes")}>Add route</button>
          <select className="f" value={geofenceId} onChange={(e) => setGeofenceId(e.target.value)}><option value="">Select geofence</option>{geofences.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select><button className="btn-sm" disabled={!geofenceId || (!editable && !revision)} onClick={() => void link("geofences")}>Add geofence</button>
          <select className="f" value={locationId} onChange={(e) => setLocationId(e.target.value)}><option value="">Select transit location</option>{locations.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}</select><button className="btn-sm" disabled={!locationId || (!editable && !revision)} onClick={() => void link("locations")}>Add location</button>
        </div>
        <p className="muted">{counts.routes} routes · {counts.geofences} geofences · {counts.locations} locations linked.</p>
        <table className="data"><thead><tr><th>Type</th><th>Resource</th></tr></thead><tbody>{links.map((link, index) => <tr key={`${link.kind}-${link.value}-${index}`}><td>{link.kind.slice(0, -1)}</td><td>{link.label}</td></tr>)}</tbody></table>
      </div>
    </>}
  </>;
}
