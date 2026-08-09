import { useEffect, useRef, useState } from "react";
import * as atlas from "azure-maps-control";
import * as drawing from "azure-maps-drawing-tools";
import "azure-maps-control/dist/atlas.min.css";
import "azure-maps-drawing-tools/dist/atlas-drawing.min.css";
import { ApiError, type EventGeofence, type EventGeofenceRule, type EventLocation, type EventServicePlan, type EventLocationCategory } from "@mvta/shared";
import { api } from "../config.js";
import { useAuth } from "../auth/AuthContext.js";

const CENTER: atlas.data.Position = [-93.25, 44.83];
type Draft = { shape: atlas.Shape; kind: "geofence" | "location"; position?: atlas.data.Position };
type StoredFence = EventGeofence & { rules?: EventGeofenceRule[] };
type GeoFeature = atlas.data.Feature<atlas.data.Geometry, Record<string, unknown>>;

function geometryOf(shape: atlas.Shape): string | null {
  const feature = shape.toJson() as GeoFeature;
  return feature.geometry ? JSON.stringify(feature.geometry) : null;
}

function MapEditor({ geofences, locations, onChanged }: { geofences: StoredFence[]; locations: EventLocation[]; onChanged: () => void }) {
  const { account, signIn } = useAuth();
  const host = useRef<HTMLDivElement>(null); const mapRef = useRef<atlas.Map | null>(null); const drawingRef = useRef<drawing.drawing.DrawingManager | null>(null); const syncTimer = useRef<number | null>(null); const geofencesRef = useRef(geofences); geofencesRef.current = geofences;
  const [ready, setReady] = useState(false); const [draft, setDraft] = useState<Draft | null>(null); const [name, setName] = useState(""); const [category, setCategory] = useState<EventLocationCategory>("transit_station"); const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    api.getMapsToken().then((token) => {
      if (cancelled || !host.current) return;
      const map = new atlas.Map(host.current, { center: CENTER, zoom: 10, style: "road", authOptions: { authType: atlas.AuthenticationType.anonymous, clientId: token.client_id, getToken: (resolve, reject) => api.getMapsToken().then((next) => resolve(next.access_token)).catch(reject) } });
      mapRef.current = map;
      map.events.addOnce("ready", () => {
        if (cancelled) return;
        const toolbar = new drawing.control.DrawingToolbar({ buttons: ["draw-polygon", "draw-point", "edit-geometry", "erase-geometry"], position: atlas.ControlPosition.TopRight });
        const manager = new drawing.drawing.DrawingManager(map, { mode: drawing.drawing.DrawingMode.idle, interactionType: drawing.drawing.DrawingInteractionType.click, toolbar });
        drawingRef.current = manager; setReady(true);
        map.events.add("drawingcomplete", manager, (shape) => {
          const geo = shape.toJson() as GeoFeature;
          if (geo.geometry?.type === "Polygon") setDraft({ shape, kind: "geofence" });
          if (geo.geometry?.type === "Point") setDraft({ shape, kind: "location", position: geo.geometry.coordinates as atlas.data.Position });
          manager.setOptions({ mode: drawing.drawing.DrawingMode.idle });
        });
        map.events.add("drawingchanged", manager, (shape) => {
          const props = shape.toJson().properties as { id?: string; kind?: string } | undefined; const polygon = geometryOf(shape);
          if (!props?.id || props.kind !== "geofence" || !polygon) return;
          if (syncTimer.current) window.clearTimeout(syncTimer.current);
          syncTimer.current = window.setTimeout(() => {
            const fence = geofencesRef.current.find((row) => row.id === props.id); if (fence) void api.updateEventGeofence(fence.id, { name: fence.name, polygon }).then(onChanged).catch(() => undefined);
          }, 500);
        });
        map.events.add("drawingerased", manager, (shape) => {
          const props = shape.toJson().properties as { id?: string; kind?: string } | undefined;
          if (props?.id && props.kind === "geofence") void api.updateEventGeofence(props.id, { name: geofencesRef.current.find((f) => f.id === props.id)?.name ?? "Geofence", polygon: geometryOf(shape) ?? "", is_active: false }).then(onChanged).catch(() => undefined);
        });
      });
    }).catch((err) => setError(err instanceof ApiError && err.status === 401 ? "Your Microsoft session is not connected to the API. Sign in again to use map authoring." : err instanceof ApiError ? err.message : "Map unavailable."));
    return () => { cancelled = true; drawingRef.current?.dispose(); mapRef.current?.dispose(); drawingRef.current = null; mapRef.current = null; };
  }, []);

  useEffect(() => {
    const manager = drawingRef.current; const map = mapRef.current; if (!ready || !manager || !map) return;
    const source = manager.getSource(); source.clear();
    for (const fence of geofences) {
      try { const geometry = JSON.parse(fence.polygon) as atlas.data.Geometry; source.add(new atlas.Shape({ type: "Feature", geometry, properties: { id: fence.id, kind: "geofence" } })); } catch { /* invalid legacy geometry stays visible in the table */ }
    }
    map.markers.clear();
    locations.forEach((location) => map.markers.add(new atlas.HtmlMarker({ position: [location.longitude, location.latitude], htmlContent: `<div class="event-location-marker" title="${location.name}">●</div>` })));
  }, [geofences, locations, ready]);

  async function saveDraft() {
    if (!draft || !name.trim()) return;
    try {
      if (draft.kind === "geofence") { const geometry = geometryOf(draft.shape); if (!geometry) return; await api.createEventGeofence({ name: name.trim(), polygon: geometry }); }
      else if (draft.position) await api.createEventLocation({ name: name.trim(), category, latitude: draft.position[1], longitude: draft.position[0], notes: null });
      setDraft(null); setName(""); onChanged();
    } catch (err) { setError(err instanceof ApiError ? err.message : "Could not save map item."); }
  }

  if (!account) return <div className="evmon-map-message"><p>Sign in with your MVTA Microsoft 365 account to use map authoring.</p><button className="btn-primary" onClick={signIn}>Sign in with Microsoft</button></div>;
  return <div><div style={{ height: 420, borderRadius: 8, overflow: "hidden", border: "1px solid #ccd6d1", position: "relative" }}><div ref={host} style={{ width: "100%", height: "100%" }} />{!ready && !error && <div className="evmon-map-message">Loading map…</div>}{error && <div className="evmon-map-message"><p>{error}</p>{error.includes("session") && <button className="btn-primary" onClick={signIn}>Sign in again</button>}</div>}</div>{draft && <div className="panel-body" style={{ marginTop: 10, border: "1px solid #ccd6d1" }}><strong>Save new {draft.kind === "geofence" ? "geofence" : "map location"}</strong><div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}><input className="f" value={name} onChange={(e) => setName(e.target.value)} placeholder={draft.kind === "geofence" ? "Geofence name" : "Location name"} />{draft.kind === "location" && <select className="f" value={category} onChange={(e) => setCategory(e.target.value as EventLocationCategory)}><option value="transit_station">Transit station</option><option value="park_and_ride">Park & ride</option><option value="venue">Venue</option><option value="other">Other</option></select>}<button className="btn-sm" disabled={!name.trim()} onClick={() => void saveDraft()}>Save</button><button className="btn-sm" onClick={() => { drawingRef.current?.getSource().remove(draft.shape); setDraft(null); }}>Cancel</button></div></div>}</div>;
}

