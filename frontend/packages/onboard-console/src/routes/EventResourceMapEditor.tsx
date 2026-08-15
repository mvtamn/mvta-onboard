import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import * as atlas from "azure-maps-control";
import * as drawing from "azure-maps-drawing-tools";
import "azure-maps-control/dist/atlas.min.css";
import "azure-maps-drawing-tools/dist/atlas-drawing.min.css";
import { ApiError, type EventGeofence, type EventGeofenceRule, type EventLocation, type EventLocationCategory } from "@mvta/shared";
import { api } from "../config.js";
import { useAuth } from "../auth/AuthContext.js";
import "./modules/eventMonitoring.css";

const CENTER: atlas.data.Position = [-93.25, 44.83];
type Draft = { shape: atlas.Shape; kind: "geofence" | "location"; position?: atlas.data.Position };
type StoredFence = EventGeofence & { rules?: EventGeofenceRule[] };
type GeoFeature = atlas.data.Feature<atlas.data.Geometry, Record<string, unknown>>;
const COMPASS_RANGES = { N: [337.5, 22.5], NE: [22.5, 67.5], E: [67.5, 112.5], SE: [112.5, 157.5], S: [157.5, 202.5], SW: [202.5, 247.5], W: [247.5, 292.5], NW: [292.5, 337.5] } as const;
type CompassDirection = keyof typeof COMPASS_RANGES | "any" | "custom";

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char] ?? char);
}

function geometryOf(shape: atlas.Shape): string | null {
  const feature = shape.toJson() as GeoFeature;
  return feature.geometry ? JSON.stringify(feature.geometry) : null;
}

