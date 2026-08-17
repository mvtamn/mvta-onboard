import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import * as atlas from "azure-maps-control";
import * as drawing from "azure-maps-drawing-tools";
import "azure-maps-control/dist/atlas.min.css";
import "azure-maps-drawing-tools/dist/atlas-drawing.min.css";
import { ApiError, type EventGeofence, type EventGeofenceMessageType, type EventGeofenceRule, type EventLocation, type EventLocationCategory } from "@mvta/shared";
import { api } from "../config.js";
import { useAuth } from "../auth/AuthContext.js";
import "./modules/eventMonitoring.css";
import { validateDrawnPolygon } from "./geofenceGeometry.js";

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
  const [ready, setReady] = useState(false); const [draft, setDraft] = useState<Draft | null>(null); const [name, setName] = useState(""); const [category, setCategory] = useState<EventLocationCategory>("transit_station"); const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null); const [activeMode, setActiveMode] = useState<drawing.drawing.DrawingMode>(drawing.drawing.DrawingMode.idle); const [showGeofences, setShowGeofences] = useState(true); const [showInactiveGeofences, setShowInactiveGeofences] = useState(true); const [showLocations, setShowLocations] = useState(true); const [showInactiveLocations, setShowInactiveLocations] = useState(true); const [cursor, setCursor] = useState<atlas.data.Position | null>(null);

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
          if (geo.geometry?.type === "Polygon") {
            const validationError = validateDrawnPolygon(JSON.stringify(geo.geometry));
            if (validationError) {
              manager.getSource().remove(shape);
              setNotice(`Geofence not created: ${validationError}. Draw a new boundary.`);
              setDraft(null);
            } else setDraft({ shape, kind: "geofence" });
          }
          if (geo.geometry?.type === "Point") setDraft({ shape, kind: "location", position: geo.geometry.coordinates as atlas.data.Position });
          manager.setOptions({ mode: drawing.drawing.DrawingMode.idle });
        });
        map.events.add("drawingchanged", manager, (shape) => {
          const geo = shape.toJson() as GeoFeature;
          const props = geo.properties as { id?: string; kind?: string } | undefined; const polygon = geometryOf(shape);
          if (!polygon || geo.geometry?.type !== "Polygon") return;
          const ring = geo.geometry.coordinates[0] as unknown[] | undefined;
          const first = ring?.[0] as unknown[] | undefined; const last = ring?.[ring.length - 1] as unknown[] | undefined;
          const isClosed = Boolean(ring && ring.length >= 4 && Array.isArray(first) && Array.isArray(last) && first[0] === last[0] && first[1] === last[1]);
          if (!props?.id || props.kind !== "geofence") {
            if (isClosed) {
              const validationError = validateDrawnPolygon(polygon);
              if (validationError) { manager.getSource().remove(shape); manager.setOptions({ mode: drawing.drawing.DrawingMode.idle }); setDraft(null); setNotice(`Geofence not created: ${validationError}. Draw a new boundary.`); }
            }
            return;
          }
          const validationError = validateDrawnPolygon(polygon);
          if (validationError) {
            if (syncTimer.current) window.clearTimeout(syncTimer.current);
            manager.getSource().remove(shape);
            const fence = geofencesRef.current.find((row) => row.id === props.id);
            if (fence) { try { manager.getSource().add(new atlas.Shape({ type: "Feature", geometry: JSON.parse(fence.polygon) as atlas.data.Geometry, properties: { id: fence.id, kind: "geofence" } })); } catch { /* keep the invalid legacy record out of the editor */ } }
            manager.setOptions({ mode: drawing.drawing.DrawingMode.idle });
            setNotice(`Boundary change rejected: ${validationError}. The previous boundary was restored.`);
            return;
          }
          if (syncTimer.current) window.clearTimeout(syncTimer.current);
          syncTimer.current = window.setTimeout(() => {
            const fence = geofencesRef.current.find((row) => row.id === props.id); if (fence) void api.updateEventGeofence(fence.id, { name: fence.name, polygon }).then(onChanged).catch((err) => setNotice(err instanceof ApiError ? `Boundary could not be saved: ${err.message}` : "Boundary could not be saved; the previous server version is still active."));
          }, 500);
        });
        map.events.add("drawingerased", manager, (shape) => {
          const props = shape.toJson().properties as { id?: string; kind?: string } | undefined;
          if (props?.id && props.kind === "geofence") { const fence = geofencesRef.current.find((f) => f.id === props.id); if (fence) void api.updateEventGeofence(props.id, { name: fence.name, polygon: fence.polygon, is_active: false }).then(onChanged).catch(() => undefined); }
        });
      });
    }).catch((err) => setError(err instanceof ApiError && err.status === 401 ? "Your Microsoft session is not connected to the API. Sign in again to use map authoring." : err instanceof ApiError ? err.message : "Map unavailable."));
    return () => { cancelled = true; if (syncTimer.current) window.clearTimeout(syncTimer.current); drawingRef.current?.dispose(); mapRef.current?.dispose(); drawingRef.current = null; mapRef.current = null; };
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
      if (draft.kind === "geofence") { const geometry = geometryOf(draft.shape); if (!geometry) return; const validationError = validateDrawnPolygon(geometry); if (validationError) { setNotice(`Geofence not saved: ${validationError}. Draw a new boundary.`); return; } await api.createEventGeofence({ name: name.trim(), polygon: geometry }); }
      else if (draft.position) await api.createEventLocation({ name: name.trim(), category, latitude: draft.position[1], longitude: draft.position[0], notes: null });
      setDraft(null); setName(""); setNotice(null); onChanged();
    } catch (err) { setNotice(err instanceof ApiError ? err.message : "Could not save map item. The map is ready for another attempt."); }
  }

  if (!account) return <div className="evmon-map-message"><p>Sign in with your MVTA Microsoft 365 account to use map authoring.</p><button className="btn-primary" onClick={signIn}>Sign in with Microsoft</button></div>;
  const selectMode = (mode: drawing.drawing.DrawingMode) => { const manager = drawingRef.current; if (!manager) return; setNotice(null); manager.setOptions({ mode, interactionType: drawing.drawing.DrawingInteractionType.click }); setActiveMode(mode); };
  return <div><div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}><button className="btn-sm" disabled={!ready} onClick={() => selectMode(drawing.drawing.DrawingMode.drawPolygon)}>Draw geofence</button><button className="btn-sm" disabled={!ready} onClick={() => selectMode(drawing.drawing.DrawingMode.drawPoint)}>Place location</button><button className="btn-sm" disabled={!ready} onClick={() => selectMode(drawing.drawing.DrawingMode.editGeometry)}>Edit boundary</button><button className="btn-sm" disabled={!ready} onClick={() => selectMode(drawing.drawing.DrawingMode.eraseGeometry)}>Deactivate boundary</button><button className="btn-sm" disabled={!ready} onClick={() => selectMode(drawing.drawing.DrawingMode.idle)}>Select</button><span className="muted">Mode: {activeMode === drawing.drawing.DrawingMode.drawPolygon ? "Drawing geofence — click vertices, double-click to finish" : activeMode === drawing.drawing.DrawingMode.drawPoint ? "Placing location — click the map" : `Mode: ${activeMode}`}</span><label className="muted"><input type="checkbox" checked={showGeofences} onChange={(e) => setShowGeofences(e.target.checked)} /> Active geofences</label><label className="muted"><input type="checkbox" checked={showInactiveGeofences} onChange={(e) => setShowInactiveGeofences(e.target.checked)} /> Inactive geofences</label><label className="muted"><input type="checkbox" checked={showLocations} onChange={(e) => setShowLocations(e.target.checked)} /> Active locations</label><label className="muted"><input type="checkbox" checked={showInactiveLocations} onChange={(e) => setShowInactiveLocations(e.target.checked)} /> Inactive locations</label></div>{notice && <p className="muted" role="alert">{notice}</p>}<div style={{ height: 420, borderRadius: 8, overflow: "hidden", border: "1px solid #ccd6d1", position: "relative" }}><div ref={host} style={{ width: "100%", height: "100%" }} />{!ready && !error && <div className="evmon-map-message">Loading map…</div>}{error && <div className="evmon-map-message"><p>{error}</p>{error.includes("session") && <button className="btn-primary" onClick={signIn}>Sign in again</button>}</div>}</div>{cursor && <p className="muted">Live pointer coordinate: latitude {cursor[1].toFixed(6)}, longitude {cursor[0].toFixed(6)}</p>}{draft && <div className="panel-body" style={{ marginTop: 10, border: "1px solid #ccd6d1" }}><strong>Save new {draft.kind === "geofence" ? "geofence" : "map location"}</strong><div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}><input className="f" value={name} onChange={(e) => setName(e.target.value)} placeholder={draft.kind === "geofence" ? "Geofence name" : "Location name"} />{draft.kind === "location" && <select className="f" value={category} onChange={(e) => setCategory(e.target.value as EventLocationCategory)}><option value="transit_station">Transit station</option><option value="park_and_ride">Park & ride</option><option value="venue">Venue</option><option value="other">Other</option></select>}<button className="btn-sm" disabled={!name.trim()} onClick={() => void saveDraft()}>Save</button><button className="btn-sm" onClick={() => { drawingRef.current?.getSource().remove(draft.shape); setDraft(null); }}>Cancel</button></div></div>}<GeofenceManager geofences={geofences} onChanged={onChanged} /><LocationManager locations={locations} onChanged={onChanged} /></div>;
}

