import { useEffect, useMemo, useState } from "react";
import {
  type ExpirationDefault,
  CATEGORY_LABELS,
  type Category,
  ApiError,
  type RouteClassificationRow,
  type RouteCategory,
  ROUTE_CATEGORY_LABELS,
  type GtfsRouteOption,
} from "@mvta/shared";
import { api } from "../config.js";

const ROUTE_CATEGORIES: RouteCategory[] = ["FixedRoute", "SpecialEvent", "OnDemand"];

// Route Classification editor - no Avail feed distinguishes fixed-route
// from special-event RouteIDs, so this is the one place staff maintain that
// distinction. A light, occasional admin step (per the design doc), not a
// bulk-import workflow - someone adds/updates a row before an event runs.
function RouteClassificationSection() {
  const [routes, setRoutes] = useState<RouteClassificationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [routeIdInput, setRouteIdInput] = useState("");
  const [category, setCategory] = useState<RouteCategory>("SpecialEvent");
  const [label, setLabel] = useState("");

  // Same registry (GtfsRoutes via GET /routes) already backing Compose's
  // affected-routes selector - picking a known route beats typing a raw
  // numeric ID blind. Falls back to the free-text input if the registry
  // can't be reached or is empty, same graceful-degradation convention as
  // Compose.
  const [routesList, setRoutesList] = useState<GtfsRouteOption[] | null>(null);

  function load() {
    api
      .getRouteClassification()
      .then((d) => {
        setRoutes(d.routes);
        setError(null);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load route classifications."));
  }

  useEffect(load, []);

  useEffect(() => {
    let alive = true;
    api
      .getRoutes()
      .then((d) => alive && setRoutesList(d.routes))
      .catch(() => alive && setRoutesList([]));
    return () => {
      alive = false;
    };
  }, []);

  const routesUseSelector = (routesList?.length ?? 0) > 0;
  const routeOptions = useMemo(
    () =>
      (routesList ?? [])
        .map((r) => ({
          id: r.route_id,
          label: r.route_short_name || r.route_long_name || r.route_id,
          title: r.route_long_name ?? undefined,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })),
    [routesList],
  );

  function startEdit(r: RouteClassificationRow) {
    setEditingId(r.route_id);
    setRouteIdInput(String(r.route_id));
    setCategory(r.route_category);
    setLabel(r.route_label ?? "");
    setOkMsg(null);
  }

  function startNew() {
    setEditingId(null);
    setRouteIdInput("");
    setCategory("SpecialEvent");
    setLabel("");
    setOkMsg(null);
  }

  async function save() {
    const routeId = parseInt(routeIdInput, 10);
    if (!Number.isInteger(routeId)) {
      setError("Route ID must be a whole number.");
      return;
    }
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      await api.putRouteClassification(routeId, { route_category: category, route_label: label.trim() || null });
      setOkMsg(`Route ${routeId} classified as ${ROUTE_CATEGORY_LABELS[category]}.`);
      startNew();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="panel-header" style={{ marginTop: 24 }}>Route Classification</div>
      <div className="panel-body">
        <p className="panel-desc">
          No Avail feed distinguishes a fixed route from a special-event route - classify RouteIDs
          here so the OTP/Missed Trips/AVL integrations and the event-bus live map know which is
          which. Unclassified routes are treated as fixed route by default.
        </p>
        {error ? <p className="error-text">{error}</p> : null}
        {okMsg ? <p className="ok-text">{okMsg}</p> : null}

        <div className="subcard" style={{ marginBottom: 16 }}>
          <div className="field-grid">
            <div>
              <p className="field-label">Route ID</p>
              {routesUseSelector && editingId === null ? (
                <select className="f" value={routeIdInput} onChange={(e) => setRouteIdInput(e.target.value)}>
                  <option value="">Select a route…</option>
                  {routeOptions.map((r) => (
                    <option value={r.id} key={r.id} title={r.title}>{r.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  className="f"
                  type="number"
                  value={routeIdInput}
                  disabled={editingId !== null}
                  onChange={(e) => setRouteIdInput(e.target.value)}
                  placeholder="e.g. 90"
                />
              )}
            </div>
            <div>
              <p className="field-label">Category</p>
              <select className="f" value={category} onChange={(e) => setCategory(e.target.value as RouteCategory)}>
                {ROUTE_CATEGORIES.map((c) => (
                  <option value={c} key={c}>{ROUTE_CATEGORY_LABELS[c]}</option>
                ))}
              </select>
            </div>
            <div>
              <p className="field-label">Label <span className="hint">(optional)</span></p>
              <input className="f" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Vikings Game Shuttle" />
            </div>
          </div>
          <button className="btn-post" disabled={busy || !routeIdInput} onClick={save}>
            {busy ? "Saving…" : editingId !== null ? "Update" : "Add classification"}
          </button>
          {editingId !== null ? <button className="btn-sm" onClick={startNew}>Cancel</button> : null}
        </div>

        {routes === null && !error ? (
          <p className="muted">Loading…</p>
        ) : routes && routes.length > 0 ? (
          <table className="data">
            <thead>
              <tr><th>Route ID</th><th>Category</th><th>Label</th><th>Updated</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {routes.map((r) => (
                <tr key={r.route_id}>
                  <td>{r.route_id}</td>
                  <td><span className="pill-sm pill-accent">{ROUTE_CATEGORY_LABELS[r.route_category]}</span></td>
                  <td>{r.route_label || "—"}</td>
                  <td className="td-dim">{r.updated_by ? `${r.updated_by} · ` : ""}{new Date(r.updated_at).toLocaleDateString()}</td>
                  <td><button className="btn-sm" onClick={() => startEdit(r)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="empty-note">No routes classified yet - unclassified routes default to fixed route.</p>
        )}
      </div>
    </>
  );
}

// Admin - expiration defaults editor. These TTLs drive expires_at whenever a
// message is created without an explicit expiration (expiration_source =
// category_default). PATCH is OCC.Admin-only, enforced server-side.
export function Admin() {
  const [defaults, setDefaults] = useState<ExpirationDefault[] | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .getExpirationDefaults()
      .then((d) => alive && setDefaults(d.defaults))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Failed to load (requires staff sign-in)."));
    return () => {
      alive = false;
    };
  }, []);

  async function save(category: Category) {
    const value = parseInt(edits[category] ?? "", 10);
    if (!Number.isInteger(value)) return;
    setBusy(category);
    setError(null);
    setOkMsg(null);
    try {
      const updated = await api.updateExpirationDefault(category, value);
      setDefaults((prev) =>
        prev
          ? prev.map((d) => (d.category === category ? { ...d, default_ttl_minutes: updated.default_ttl_minutes } : d))
          : prev,
      );
      setEdits((prev) => ({ ...prev, [category]: "" }));
      setOkMsg(`${CATEGORY_LABELS[category]} default updated to ${updated.default_ttl_minutes} minutes.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="panel-header">Admin — Expiration Defaults</div>
      <div className="panel-body">
        <p className="panel-desc">
          Default time-to-live per category, applied when an announcement is posted without an
          explicit expiration.
        </p>
        {error ? <p className="error-text">{error}</p> : null}
        {okMsg ? <p className="ok-text">{okMsg}</p> : null}
        {defaults === null && !error ? (
          <p className="muted">Loading…</p>
        ) : defaults ? (
          <table className="data">
            <thead>
              <tr>
                <th>Category</th>
                <th>Default TTL (minutes)</th>
                <th>Last updated</th>
                <th>New value</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {defaults.map((d) => (
                <tr key={d.category}>
                  <td>{CATEGORY_LABELS[d.category] ?? d.category}</td>
                  <td>
                    <b>{d.default_ttl_minutes}</b>{" "}
                    <span className="td-dim">({Math.round((d.default_ttl_minutes / 60) * 10) / 10} hr)</span>
                  </td>
                  <td className="td-dim">
                    {d.updated_by ? `${d.updated_by} · ` : ""}
                    {new Date(d.updated_at).toLocaleDateString()}
                  </td>
                  <td>
                    <input
                      className="f"
                      style={{ width: 110 }}
                      type="number"
                      min={5}
                      max={43200}
                      value={edits[d.category] ?? ""}
                      onChange={(e) => setEdits((prev) => ({ ...prev, [d.category]: e.target.value }))}
                      placeholder={String(d.default_ttl_minutes)}
                    />
                  </td>
                  <td>
                    <button
                      className="btn-sm"
                      disabled={busy === d.category || !edits[d.category]}
                      onClick={() => save(d.category)}
                    >
                      {busy === d.category ? "Saving…" : "Save"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
      <RouteClassificationSection />
    </>
  );
}
