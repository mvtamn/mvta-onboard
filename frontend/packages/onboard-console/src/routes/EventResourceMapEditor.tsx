import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import * as atlas from "azure-maps-control";
import * as drawing from "azure-maps-drawing-tools";
import "azure-maps-control/dist/atlas.min.css";
import "azure-maps-drawing-tools/dist/atlas-drawing.min.css";
import { ApiError, type EventGeofence, type EventGeofenceMessageType, type EventGeofencePurpose, type EventGeofencePurposeOption, type EventGeofenceRule, type EventLocation, type EventLocationCategory, type EventServicePlan } from "@mvta/shared";
import { api } from "../config.js";
import { useAuth } from "../auth/AuthContext.js";
import { useAppDialog } from "../components/AppDialog.js";
import "./modules/eventMonitoring.css";
import { validateDrawnPolygon } from "./geofenceGeometry.js";

const CENTER: atlas.data.Position = [-93.25, 44.83];
type Draft = { shape: atlas.Shape; kind: "geofence" | "location"; position?: atlas.data.Position };
type StoredFence = EventGeofence & { rules?: EventGeofenceRule[] };
type GeoFeature = atlas.data.Feature<atlas.data.Geometry, Record<string, unknown>>;
type SelectedMapResource = { kind: "geofence" | "location"; id: string } | null;
const COMPASS_RANGES = { N: [337.5, 22.5], NE: [22.5, 67.5], E: [67.5, 112.5], SE: [112.5, 157.5], S: [157.5, 202.5], SW: [202.5, 247.5], W: [247.5, 292.5], NW: [292.5, 337.5] } as const;
type CompassDirection = keyof typeof COMPASS_RANGES | "any" | "custom";
const LOCATION_CATEGORY_LABELS: Record<EventLocationCategory, string> = { transit_station: "Transit station", park_and_ride: "Park & ride", venue: "Venue", other: "Other" };
const MESSAGE_TYPE_LABELS: Record<EventGeofenceMessageType, string> = { departing: "Bus is departing", passed: "Bus has passed", arriving_soon: "Bus is arriving soon", custom: "Custom operational message" };

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char] ?? char);
}

function geometryOf(shape: atlas.Shape): string | null {
  const feature = shape.toJson() as GeoFeature;
  return feature.geometry ? JSON.stringify(feature.geometry) : null;
}