function GeofenceManager({ geofences, onChanged }: { geofences: StoredFence[]; onChanged: () => void }) {
  async function remove(geofence: StoredFence) {
    if (!window.confirm(`Remove geofence "${geofence.name}"? It will be deactivated and retained for audit.`)) return;
    try { await api.updateEventGeofence(geofence.id, { name: geofence.name, polygon: geofence.polygon, is_active: false }); onChanged(); }
    catch (err) { window.alert(err instanceof ApiError ? err.message : "Could not remove geofence."); }
  }
  if (!geofences.length) return null;
  return <table className="data" style={{ marginTop: 12 }}><thead><tr><th>Geofence</th><th>Rules</th><th>Status</th><th>Actions</th></tr></thead><tbody>{geofences.map((geofence) => <tr key={geofence.id}><td>{geofence.name}</td><td>{geofence.rules?.length ?? 0}</td><td>{geofence.is_active ? "Active" : "Inactive"}</td><td>{geofence.is_active ? <button className="btn-sm danger" onClick={() => void remove(geofence)}>Remove</button> : "—"}</td></tr>)}</tbody></table>;
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
  const [geofences, setGeofences] = useState<StoredFence[]>([]); const [locations, setLocations] = useState<EventLocation[]>([]); const [selectedFence, setSelectedFence] = useState(() => searchParams.get("geofence") ?? ""); const [editingRuleId, setEditingRuleId] = useState<string | null>(null); const [saving, setSaving] = useState(false); const [rule, setRule] = useState<Partial<EventGeofenceRule>>({ transition: "exit", heading_min: 0, heading_max: 360, message_type: "custom", send_mode: "manual", destination_label: "", sort_order: 0 }); const [directionPreset, setDirectionPreset] = useState<CompassDirection>("any"); const [testBus, setTestBus] = useState("1234"); const [message, setMessage] = useState<string | null>(null);
  const load = () => Promise.all([api.getEventGeofences(), api.getEventLocations()]).then(([g, l]) => { setGeofences(g.geofences); setLocations(l.locations); }).catch((err) => setMessage(err instanceof ApiError ? err.message : "Event resources are unavailable until migrations 033 and 034 are applied."));
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!selectedFence) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById("event-configuration")?.scrollIntoView({ behavior: "smooth", block: "start" });
      document.getElementById("event-geofence-rule-select")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedFence]);
  const selected = geofences.find((f) => f.id === selectedFence);
  async function saveRule() {
    const label = rule.destination_label?.trim() ?? ""; const messageType = (rule.message_type ?? "custom") as EventGeofenceMessageType; if (!selectedFence || (messageType === "custom" && !label) || saving) return; setSaving(true);
    try {
      const input = { transition: rule.transition as "enter" | "exit", heading_min: Number(rule.heading_min), heading_max: Number(rule.heading_max), destination_label: label, destination_location_id: rule.destination_location_id ?? null, message_type: messageType, send_mode: rule.send_mode as "manual" | "auto", sort_order: Number(rule.sort_order) };
      if (editingRuleId) await api.updateEventGeofenceRule(selectedFence, editingRuleId, input); else await api.addEventGeofenceRule(selectedFence, input);
      setMessage(editingRuleId ? "Direction rule updated." : "Direction rule saved."); setEditingRuleId(null); setRule({ transition: "exit", heading_min: 0, heading_max: 360, message_type: "custom", send_mode: "manual", destination_label: "", sort_order: 0 }); setDirectionPreset("any"); await load();
    } catch (err) { setMessage(err instanceof ApiError ? err.message : "Could not save direction rule."); } finally { setSaving(false); }
  }
  function chooseDirection(value: CompassDirection) { setDirectionPreset(value); if (value === "any") setRule((r) => ({ ...r, heading_min: 0, heading_max: 360 })); else if (value !== "custom") setRule((r) => ({ ...r, heading_min: COMPASS_RANGES[value][0], heading_max: COMPASS_RANGES[value][1] })); }
  function editRule(item: EventGeofenceRule) { const messageType = item.message_type ?? "custom"; setEditingRuleId(item.id); setRule({ ...item, message_type: messageType, transition: messageType === "arriving_soon" ? "enter" : item.transition }); setDirectionPreset("custom"); }
  async function deleteRule(ruleId: string) { if (!selectedFence || !window.confirm("Delete this direction rule?")) return; try { await api.deleteEventGeofenceRule(selectedFence, ruleId); setMessage("Direction rule deleted."); await load(); } catch (err) { setMessage(err instanceof ApiError ? err.message : "Could not delete direction rule."); } }
  const previewContext = rule.destination_label?.trim() ? `; ${rule.destination_label.trim()}` : "";
  const previewMessage = selected
    ? rule.message_type === "departing" ? `Bus ${testBus || "1234"} on Route 55 is departing ${locations.find((location) => location.id === rule.destination_location_id)?.name ?? selected.name}${previewContext}.`
      : rule.message_type === "passed" ? `Bus ${testBus || "1234"} on Route 55 has passed ${locations.find((location) => location.id === rule.destination_location_id)?.name ?? selected.name}${previewContext}.`
        : rule.message_type === "arriving_soon" ? `Bus ${testBus || "1234"} on Route 55 is arriving at ${locations.find((location) => location.id === rule.destination_location_id)?.name ?? selected.name} soon${previewContext}.`
          : rule.destination_label?.trim() ? `Bus ${testBus || "1234"} on Route 55 ${rule.transition === "enter" ? "entered" : "exited"} ${selected.name}; ${rule.destination_label.trim()}.` : "Choose a geofence and enter an operational message to preview it."
    : "Choose a geofence and enter an operational message to preview it.";
  return <>
    <div className="panel-header" style={{ marginTop: 24 }}>Event Map Authoring</div>
    <div className="panel-body"><p className="panel-desc">Draw and maintain reusable operational boundaries and transit locations here. Link them to an operating period in Event Planning before they affect Event AVL.</p>{message && <p className="muted">{message}</p>}<EventResourceMapEditorInner geofences={geofences} locations={locations} onChanged={load} /></div>
    <div className="panel-header" style={{ marginTop: 24 }}>Direction Rule Configuration</div>
    <div className="panel-body event-direction-rules">
      <p className="panel-desc">Every crossing in an active operating scope creates an Event AVL message. Planning defines the message type and wording; Event AVL controls whether matched messages are sent automatically to the configured Teams channel. Lower priority wins when rules overlap.</p>
      <div className="event-rule-step"><span className="event-rule-step-number">1</span><div><strong>When should this rule match?</strong><div className="event-rule-fields"><label>Geofence<select id="event-geofence-rule-select" className="f" value={selectedFence} onChange={(e) => setSelectedFence(e.target.value)}><option value="">Select a geofence</option>{geofences.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label><label>Boundary movement<select className="f" value={rule.transition} onChange={(e) => setRule((r) => ({ ...r, transition: e.target.value as "enter" | "exit" }))}><option value="enter">Vehicle enters</option><option value="exit" disabled={rule.message_type === "arriving_soon"}>Vehicle exits</option></select></label><label>Travel direction<select className="f" value={directionPreset} onChange={(e) => chooseDirection(e.target.value as CompassDirection)} aria-label="Vehicle travel direction"><option value="any">Any direction</option>{Object.keys(COMPASS_RANGES).map((direction) => <option key={direction} value={direction}>{direction}</option>)}<option value="custom">Custom compass range</option></select></label></div></div></div>
      <div className="event-rule-step"><span className="event-rule-step-number">2</span><div><strong>What movement range is covered?</strong><p className="muted">Use compass directions for common operations; use degrees only for a precise range.</p><div className="event-rule-fields"><label>Minimum bearing<input className="f" type="number" min={0} max={360} step={0.5} value={rule.heading_min} onChange={(e) => { setDirectionPreset("custom"); setRule((r) => ({ ...r, heading_min: Number(e.target.value) })); }} /></label><label>Maximum bearing<input className="f" type="number" min={0} max={360} step={0.5} value={rule.heading_max} onChange={(e) => { setDirectionPreset("custom"); setRule((r) => ({ ...r, heading_max: Number(e.target.value) })); }} /></label><label>Priority <span title="Lower numbers are evaluated first">ⓘ</span><input className="f" type="number" min={0} value={rule.sort_order} onChange={(e) => setRule((r) => ({ ...r, sort_order: Number(e.target.value) }))} /></label></div></div></div>
      <div className="event-rule-step"><span className="event-rule-step-number">3</span><div><strong>What should Event AVL say?</strong><div className="event-rule-fields"><label>Standard message type<select className="f" value={rule.message_type ?? "custom"} onChange={(e) => { const messageType = e.target.value as EventGeofenceMessageType; setRule((r) => ({ ...r, message_type: messageType, transition: messageType === "arriving_soon" ? "enter" : r.transition })); }}><option value="departing">Bus is departing location</option><option value="passed">Bus has passed location</option><option value="arriving_soon">Bus is arriving soon</option><option value="custom">Custom message</option></select></label><label>{rule.message_type === "custom" ? "Custom message" : "Additional message context (optional)"}<input className="f" maxLength={200} value={rule.destination_label ?? ""} onChange={(e) => setRule((r) => ({ ...r, destination_label: e.target.value }))} placeholder="Example: Proceed to Gate A" /></label><label>Related location<select className="f" value={rule.destination_location_id ?? ""} onChange={(e) => setRule((r) => ({ ...r, destination_location_id: e.target.value || null }))}><option value="">Use geofence name</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label></div><p className="muted">Arriving soon is always triggered when the vehicle enters this geofence; it does not calculate an ETA. Event AVL controls whether matched messages are sent to Teams.</p></div></div>
      <div className="event-rule-preview"><strong>Message preview</strong><span>{previewMessage}</span><label>Test bus number<input className="f" value={testBus} onChange={(e) => setTestBus(e.target.value)} /></label><small>Preview only. A live test is created by activating the operating period, using a vehicle assigned to one of its routes, and confirming the crossing appears under Event AVL notifications.</small></div>
      <div className="actions"><button className="btn-primary" disabled={!selectedFence || ((rule.message_type ?? "custom") === "custom" && !rule.destination_label?.trim()) || saving} onClick={() => void saveRule()}>{saving ? "Saving…" : editingRuleId ? "Save rule changes" : "Save direction rule"}</button>{editingRuleId && <button className="btn-sm" onClick={() => { setEditingRuleId(null); setRule({ transition: "exit", heading_min: 0, heading_max: 360, message_type: "custom", send_mode: "manual", destination_label: "", sort_order: 0 }); setDirectionPreset("any"); }}>Cancel edit</button>}</div>
      {selected && <div style={{ marginTop: 12 }}><strong>{selected.name} rules</strong>{(selected.rules ?? []).length === 0 ? <p className="muted">No rules configured.</p> : <table className="data"><thead><tr><th>Priority</th><th>Movement</th><th>Direction</th><th>Message type</th><th>Teams behavior</th><th>Action</th></tr></thead><tbody>{(selected.rules ?? []).map((item) => <tr key={item.id}><td>{item.sort_order}</td><td>{item.transition === "enter" ? "Enters" : "Exits"}</td><td>{item.heading_min}°–{item.heading_max}°</td><td>{item.message_type === "departing" ? "Departing" : item.message_type === "passed" ? "Passed" : item.message_type === "arriving_soon" ? "Arriving soon" : "Custom"}</td><td>Controlled in Event AVL</td><td><button className="btn-sm" onClick={() => editRule(item)}>Edit</button>{" "}<button className="btn-sm" onClick={() => void deleteRule(item.id)}>Delete</button></td></tr>)}</tbody></table>}</div>}
    </div>
  </>;
}

function EventResourceMapEditorInner(props: { geofences: StoredFence[]; locations: EventLocation[]; onChanged: () => void }) { return <MapEditor {...props} />; }