export function EventResourceMapEditor() {
  const [geofences, setGeofences] = useState<StoredFence[]>([]); const [locations, setLocations] = useState<EventLocation[]>([]); const [plans, setPlans] = useState<EventServicePlan[]>([]); const [routes, setRoutes] = useState<{ route_id: number; label: string | null; category: string }[]>([]); const [selectedFence, setSelectedFence] = useState(""); const [selectedLocation, setSelectedLocation] = useState(""); const [selectedRoute, setSelectedRoute] = useState(""); const [rule, setRule] = useState<Partial<EventGeofenceRule>>({ transition: "exit", heading_min: 0, heading_max: 360, send_mode: "manual", destination_label: "" }); const [planId, setPlanId] = useState(""); const [planName, setPlanName] = useState(""); const [message, setMessage] = useState<string | null>(null);
  const load = () => Promise.all([api.getEventGeofences(), api.getEventLocations(), api.getEventServicePlans(), api.getRouteClassification()]).then(([g, l, p, r]) => { setGeofences(g.geofences); setLocations(l.locations); setPlans(p.plans); setRoutes(r.routes.filter((row) => row.route_category === "SpecialEvent").map((row) => ({ route_id: row.route_id, label: row.route_label, category: row.route_category }))); if (!planId && p.plans[0]) setPlanId(p.plans[0].id); }).catch((err) => setMessage(err instanceof ApiError ? err.message : "Event resources are unavailable until migrations 033 and 034 are applied."));
  useEffect(() => { void load(); }, []);
  const selected = geofences.find((f) => f.id === selectedFence);
  async function addRule() { if (!selectedFence || !rule.destination_label) return; try { await api.addEventGeofenceRule(selectedFence, { transition: rule.transition as "enter" | "exit", heading_min: Number(rule.heading_min), heading_max: Number(rule.heading_max), destination_label: rule.destination_label, destination_location_id: rule.destination_location_id ?? null, send_mode: rule.send_mode as "manual" | "auto", sort_order: 0 }); setMessage("Direction rule saved."); void load(); } catch (err) { setMessage(err instanceof ApiError ? err.message : "Could not save direction rule."); } }
  async function deleteRule(ruleId: string) { if (!selectedFence || !window.confirm("Delete this direction rule?")) return; try { await api.deleteEventGeofenceRule(selectedFence, ruleId); setMessage("Direction rule deleted."); void load(); } catch (err) { setMessage(err instanceof ApiError ? err.message : "Could not delete direction rule."); } }
  async function link(kind: "geofences" | "locations") { const value = kind === "geofences" ? selectedFence : selectedLocation; if (!planId || !value) return; try { await api.linkEventServicePlan(planId, kind, value); setMessage(`${kind === "geofences" ? "Geofence" : "Location"} linked to service plan.`); } catch (err) { setMessage(err instanceof ApiError ? err.message : "Could not link service plan resource."); } }
  async function linkRoute() { if (!planId || !selectedRoute) return; try { await api.linkEventServicePlan(planId, "routes", Number(selectedRoute)); setMessage("Route linked to service plan."); void load(); } catch (err) { setMessage(err instanceof ApiError ? err.message : "Could not link route."); } }
  async function renameLocation(location: EventLocation) { const name = window.prompt("Location name", location.name)?.trim(); if (!name || name === location.name) return; try { await api.updateEventLocation(location.id, { name }); setMessage("Location updated."); void load(); } catch (err) { setMessage(err instanceof ApiError ? err.message : "Could not update location."); } }
  async function deactivateLocation(location: EventLocation) { if (!window.confirm(`Deactivate ${location.name}?`)) return; try { await api.updateEventLocation(location.id, { is_active: false }); setMessage("Location deactivated."); void load(); } catch (err) { setMessage(err instanceof ApiError ? err.message : "Could not deactivate location."); } }
  async function createPlan() { if (!planName.trim()) return; try { const plan = await api.createEventServicePlan(planName.trim()); setPlanName(""); setPlanId(plan.id); setMessage("Draft service plan created."); void load(); } catch (err) { setMessage(err instanceof ApiError ? err.message : "Could not create service plan."); } }
  return <><div className="panel-header" style={{ marginTop: 24 }}>Event Map Authoring</div><div className="panel-body"><p className="panel-desc">Use the visible toolbar to draw polygons around lots, stations, venues, or corridor checkpoints. Use the point tool to place transit stations and other reference locations. Existing polygons can be edited or erased directly on the map.</p>{message && <p className="muted">{message}</p>}<EventResourceMapEditorInner geofences={geofences} locations={locations} onChanged={load} /></div><div className="panel-header" style={{ marginTop: 24 }}>Direction Rules and Alerts</div><div className="panel-body"><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8 }}><select className="f" value={selectedFence} onChange={(e) => setSelectedFence(e.target.value)}><option value="">Select geofence</option>{geofences.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select><select className="f" value={rule.transition} onChange={(e) => setRule((r) => ({ ...r, transition: e.target.value as "enter" | "exit" }))}><option value="enter">Entering</option><option value="exit">Exiting</option></select><input className="f" type="number" min={0} max={360} value={rule.heading_min} onChange={(e) => setRule((r) => ({ ...r, heading_min: Number(e.target.value) }))} placeholder="Heading min" /><input className="f" type="number" min={0} max={360} value={rule.heading_max} onChange={(e) => setRule((r) => ({ ...r, heading_max: Number(e.target.value) }))} placeholder="Heading max" /><input className="f" value={rule.destination_label ?? ""} onChange={(e) => setRule((r) => ({ ...r, destination_label: e.target.value }))} placeholder="Destination / alert text" /><select className="f" value={rule.destination_location_id ?? ""} onChange={(e) => setRule((r) => ({ ...r, destination_location_id: e.target.value || null }))}><option value="">No mapped destination</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select><select className="f" value={rule.send_mode} onChange={(e) => setRule((r) => ({ ...r, send_mode: e.target.value as "manual" | "auto" }))}><option value="manual">Manual review</option><option value="auto">Auto-send</option></select><button className="btn-sm" disabled={!selectedFence || !rule.destination_label} onClick={() => void addRule()}>Add rule</button></div>{selected && <div style={{ marginTop: 12 }}><strong>{selected.name} rules</strong>{(selected.rules ?? []).length === 0 ? <p className="muted">No rules configured.</p> : <table className="data"><thead><tr><th>Transition</th><th>Heading</th><th>Destination</th><th>Mode</th><th>Action</th></tr></thead><tbody>{(selected.rules ?? []).map((item) => <tr key={item.id}><td>{item.transition}</td><td>{item.heading_min}°–{item.heading_max}°</td><td>{item.destination_label}</td><td>{item.send_mode}</td><td><button className="btn-sm" onClick={() => void deleteRule(item.id)}>Delete</button></td></tr>)}</tbody></table>}</div>}</div><div className="panel-header" style={{ marginTop: 24 }}>Service Plan Activation</div><div className="panel-body"><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><input className="f" value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="New service plan name" /><button className="btn-sm" disabled={!planName.trim()} onClick={() => void createPlan()}>Create draft plan</button><select className="f" value={planId} onChange={(e) => setPlanId(e.target.value)}><option value="">Select service plan</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.status})</option>)}</select><select className="f" value={selectedRoute} onChange={(e) => setSelectedRoute(e.target.value)}><option value="">Select SpecialEvent route</option>{routes.map((r) => <option key={r.route_id} value={r.route_id}>{r.route_id}{r.label ? ` · ${r.label}` : ""}</option>)}</select><button className="btn-sm" disabled={!planId || !selectedRoute} onClick={() => void linkRoute()}>Link route</button><button className="btn-sm" disabled={!planId || !selectedFence} onClick={() => void link("geofences")}>Link selected geofence</button><select className="f" value={selectedLocation} onChange={(e) => setSelectedLocation(e.target.value)}><option value="">Select location</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select><button className="btn-sm" disabled={!planId || !selectedLocation} onClick={() => void link("locations")}>Link selected location</button>{plans.find((p) => p.id === planId)?.status === "draft" && <button className="btn-sm" disabled={!plans.find((p) => p.id === planId)?.links?.some((l) => l.kind === "routes") || !plans.find((p) => p.id === planId)?.links?.some((l) => l.kind === "geofences")} onClick={() => void api.advanceEventServicePlan(planId).then(load)}>Advance to Active</button>}</div>{planId && <p className="muted">Linked resources: {(plans.find((p) => p.id === planId)?.links ?? []).length}. An active plan requires at least one route and one geofence.</p>}<p className="muted">Only resources linked to an active plan participate in event polling, crossing detection, and notifications.</p></div></>;
}

function EventResourceMapEditorInner(props: { geofences: StoredFence[]; locations: EventLocation[]; onChanged: () => void }) { return <MapEditor {...props} />; }