function MapEditor({ geofences, locations, plans, purposes, onChanged }: { geofences: StoredFence[]; locations: EventLocation[]; plans: EventServicePlan[]; purposes: EventGeofencePurposeOption[]; onChanged: () => void }) {
  const { account, signIn } = useAuth();
  const host = useRef<HTMLDivElement>(null); const mapRef = useRef<atlas.Map | null>(null); const drawingRef = useRef<drawing.drawing.DrawingManager | null>(null); const highlightRef = useRef<atlas.source.DataSource | null>(null); const syncTimer = useRef<number | null>(null); const geofencesRef = useRef(geofences); geofencesRef.current = geofences;
  const [ready, setReady] = useState(false); const [draft, setDraft] = useState<Draft | null>(null); const [name, setName] = useState(""); const [purpose, setPurpose] = useState<EventGeofencePurpose>("other"); const [category, setCategory] = useState<EventLocationCategory>("transit_station"); const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null); const [activeMode, setActiveMode] = useState<drawing.drawing.DrawingMode>(drawing.drawing.DrawingMode.idle); const [showGeofences, setShowGeofences] = useState(true); const [showInactiveGeofences, setShowInactiveGeofences] = useState(true); const [showLocations, setShowLocations] = useState(true); const [showInactiveLocations, setShowInactiveLocations] = useState(true); const [mapFilter, setMapFilter] = useState(""); const [selectedResource, setSelectedResource] = useState<SelectedMapResource>(null); const [cursor, setCursor] = useState<atlas.data.Position | null>(null);

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
        const highlight = new atlas.source.DataSource("event-authoring-selection");
        map.sources.add(highlight); highlightRef.current = highlight;
        map.layers.add([
          new atlas.layer.PolygonLayer(highlight, "event-authoring-selection-fill", { fillColor: "#ffb000", fillOpacity: 0.28, filter: ["==", ["get", "kind"], "geofence"] }),
          new atlas.layer.LineLayer(highlight, "event-authoring-selection-line", { strokeColor: "#9b5d00", strokeWidth: 4, filter: ["==", ["get", "kind"], "geofence"] }),
          new atlas.layer.BubbleLayer(highlight, "event-authoring-selection-location", { radius: 12, color: "#ffb000", strokeColor: "#9b5d00", strokeWidth: 3, filter: ["==", ["get", "kind"], "location"] }),
        ]);
        map.events.add("mousemove", (event) => setCursor(event.position as atlas.data.Position));
        map.events.add("click", (event) => setCursor(event.position as atlas.data.Position));
        map.events.add("drawingmodechanged", manager, (mode) => setActiveMode(mode));
        map.events.add("drawingcomplete", manager, (shape) => {
          const geo = shape.toJson() as GeoFeature;
          if (geo.geometry?.type === "Polygon") {
            const validationError = validateDrawnPolygon(JSON.stringify(geo.geometry));
            if (validationError) {
              manager.getSource().remove(shape);
              setNotice(`Monitoring Area not created: ${validationError}. Draw a new boundary.`);
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
              if (validationError) { manager.getSource().remove(shape); manager.setOptions({ mode: drawing.drawing.DrawingMode.idle }); setDraft(null); setNotice(`Monitoring Area not created: ${validationError}. Draw a new boundary.`); }
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
    return () => { cancelled = true; if (syncTimer.current) window.clearTimeout(syncTimer.current); drawingRef.current?.dispose(); mapRef.current?.dispose(); drawingRef.current = null; mapRef.current = null; highlightRef.current = null; };
  }, [account]);

  useEffect(() => {
    const manager = drawingRef.current; const map = mapRef.current; if (!ready || !manager || !map) return;
    const source = manager.getSource(); source.clear();
    const filter = mapFilter.trim().toLowerCase();
    const matches = (value: string) => !filter || value.toLowerCase().includes(filter);
    for (const fence of geofences.filter((row) => (row.is_active ? showGeofences : showInactiveGeofences) && matches(`${row.name} ${row.purpose}`))) {
      try { const geometry = JSON.parse(fence.polygon) as atlas.data.Geometry; source.add(new atlas.Shape({ type: "Feature", geometry, properties: { id: fence.id, kind: "geofence" } })); } catch { /* invalid legacy geometry stays visible in the table */ }
    }
    map.markers.clear();
    locations.filter((location) => (location.is_active ? showLocations : showInactiveLocations) && matches(`${location.name} ${LOCATION_CATEGORY_LABELS[location.category]}`)).forEach((location) => map.markers.add(new atlas.HtmlMarker({ position: [location.longitude, location.latitude], htmlContent: `<div class="event-authoring-location-marker ${location.is_active ? "is-active" : "is-inactive"}" title="${escapeHtml(location.name)}"><span class="event-authoring-location-dot">●</span><span class="event-authoring-location-label">${escapeHtml(location.name)}</span></div>` })));
  }, [geofences, locations, mapFilter, ready, showGeofences, showInactiveGeofences, showLocations, showInactiveLocations]);

  useEffect(() => {
    const map = mapRef.current; const highlight = highlightRef.current;
    if (!ready || !map || !highlight) return;
    highlight.clear();
    if (!selectedResource) return;
    if (selectedResource.kind === "location") {
      const location = locations.find((row) => row.id === selectedResource.id);
      if (!location) return;
      highlight.add(new atlas.data.Feature(new atlas.data.Point([location.longitude, location.latitude]), { kind: "location" }));
      map.setCamera({ center: [location.longitude, location.latitude], zoom: Math.max(map.getCamera().zoom ?? 10, 14) });
      return;
    }
    const geofence = geofences.find((row) => row.id === selectedResource.id);
    if (!geofence) return;
    try {
      const geometry = JSON.parse(geofence.polygon) as atlas.data.Geometry;
      highlight.add(new atlas.Shape({ type: "Feature", geometry, properties: { kind: "geofence" } }));
      const positions = ((geometry as { coordinates?: atlas.data.Position[][] }).coordinates ?? []).flat();
      if (positions.length) map.setCamera({ bounds: atlas.data.BoundingBox.fromPositions(positions), padding: 80, maxZoom: 15 });
    } catch { setNotice("Selected Monitoring Area has invalid geometry and cannot be highlighted."); }
  }, [geofences, locations, ready, selectedResource]);

  async function saveDraft() {
    if (!draft || !name.trim()) return;
    try {
      if (draft.kind === "geofence") { const geometry = geometryOf(draft.shape); if (!geometry) return; const validationError = validateDrawnPolygon(geometry); if (validationError) { setNotice(`Monitoring Area not saved: ${validationError}. Draw a new boundary.`); return; } await api.createEventGeofence({ name: name.trim(), polygon: geometry, purpose }); }
      else if (draft.position) await api.createEventLocation({ name: name.trim(), category, latitude: draft.position[1], longitude: draft.position[0], notes: null });
      setDraft(null); setName(""); setPurpose("other"); setNotice(null); onChanged();
    } catch (err) { setNotice(err instanceof ApiError ? err.message : "Could not save map item. The map is ready for another attempt."); }
  }

  if (!account) return <div className="evmon-map-message"><p>Sign in with your MVTA Microsoft 365 account to use map authoring.</p><button className="btn-primary" onClick={signIn}>Sign in with Microsoft</button></div>;
  const selectMode = (mode: drawing.drawing.DrawingMode) => { const manager = drawingRef.current; if (!manager) return; setNotice(null); manager.setOptions({ mode, interactionType: drawing.drawing.DrawingInteractionType.click }); setActiveMode(mode); };
  return <div>{/* Above the map: auditing or removing a boundary previously sat
      below a 420px canvas and its toolbar, which is why the control went
      unfound. */}
    <PurposeManager purposes={purposes} geofences={geofences} onChanged={onChanged} /><GeofenceManager geofences={geofences} plans={plans} purposes={purposes} selectedId={selectedResource?.kind === "geofence" ? selectedResource.id : null} onSelect={(id) => { setMapFilter(""); setSelectedResource({ kind: "geofence", id }); }} onChanged={onChanged} /><LocationManager locations={locations} selectedId={selectedResource?.kind === "location" ? selectedResource.id : null} onSelect={(id) => { setMapFilter(""); setSelectedResource({ kind: "location", id }); }} onChanged={onChanged} />
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}><button className="btn-sm" disabled={!ready} onClick={() => selectMode(drawing.drawing.DrawingMode.drawPolygon)}>Draw Monitoring Area</button><button className="btn-sm" disabled={!ready} onClick={() => selectMode(drawing.drawing.DrawingMode.drawPoint)}>Place location</button><button className="btn-sm" disabled={!ready} onClick={() => selectMode(drawing.drawing.DrawingMode.editGeometry)}>Edit boundary</button><button className="btn-sm" disabled={!ready} onClick={() => selectMode(drawing.drawing.DrawingMode.eraseGeometry)}>Deactivate boundary</button><button className="btn-sm" disabled={!ready} onClick={() => selectMode(drawing.drawing.DrawingMode.idle)}>Select</button><input className="f event-map-filter" aria-label="Filter map resources" value={mapFilter} onChange={(event) => setMapFilter(event.target.value)} placeholder="Filter map resources" /><span className="muted">Mode: {activeMode === drawing.drawing.DrawingMode.drawPolygon ? "Drawing Monitoring Area — click vertices, double-click to finish" : activeMode === drawing.drawing.DrawingMode.drawPoint ? "Placing location — click the map" : `Mode: ${activeMode}`}</span><label className="muted"><input type="checkbox" checked={showGeofences} onChange={(e) => setShowGeofences(e.target.checked)} /> Active Monitoring Areas</label><label className="muted"><input type="checkbox" checked={showInactiveGeofences} onChange={(e) => setShowInactiveGeofences(e.target.checked)} /> Inactive Monitoring Areas</label><label className="muted"><input type="checkbox" checked={showLocations} onChange={(e) => setShowLocations(e.target.checked)} /> Active locations</label><label className="muted"><input type="checkbox" checked={showInactiveLocations} onChange={(e) => setShowInactiveLocations(e.target.checked)} /> Inactive locations</label></div>{notice && <p className="muted" role="alert">{notice}</p>}<div style={{ height: 420, borderRadius: 8, overflow: "hidden", border: "1px solid #ccd6d1", position: "relative" }}><div ref={host} style={{ width: "100%", height: "100%" }} />{!ready && !error && <div className="evmon-map-message">Loading map…</div>}{error && <div className="evmon-map-message"><p>{error}</p>{error.includes("session") && <button className="btn-primary" onClick={signIn}>Sign in again</button>}</div>}</div>{cursor && <p className="muted">Live pointer coordinate: latitude {cursor[1].toFixed(6)}, longitude {cursor[0].toFixed(6)}</p>}{draft && <div className="panel-body" style={{ marginTop: 10, border: "1px solid #ccd6d1" }}><strong>Save new {draft.kind === "geofence" ? "Monitoring Area" : "map location"}</strong><div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}><input className="f" value={name} onChange={(e) => setName(e.target.value)} placeholder={draft.kind === "geofence" ? "Monitoring Area name" : "Location name"} />{draft.kind === "geofence" && <select className="f" aria-label="Area purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)}>{purposes.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select>}{draft.kind === "location" && <select className="f" value={category} onChange={(e) => setCategory(e.target.value as EventLocationCategory)}>{Object.entries(LOCATION_CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}<button className="btn-sm" disabled={!name.trim()} onClick={() => void saveDraft()}>Save</button><button className="btn-sm" onClick={() => { drawingRef.current?.getSource().remove(draft.shape); setDraft(null); }}>Cancel</button></div></div>}</div>;
}

// Duplicate geofence names are real in this data - two "Eagan Bus Garage"
// rows exist - and the table rendered only the name, so identical rows could
// not be told apart and none could be removed with confidence about which was
// going. Each added column either separates otherwise-identical rows or says
// what deactivating one would affect.
function PurposeManager({ purposes, geofences, onChanged }: { purposes: EventGeofencePurposeOption[]; geofences: StoredFence[]; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { confirm, prompt } = useAppDialog();
  const codeFor = (label: string) => label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

  async function add() {
    const label = (await prompt({ title: "Add area purpose", description: "Describe how a Monitoring Area is used in Event AVL.", label: "Purpose name", confirmLabel: "Add purpose", required: true }))?.trim();
    if (!label) return;
    setBusy("new"); setError(null);
    try { await api.createEventGeofencePurpose({ code: codeFor(label), label }); onChanged(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Could not add this Area purpose."); }
    finally { setBusy(null); }
  }

  async function rename(purpose: EventGeofencePurposeOption) {
    const label = (await prompt({ title: "Rename area purpose", label: "Purpose name", defaultValue: purpose.label, confirmLabel: "Save changes", required: true }))?.trim();
    if (!label || label === purpose.label) return;
    setBusy(purpose.code); setError(null);
    try { await api.updateEventGeofencePurpose(purpose.code, { label }); onChanged(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Could not rename this Area purpose."); }
    finally { setBusy(null); }
  }

  async function remove(purpose: EventGeofencePurposeOption) {
    const using = geofences.filter((geofence) => geofence.purpose === purpose.code).length;
    if (!await confirm({ title: `Delete ${purpose.label}?`, description: using ? `${using} Monitoring Area${using === 1 ? " still uses" : "s still use"} this purpose and must be reassigned first.` : "This cannot be undone.", confirmLabel: "Delete purpose", danger: true })) return;
    setBusy(purpose.code); setError(null);
    try { await api.deleteEventGeofencePurpose(purpose.code); onChanged(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Could not delete this Area purpose."); }
    finally { setBusy(null); }
  }

  return <details className="event-admin-disclosure">
    <summary>
      <span><strong>Area purposes</strong><small>Labels that explain how a Monitoring Area is used</small></span>
      <span className="event-admin-disclosure-count">{purposes.length} available</span>
    </summary>
    <div className="event-admin-disclosure-body">
      <p className="panel-desc">Use a purpose to make active-area context understandable in Event AVL. Built-in purposes remain available; custom purposes can be renamed or deleted when unused.</p>
      {error && <p className="event-field-error" role="alert">{error}</p>}
      <div className="actions"><button className="btn-sm" disabled={busy !== null} onClick={() => void add()}>{busy === "new" ? "Adding…" : "Add Area purpose"}</button></div>
      <table className="data"><thead><tr><th>Purpose</th><th>Code</th><th>Monitoring Areas</th><th>Actions</th></tr></thead><tbody>{purposes.map((purpose) => {
        const using = geofences.filter((geofence) => geofence.purpose === purpose.code).length;
        return <tr key={purpose.code}><td><strong>{purpose.label}</strong>{purpose.is_system && <span className="td-subtle">Built-in</span>}</td><td className="td-dim">{purpose.code}</td><td>{using}</td><td><button className="btn-sm" disabled={busy === purpose.code} onClick={() => void rename(purpose)}>Rename</button>{" "}{purpose.is_system ? <span className="td-subtle">Protected</span> : <button className="btn-sm danger" disabled={busy === purpose.code} onClick={() => void remove(purpose)}>Delete</button>}</td></tr>;
      })}</tbody></table>
    </div>
  </details>;
}

function GeofenceManager({ geofences, plans, purposes, selectedId, onSelect, onChanged }: { geofences: StoredFence[]; plans: EventServicePlan[]; purposes: EventGeofencePurposeOption[]; selectedId: string | null; onSelect: (id: string) => void; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm, prompt } = useAppDialog();

  const plansUsing = (geofenceId: string) =>
    plans.filter((plan) => (plan.links ?? []).some((link) => link.kind === "geofences" && String(link.value) === geofenceId));

  async function changePurpose(geofence: StoredFence, purpose: EventGeofencePurpose) {
    setError(null);
    try { await api.updateEventGeofence(geofence.id, { purpose }); onChanged(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Could not update Monitoring Area purpose."); }
  }

  async function rename(geofence: StoredFence) {
    const name = (await prompt({ title: "Rename Monitoring Area", label: "Monitoring Area name", defaultValue: geofence.name, confirmLabel: "Save changes", required: true }))?.trim();
    if (!name || name === geofence.name) return;
    setBusy(geofence.id);
    setError(null);
    try { await api.updateEventGeofence(geofence.id, { name }); onChanged(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Could not rename this Monitoring Area."); }
    finally { setBusy(null); }
  }

  async function remove(geofence: StoredFence) {
    const using = plansUsing(geofence.id);
    const governed = using.filter((plan) => ["active", "suspended", "approved"].includes(plan.status));
    const lines = [`It is retained for audit and leaves every picker.`];
    if (using.length > 0) lines.push(`In the scope of: ${using.map((plan) => `${plan.name} (${plan.status})`).join(", ")}.`);
    if (governed.length > 0) lines.push("Live monitoring is unaffected - governed Event Plans run from a published scope snapshot - but their scope still references it until a reviewed revision removes it.");
    if (!await confirm({ title: `Deactivate ${geofence.name}?`, description: lines.join(" "), confirmLabel: "Deactivate", danger: true })) return;
    setBusy(geofence.id);
    setError(null);
    try {
      await api.updateEventGeofence(geofence.id, { name: geofence.name, polygon: geofence.polygon, is_active: false });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not deactivate this Monitoring Area.");
    } finally {
      setBusy(null);
    }
  }

  if (!geofences.length) return null;
  const duplicated = new Set(geofences.map((row) => row.name).filter((name, index, all) => all.indexOf(name) !== index));

  return <details className="event-admin-disclosure" open>
    <summary>
      <span><strong>Monitoring Areas</strong><small>Reusable boundaries for Event Plans and AVL monitoring</small></span>
      <span className="event-admin-disclosure-count">{geofences.filter((row) => row.is_active).length} active</span>
    </summary>
    <div className="event-admin-disclosure-body">
    {error && <p className="event-field-error" role="alert">{error}</p>}
    <table className="data">
      <thead><tr><th scope="col">Monitoring Area</th><th scope="col">Area purpose</th><th scope="col">Rules</th><th scope="col">Used by</th><th scope="col">Last updated</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
      <tbody>{geofences.map((geofence) => {
        const using = plansUsing(geofence.id);
        return <tr key={geofence.id} className={selectedId === geofence.id ? "event-resource-selected" : undefined}>
          <td>
            <button className="event-resource-select" onClick={() => onSelect(geofence.id)}>{geofence.name}</button>
            {/* Shown only where it is needed: the sole thing separating two
                rows that are otherwise identical on screen. */}
            {duplicated.has(geofence.name) && <span className="td-subtle">Duplicate name · id ends {geofence.id.slice(-6)}</span>}
          </td>
          <td><select aria-label={`${geofence.name} area purpose`} value={geofence.purpose ?? "other"} onChange={(event) => void changePurpose(geofence, event.target.value)}>{purposes.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></td>
          <td>{geofence.rules?.length ?? 0}</td>
          <td>{using.length === 0 ? <span className="td-subtle">Not in any Event Plan</span> : using.map((plan) => `${plan.name} (${plan.status})`).join(", ")}</td>
          <td className="td-dim">{new Date(geofence.updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}{geofence.updated_by ? ` · ${geofence.updated_by}` : ""}</td>
          <td>{geofence.is_active ? "Active" : "Inactive"}</td>
          <td>{geofence.is_active
            ? <><button className="btn-sm" disabled={busy === geofence.id} aria-label={`Rename Monitoring Area ${geofence.name}`} onClick={() => void rename(geofence)}>Rename</button>{" "}<button className="btn-sm danger" disabled={busy === geofence.id} aria-label={`Deactivate Monitoring Area ${geofence.name}`} onClick={() => void remove(geofence)}>{busy === geofence.id ? "Deactivating…" : "Deactivate"}</button></>
            : "—"}</td>
        </tr>;
      })}</tbody>
    </table>
    </div>
  </details>;
}

function LocationManager({ locations, selectedId, onSelect, onChanged }: { locations: EventLocation[]; selectedId: string | null; onSelect: (id: string) => void; onChanged: () => void }) {
  const { confirm, prompt } = useAppDialog();
  async function rename(location: EventLocation) { const name = (await prompt({ title: "Rename transit location", label: "Location name", defaultValue: location.name, confirmLabel: "Save changes", required: true }))?.trim(); if (!name || name === location.name) return; await api.updateEventLocation(location.id, { name }); onChanged(); }
  async function deactivate(location: EventLocation) { if (!await confirm({ title: `Deactivate ${location.name}?`, description: "The location will remain available in audit history but cannot be selected for new rules or scope.", confirmLabel: "Deactivate", danger: true })) return; await api.updateEventLocation(location.id, { is_active: false }); onChanged(); }
  if (!locations.length) return null;
  return <details className="event-admin-disclosure" open>
    <summary>
      <span><strong>Transit locations</strong><small>Named reference points used by rules and operational scope</small></span>
      <span className="event-admin-disclosure-count">{locations.filter((row) => row.is_active).length} active</span>
    </summary>
    <div className="event-admin-disclosure-body">
      <table className="data"><thead><tr><th>Location</th><th>Category</th><th>Coordinates</th><th>Actions</th></tr></thead><tbody>{locations.map((location) => <tr key={location.id} className={selectedId === location.id ? "event-resource-selected" : undefined}><td><button className="event-resource-select" onClick={() => onSelect(location.id)}>{location.name}</button></td><td>{LOCATION_CATEGORY_LABELS[location.category]}</td><td>{location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}</td><td><button className="btn-sm" onClick={() => void rename(location)}>Rename</button>{" "}<button className="btn-sm" onClick={() => void deactivate(location)}>Deactivate</button></td></tr>)}</tbody></table>
    </div>
  </details>;
}

export function EventResourceMapEditor() {
  // Lets Event Planning's "Every linked geofence has a direction rule"
  // readiness item deep-link straight to the relevant geofence instead of
  // landing here with nothing selected - resolves once `geofences` loads
  // even though the id is read before that request resolves.
  const [searchParams] = useSearchParams();
  const { confirm } = useAppDialog();
  const [geofences, setGeofences] = useState<StoredFence[]>([]); const [locations, setLocations] = useState<EventLocation[]>([]); const [plans, setPlans] = useState<EventServicePlan[]>([]); const [purposes, setPurposes] = useState<EventGeofencePurposeOption[]>([]); const [selectedFence, setSelectedFence] = useState(() => searchParams.get("geofence") ?? ""); const [editingRuleId, setEditingRuleId] = useState<string | null>(null); const [saving, setSaving] = useState(false); const [rule, setRule] = useState<Partial<EventGeofenceRule>>({ name: "", transition: "exit", heading_min: 0, heading_max: 360, message_type: "custom", send_mode: "manual", destination_label: "", sort_order: 0 }); const [directionPreset, setDirectionPreset] = useState<CompassDirection>("any"); const [testBus, setTestBus] = useState("1234"); const [message, setMessage] = useState<string | null>(null);
  const load = () => Promise.all([api.getEventGeofences(), api.getEventLocations(), api.getEventServicePlans(), api.getEventGeofencePurposes()]).then(([g, l, p, purposesResponse]) => { setGeofences(g.geofences); setLocations(l.locations); setPlans(p.plans); setPurposes(purposesResponse.purposes); }).catch((err) => setMessage(err instanceof ApiError ? err.message : "Event resources are unavailable until migrations 033, 034, 066, and 067 are applied."));
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
      const input = { name: rule.name?.trim() || null, transition: rule.transition as "enter" | "exit", heading_min: Number(rule.heading_min), heading_max: Number(rule.heading_max), destination_label: label, destination_location_id: rule.destination_location_id ?? null, message_type: messageType, send_mode: rule.send_mode as "manual" | "auto", sort_order: Number(rule.sort_order) };
      if (editingRuleId) await api.updateEventGeofenceRule(selectedFence, editingRuleId, input); else await api.addEventGeofenceRule(selectedFence, input);
      setMessage(editingRuleId ? "Direction rule updated." : "Direction rule saved."); setEditingRuleId(null); setRule({ name: "", transition: "exit", heading_min: 0, heading_max: 360, message_type: "custom", send_mode: "manual", destination_label: "", sort_order: 0 }); setDirectionPreset("any"); await load();
    } catch (err) { setMessage(err instanceof ApiError ? err.message : "Could not save direction rule."); } finally { setSaving(false); }
  }
  function chooseDirection(value: CompassDirection) { setDirectionPreset(value); if (value === "any") setRule((r) => ({ ...r, heading_min: 0, heading_max: 360 })); else if (value !== "custom") setRule((r) => ({ ...r, heading_min: COMPASS_RANGES[value][0], heading_max: COMPASS_RANGES[value][1] })); }
  function editRule(item: EventGeofenceRule) { const messageType = item.message_type ?? "custom"; setEditingRuleId(item.id); setRule({ ...item, message_type: messageType, transition: messageType === "arriving_soon" ? "enter" : item.transition }); setDirectionPreset("custom"); }
  async function deleteRule(ruleId: string) { if (!selectedFence || !await confirm({ title: "Delete direction rule?", description: "This removes the operational message rule from the Monitoring Area.", confirmLabel: "Delete rule", danger: true })) return; try { await api.deleteEventGeofenceRule(selectedFence, ruleId); setMessage("Direction rule deleted."); await load(); } catch (err) { setMessage(err instanceof ApiError ? err.message : "Could not delete direction rule."); } }
  const previewContext = rule.destination_label?.trim() ? `; ${rule.destination_label.trim()}` : "";
  const previewMessage = selected
    ? rule.message_type === "departing" ? `Bus ${testBus || "1234"} on Route 55 is departing ${locations.find((location) => location.id === rule.destination_location_id)?.name ?? selected.name}${previewContext}.`
      : rule.message_type === "passed" ? `Bus ${testBus || "1234"} on Route 55 has passed ${locations.find((location) => location.id === rule.destination_location_id)?.name ?? selected.name}${previewContext}.`
        : rule.message_type === "arriving_soon" ? `Bus ${testBus || "1234"} on Route 55 is arriving at ${locations.find((location) => location.id === rule.destination_location_id)?.name ?? selected.name} soon${previewContext}.`
          : rule.destination_label?.trim() ? `Bus ${testBus || "1234"} on Route 55 ${rule.transition === "enter" ? "entered" : "exited"} ${selected.name}; ${rule.destination_label.trim()}.` : "Choose a Monitoring Area and enter an operational message to preview it."
    : "Choose a Monitoring Area and enter an operational message to preview it.";
  return <>
    <details className="event-admin-disclosure event-admin-map-section" open>
      <summary>
        <span><strong>Monitoring Area authoring</strong><small>Draw boundaries and maintain reference locations</small></span>
        <span className="event-admin-disclosure-count">{geofences.filter((fence) => fence.is_active).length} areas</span>
      </summary>
      <div className="event-admin-disclosure-body"><p className="panel-desc">Draw and maintain reusable operational boundaries and transit locations here. Link them to an operating period in Event Planning before they affect Event AVL.</p>{message && <p className="muted">{message}</p>}<EventResourceMapEditorInner geofences={geofences} locations={locations} plans={plans} purposes={purposes} onChanged={load} /></div>
    </details>
    <details className="event-admin-disclosure event-direction-rules" open={Boolean(selectedFence)}>
      <summary>
        <span><strong>Direction rules</strong><small>Define when a Monitoring Area movement creates an operational notification</small></span>
        <span className="event-admin-disclosure-count">{selected ? `${selected.rules?.length ?? 0} rules` : "Select an area"}</span>
      </summary>
      <div className="event-admin-disclosure-body">
      <p className="panel-desc">Every crossing in an active operating scope creates an Event AVL message. Planning defines the message type and wording; Event AVL controls whether matched messages are sent automatically to the configured Teams channel. Lower priority wins when rules overlap.</p>
      <div className="event-rule-step"><span className="event-rule-step-number">1</span><div><strong>When should this rule match?</strong><div className="event-rule-fields"><label>Rule name <span className="hint">(optional)</span><input className="f" maxLength={100} value={rule.name ?? ""} onChange={(e) => setRule((r) => ({ ...r, name: e.target.value }))} placeholder="Example: Fairgrounds departure" /></label><label>Monitoring Area<select id="event-geofence-rule-select" className="f" value={selectedFence} onChange={(e) => setSelectedFence(e.target.value)}><option value="">Select a Monitoring Area</option>{geofences.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label><label>Boundary movement<select className="f" value={rule.transition} onChange={(e) => setRule((r) => ({ ...r, transition: e.target.value as "enter" | "exit" }))}><option value="enter">Vehicle enters</option><option value="exit" disabled={rule.message_type === "arriving_soon"}>Vehicle exits</option></select></label><label>Travel direction<select className="f" value={directionPreset} onChange={(e) => chooseDirection(e.target.value as CompassDirection)} aria-label="Vehicle travel direction"><option value="any">Any direction</option>{Object.keys(COMPASS_RANGES).map((direction) => <option key={direction} value={direction}>{direction}</option>)}<option value="custom">Custom compass range</option></select></label></div></div></div>
      <div className="event-rule-step"><span className="event-rule-step-number">2</span><div><strong>What movement range is covered?</strong><p className="muted">Use compass directions for common operations; use degrees only for a precise range.</p><div className="event-rule-fields"><label>Minimum bearing<input className="f" type="number" min={0} max={360} step={0.5} value={rule.heading_min} onChange={(e) => { setDirectionPreset("custom"); setRule((r) => ({ ...r, heading_min: Number(e.target.value) })); }} /></label><label>Maximum bearing<input className="f" type="number" min={0} max={360} step={0.5} value={rule.heading_max} onChange={(e) => { setDirectionPreset("custom"); setRule((r) => ({ ...r, heading_max: Number(e.target.value) })); }} /></label><label>Priority <span title="Lower numbers are evaluated first">ⓘ</span><input className="f" type="number" min={0} value={rule.sort_order} onChange={(e) => setRule((r) => ({ ...r, sort_order: Number(e.target.value) }))} /></label></div></div></div>
      <div className="event-rule-step"><span className="event-rule-step-number">3</span><div><strong>What should Event AVL say?</strong><div className="event-rule-fields"><label>Message template<select className="f" value={rule.message_type ?? "custom"} onChange={(e) => { const messageType = e.target.value as EventGeofenceMessageType; setRule((r) => ({ ...r, message_type: messageType, transition: messageType === "arriving_soon" ? "enter" : r.transition })); }}>{Object.entries(MESSAGE_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>{rule.message_type === "custom" ? "Message instruction" : "Add to this message"}<input className="f" maxLength={200} value={rule.destination_label ?? ""} onChange={(e) => setRule((r) => ({ ...r, destination_label: e.target.value }))} placeholder={rule.message_type === "custom" ? "Example: Proceed to Gate A" : "Example: Use the west entrance"} /></label><label>Related location<select className="f" value={rule.destination_location_id ?? ""} onChange={(e) => setRule((r) => ({ ...r, destination_location_id: e.target.value || null }))}><option value="">Use Monitoring Area name</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label></div><p className="muted">{rule.message_type === "custom" ? "A custom instruction follows the entered or exited Monitoring Area message." : "Your addition is appended after the selected message template."} Arriving soon is always triggered when the vehicle enters this Monitoring Area; it does not calculate an ETA. Event AVL controls whether matched messages are sent to Teams.</p></div></div>
      <div className="event-rule-preview"><strong>Message preview</strong><span>{previewMessage}</span><label>Test bus number<input className="f" value={testBus} onChange={(e) => setTestBus(e.target.value)} /></label><small>Preview only. A live test is created by activating the operating period, using a vehicle assigned to one of its routes, and confirming the crossing appears under Event AVL notifications.</small></div>
      <div className="actions"><button className="btn-primary" disabled={!selectedFence || ((rule.message_type ?? "custom") === "custom" && !rule.destination_label?.trim()) || saving} onClick={() => void saveRule()}>{saving ? "Saving…" : editingRuleId ? "Save rule changes" : "Save direction rule"}</button>{editingRuleId && <button className="btn-sm" onClick={() => { setEditingRuleId(null); setRule({ name: "", transition: "exit", heading_min: 0, heading_max: 360, message_type: "custom", send_mode: "manual", destination_label: "", sort_order: 0 }); setDirectionPreset("any"); }}>Cancel edit</button>}</div>
      {selected && <div style={{ marginTop: 12 }}><strong>{selected.name} rules</strong>{(selected.rules ?? []).length === 0 ? <p className="muted">No rules configured.</p> : <table className="data"><thead><tr><th>Rule</th><th>Priority</th><th>Movement</th><th>Direction</th><th>Message detail</th><th>Teams behavior</th><th>Action</th></tr></thead><tbody>{(selected.rules ?? []).map((item) => <tr key={item.id}><td><strong>{item.name || "Unnamed rule"}</strong><span className="td-subtle">{MESSAGE_TYPE_LABELS[item.message_type]}</span></td><td>{item.sort_order}</td><td>{item.transition === "enter" ? "Enters" : "Exits"}</td><td>{item.heading_min}°–{item.heading_max}°</td><td>{item.destination_label || "—"}</td><td>Controlled in Event AVL</td><td><button className="btn-sm" onClick={() => editRule(item)}>Edit</button>{" "}<button className="btn-sm" onClick={() => void deleteRule(item.id)}>Delete</button></td></tr>)}</tbody></table>}</div>}
      </div>
    </details>
  </>;
}

function EventResourceMapEditorInner(props: { geofences: StoredFence[]; locations: EventLocation[]; plans: EventServicePlan[]; purposes: EventGeofencePurposeOption[]; onChanged: () => void }) { return <MapEditor {...props} />; }