function MapEditor({ geofences, locations, onChanged }: { geofences: StoredFence[]; locations: EventLocation[]; onChanged: () => void }) {
  const { account, signIn } = useAuth();
  const host = useRef<HTMLDivElement>(null); const mapRef = useRef<atlas.Map | null>(null); const drawingRef = useRef<drawing.drawing.DrawingManager | null>(null); const syncTimer = useRef<number | null>(null); const geofencesRef = useRef(geofences); geofencesRef.current = geofences;
  const [ready, setReady] = useState(false); const [draft, setDraft] = useState<Draft | null>(null); const [name, setName] = useState(""); const [category, setCategory] = useState<EventLocationCategory>("transit_station"); const [error, setError] = useState<string | null>(null); const [activeMode, setActiveMode] = useState<drawing.drawing.DrawingMode>(drawing.drawing.DrawingMode.idle); const [showGeofences, setShowGeofences] = useState(true); const [showInactiveGeofences, setShowInactiveGeofences] = useState(true); const [showLocations, setShowLocations] = useState(true); const [showInactiveLocations, setShowInactiveLocations] = useState(true); const [cursor, setCursor] = useState<atlas.data.Position | null>(null);

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
        map.events.add("mousemove", (event) => setCursor(event.position as atlas.data.Position));
        map.events.add("click", (event) => setCursor(event.position as atlas.data.Position));
        map.events.add("drawingmodechanged", manager, (mode) => setActiveMode(mode));
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
          if (props?.id && props.kind === "geofence") { const fence = geofencesRef.current.find((f) => f.id === props.id); if (fence) void api.updateEventGeofence(props.id, { name: fence.name, polygon: fence.polygon, is_active: false }).then(onChanged).catch(() => undefined); }
        });
      });
    }).catch((err) => setError(err instanceof ApiError && err.status === 401 ? "Your Microsoft session is not connected to the API. Sign in again to use map authoring." : err instanceof ApiError ? err.message : "Map unavailable."));
    return () => { cancelled = true; drawingRef.current?.dispose(); mapRef.current?.dispose(); drawingRef.current = null; mapRef.current = null; };
  }, [account]);

  useEffect(() => {
    const manager = drawingRef.current; const map = mapRef.current; if (!ready || !manager || !map) return;
    const source = manager.getSource(); source.clear();
    for (const fence of geofences.filter((row) => row.is_active ? showGeofences : showInactiveGeofences)) {
      try { const geometry = JSON.parse(fence.polygon) as atlas.data.Geometry; source.add(new atlas.Shape({ type: "Feature", geometry, properties: { id: fence.id, kind: "geofence" } })); } catch { /* invalid legacy geometry stays visible in the table */ }
    }
    map.markers.clear();
    locations.filter((location) => location.is_active ? showLocations : showInactiveLocations).forEach((location) => map.markers.add(new atlas.HtmlMarker({ position: [location.longitude, location.latitude], htmlContent: `<div class="event-authoring-location-marker ${location.is_active ? "is-active" : "is-inactive"}" title="${escapeHtml(location.name)}"><span class="event-authoring-location-dot">●</span><span class="event-authoring-location-label">${escapeHtml(location.name)}</span></div>` })));
  }, [geofences, locations, ready, showGeofences, showInactiveGeofences, showLocations, showInactiveLocations]);

  async function saveDraft() {
    if (!draft || !name.trim()) return;
    try {
      if (draft.kind === "geofence") { const geometry = geometryOf(draft.shape); if (!geometry) return; await api.createEventGeofence({ name: name.trim(), polygon: geometry }); }
      else if (draft.position) await api.createEventLocation({ name: name.trim(), category, latitude: draft.position[1], longitude: draft.position[0], notes: null });
      setDraft(null); setName(""); onChanged();
    } catch (err) { setError(err instanceof ApiError ? err.message : "Could not save map item."); }
  }

  if (!account) return <div className="evmon-map-message"><p>Sign in with your MVTA Microsoft 365 account to use map authoring.</p><button className="btn-primary" onClick={signIn}>Sign in with Microsoft</button></div>;
  const selectMode = (mode: drawing.drawing.DrawingMode) => { const manager = drawingRef.current; if (!manager) return; manager.setOptions({ mode, interactionType: drawing.drawing.DrawingInteractionType.click }); setActiveMode(mode); };
  return <div><div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}><button className="btn-sm" disabled={!ready} onClick={() => selectMode(drawing.drawing.DrawingMode.drawPolygon)}>Draw geofence</button><button className="btn-sm" disabled={!ready} onClick={() => selectMode(drawing.drawing.DrawingMode.drawPoint)}>Place location</button><button className="btn-sm" disabled={!ready} onClick={() => selectMode(drawing.drawing.DrawingMode.editGeometry)}>Edit boundary</button><button className="btn-sm" disabled={!ready} onClick={() => selectMode(drawing.drawing.DrawingMode.eraseGeometry)}>Deactivate boundary</button><button className="btn-sm" disabled={!ready} onClick={() => selectMode(drawing.drawing.DrawingMode.idle)}>Select</button><span className="muted">Mode: {activeMode === drawing.drawing.DrawingMode.drawPolygon ? "Drawing geofence — click vertices, double-click to finish" : activeMode === drawing.drawing.DrawingMode.drawPoint ? "Placing location — click the map" : `Mode: ${activeMode}`}</span><label className="muted"><input type="checkbox" checked={showGeofences} onChange={(e) => setShowGeofences(e.target.checked)} /> Active geofences</label><label className="muted"><input type="checkbox" checked={showInactiveGeofences} onChange={(e) => setShowInactiveGeofences(e.target.checked)} /> Inactive geofences</label><label className="muted"><input type="checkbox" checked={showLocations} onChange={(e) => setShowLocations(e.target.checked)} /> Active locations</label><label className="muted"><input type="checkbox" checked={showInactiveLocations} onChange={(e) => setShowInactiveLocations(e.target.checked)} /> Inactive locations</label></div><div style={{ height: 420, borderRadius: 8, overflow: "hidden", border: "1px solid #ccd6d1", position: "relative" }}><div ref={host} style={{ width: "100%", height: "100%" }} />{!ready && !error && <div className="evmon-map-message">Loading map…</div>}{error && <div className="evmon-map-message"><p>{error}</p>{error.includes("session") && <button className="btn-primary" onClick={signIn}>Sign in again</button>}</div>}</div>{cursor && <p className="muted">Live pointer coordinate: latitude {cursor[1].toFixed(6)}, longitude {cursor[0].toFixed(6)}</p>}{draft && <div className="panel-body" style={{ marginTop: 10, border: "1px solid #ccd6d1" }}><strong>Save new {draft.kind === "geofence" ? "geofence" : "map location"}</strong><div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}><input className="f" value={name} onChange={(e) => setName(e.target.value)} placeholder={draft.kind === "geofence" ? "Geofence name" : "Location name"} />{draft.kind === "location" && <select className="f" value={category} onChange={(e) => setCategory(e.target.value as EventLocationCategory)}><option value="transit_station">Transit station</option><option value="park_and_ride">Park & ride</option><option value="venue">Venue</option><option value="other">Other</option></select>}<button className="btn-sm" disabled={!name.trim()} onClick={() => void saveDraft()}>Save</button><button className="btn-sm" onClick={() => { drawingRef.current?.getSource().remove(draft.shape); setDraft(null); }}>Cancel</button></div></div>}<LocationManager locations={locations} onChanged={onChanged} /></div>;
}

function LocationManager({ locations, onChanged }: { locations: EventLocation[]; onChanged: () => void }) {
  async function rename(location: EventLocation) { const name = window.prompt("Location name", location.name)?.trim(); if (!name || name === location.name) return; await api.updateEventLocation(location.id, { name }); onChanged(); }
  async function deactivate(location: EventLocation) { if (!window.confirm(`Deactivate ${location.name}?`)) return; await api.updateEventLocation(location.id, { is_active: false }); onChanged(); }
  if (!locations.length) return null;
  return <table className="data" style={{ marginTop: 12 }}><thead><tr><th>Location</th><th>Category</th><th>Coordinates</th><th>Actions</th></tr></thead><tbody>{locations.map((location) => <tr key={location.id}><td>{location.name}</td><td>{location.category}</td><td>{location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}</td><td><button className="btn-sm" onClick={() => void rename(location)}>Rename</button>{" "}<button className="btn-sm" onClick={() => void deactivate(location)}>Deactivate</button></td></tr>)}</tbody></table>;
}

export function EventResourceMapEditor() {
  // Lets Event Planning's "Every linked geofence has a direction rule"
  // readiness item deep-link straight to the relevant geofence instead of
  // landing here with nothing selected - resolves once `geofences` loads
  // even though the id is read before that request resolves.
  const [searchParams] = useSearchParams();
  const [geofences, setGeofences] = useState<StoredFence[]>([]); const [locations, setLocations] = useState<EventLocation[]>([]); const [selectedFence, setSelectedFence] = useState(() => searchParams.get("geofence") ?? ""); const [editingRuleId, setEditingRuleId] = useState<string | null>(null); const [saving, setSaving] = useState(false); const [rule, setRule] = useState<Partial<EventGeofenceRule>>({ transition: "exit", heading_min: 0, heading_max: 360, send_mode: "manual", destination_label: "", sort_order: 0 }); const [directionPreset, setDirectionPreset] = useState<CompassDirection>("any"); const [message, setMessage] = useState<string | null>(null);
  const load = () => Promise.all([api.getEventGeofences(), api.getEventLocations()]).then(([g, l]) => { setGeofences(g.geofences); setLocations(l.locations); }).catch((err) => setMessage(err instanceof ApiError ? err.message : "Event resources are unavailable until migrations 033 and 034 are applied."));
  useEffect(() => { void load(); }, []);
  const selected = geofences.find((f) => f.id === selectedFence);
  // Priority (sort_order) must be unique per (geofence, transition) on the backend - see
  // functions-restapi/src/lib/eventDirectionRules.ts. Suggest the next free value so adding a
  // second message for the same direction doesn't silently collide with the first one's default.
  function nextPriorityFor(fenceId: string, transition: "enter" | "exit", justSaved?: { transition: "enter" | "exit"; sort_order: number }): number {
    const used = (geofences.find((f) => f.id === fenceId)?.rules ?? []).filter((r) => r.transition === transition).map((r) => r.sort_order);
    // `geofences` won't reflect a just-saved rule until `load()`'s async refresh lands on the next
    // render, so fold it in explicitly - otherwise the very next suggestion re-collides with it.
    if (justSaved && justSaved.transition === transition) used.push(justSaved.sort_order);
    return used.length ? Math.max(...used) + 1 : 0;
  }
  function errorMessage(err: unknown, fallback: string): string {
    if (!(err instanceof ApiError)) return fallback;
    const details = Array.isArray(err.details) ? err.details.filter((d): d is string => typeof d === "string") : [];
    return details.length ? details.join("; ") : err.message;
  }
  async function saveRule() {
    const label = rule.destination_label?.trim(); if (!selectedFence || !label || saving) return; setSaving(true);
    try {
      const input = { transition: rule.transition as "enter" | "exit", heading_min: Number(rule.heading_min), heading_max: Number(rule.heading_max), destination_label: label, destination_location_id: rule.destination_location_id ?? null, send_mode: rule.send_mode as "manual" | "auto", sort_order: Number(rule.sort_order) };
      if (editingRuleId) await api.updateEventGeofenceRule(selectedFence, editingRuleId, input); else await api.addEventGeofenceRule(selectedFence, input);
      setMessage(editingRuleId ? "Direction rule updated." : "Direction rule saved."); setEditingRuleId(null); setRule({ transition: "exit", heading_min: 0, heading_max: 360, send_mode: "manual", destination_label: "", sort_order: nextPriorityFor(selectedFence, "exit", input) }); setDirectionPreset("any"); await load();
    } catch (err) { setMessage(errorMessage(err, "Could not save direction rule.")); } finally { setSaving(false); }
  }
  function chooseDirection(value: CompassDirection) { setDirectionPreset(value); if (value === "any") setRule((r) => ({ ...r, heading_min: 0, heading_max: 360 })); else if (value !== "custom") setRule((r) => ({ ...r, heading_min: COMPASS_RANGES[value][0], heading_max: COMPASS_RANGES[value][1] })); }
  function editRule(item: EventGeofenceRule) { setEditingRuleId(item.id); setRule(item); setDirectionPreset("custom"); }
  async function deleteRule(ruleId: string) { if (!selectedFence || !window.confirm("Delete this direction rule?")) return; try { await api.deleteEventGeofenceRule(selectedFence, ruleId); setMessage("Direction rule deleted."); await load(); } catch (err) { setMessage(err instanceof ApiError ? err.message : "Could not delete direction rule."); } }
  return <><div className="panel-header" style={{ marginTop: 24 }}>Event Map Authoring</div><div className="panel-body"><p className="panel-desc">Use the visible toolbar to draw polygons around lots, stations, venues, or corridor checkpoints. Use the point tool to place transit stations and other reference locations. Existing polygons can be edited or erased directly on the map.</p>{message && <p className="muted">{message}</p>}<EventResourceMapEditorInner geofences={geofences} locations={locations} onChanged={load} /></div><div className="panel-header" style={{ marginTop: 24 }}>Direction Rule Configuration</div><div className="panel-body"><p className="panel-desc">Choose the geofence boundary, define whether the vehicle is entering or exiting, then describe the operational alert. Lower priority wins when ranges overlap.</p><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8 }}><select className="f" value={selectedFence} onChange={(e) => { const fenceId = e.target.value; setSelectedFence(fenceId); if (!editingRuleId) setRule((r) => ({ ...r, sort_order: nextPriorityFor(fenceId, (r.transition as "enter" | "exit") ?? "exit") })); }}><option value="">Select geofence to monitor</option>{geofences.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select><select className="f" value={rule.transition} onChange={(e) => { const transition = e.target.value as "enter" | "exit"; setRule((r) => ({ ...r, transition, sort_order: editingRuleId ? r.sort_order : nextPriorityFor(selectedFence, transition) })); }}><option value="enter">Entering</option><option value="exit">Exiting</option></select><select className="f" value={directionPreset} onChange={(e) => chooseDirection(e.target.value as CompassDirection)} aria-label="Vehicle travel direction"><option value="any">Any direction</option>{Object.keys(COMPASS_RANGES).map((direction) => <option key={direction} value={direction}>{direction}</option>)}<option value="custom">Custom range</option></select><input className="f" type="number" min={0} max={360} step={0.5} value={rule.heading_min} onChange={(e) => { setDirectionPreset("custom"); setRule((r) => ({ ...r, heading_min: Number(e.target.value) })); }} placeholder="Minimum bearing" aria-label="Minimum vehicle bearing" /><input className="f" type="number" min={0} max={360} step={0.5} value={rule.heading_max} onChange={(e) => { setDirectionPreset("custom"); setRule((r) => ({ ...r, heading_max: Number(e.target.value) })); }} placeholder="Maximum bearing" aria-label="Maximum vehicle bearing" /><input className="f" type="number" min={0} value={rule.sort_order} onChange={(e) => setRule((r) => ({ ...r, sort_order: Number(e.target.value) }))} placeholder="Priority" aria-label="Rule priority" /><input className="f" value={rule.destination_label ?? ""} onChange={(e) => setRule((r) => ({ ...r, destination_label: e.target.value }))} placeholder="Alert message or destination description" aria-label="Alert message or destination description" /><select className="f" value={rule.destination_location_id ?? ""} onChange={(e) => setRule((r) => ({ ...r, destination_location_id: e.target.value || null }))}><option value="">Select destination location (optional)</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select><select className="f" value={rule.send_mode} onChange={(e) => setRule((r) => ({ ...r, send_mode: e.target.value as "manual" | "auto" }))}><option value="manual">Manual review required</option><option value="auto">Auto-send</option></select><button className="btn-sm" disabled={!selectedFence || !rule.destination_label?.trim() || saving} onClick={() => void saveRule()}>{saving ? "Saving…" : editingRuleId ? "Update direction rule" : "Save direction rule"}</button>{editingRuleId && <button className="btn-sm" onClick={() => { setEditingRuleId(null); setRule({ transition: "exit", heading_min: 0, heading_max: 360, send_mode: "manual", destination_label: "", sort_order: nextPriorityFor(selectedFence, "exit") }); setDirectionPreset("any"); }}>Cancel edit</button>}</div>{selected && <div style={{ marginTop: 12 }}><strong>{selected.name} rules</strong>{(selected.rules ?? []).length === 0 ? <p className="muted">No rules configured.</p> : <table className="data"><thead><tr><th>Priority</th><th>Transition</th><th>Heading</th><th>Destination</th><th>Mode</th><th>Action</th></tr></thead><tbody>{(selected.rules ?? []).map((item) => <tr key={item.id}><td>{item.sort_order}</td><td>{item.transition}</td><td>{item.heading_min}°–{item.heading_max}°</td><td>{item.destination_label}</td><td>{item.send_mode}</td><td><button className="btn-sm" onClick={() => editRule(item)}>Edit</button>{" "}<button className="btn-sm" onClick={() => void deleteRule(item.id)}>Delete</button></td></tr>)}</tbody></table>}</div>}</div></>;
}

function EventResourceMapEditorInner(props: { geofences: StoredFence[]; locations: EventLocation[]; onChanged: () => void }) { return <MapEditor {...props} />; }
